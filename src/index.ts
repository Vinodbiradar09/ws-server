import express, { type Request, type Response } from "express";
import WebSocket , { WebSocketServer } from "ws";
import { createServer, IncomingMessage } from "http";
import { db } from "./lib.js";
import { attendanceSchema, classSchema, signinSchema, signupSchema, addStudent } from "./types.js";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { AuthMiddleware, studentMiddleware, teacherMiddleware } from "./middleware.js";
import { Status } from "@prisma/client"; 
const app = express();

app.use(express.json());
app.use(express.urlencoded({extended : true}));

const server = createServer(app);
const wss = new WebSocketServer({server , path : "/ws"});
import url from "url";

type Attendance = Record<string, string>;

interface ActiveSession {
  classId?: string;
  startedAt?: string;
  teacherId? : string;
  attendance?: Attendance;
}
interface ExtWebSocket extends WebSocket {
    userId : string,
    role : "teacher" | "student",
}

const activeSession : ActiveSession = {};

wss.on("connection" , ( ws : WebSocket , req : IncomingMessage )=> connectionWs(ws , req));

const sendError = async(ws : WebSocket , message : string)=>{
    if(ws.readyState === 1){
        ws.send(JSON.stringify({
            event : "ERROR",
            data : {
                message,
            }
        }))
    }
}

const connectionWs = async( ws : WebSocket , req : IncomingMessage )=>{
  console.log("client is connected");
  // @ts-ignore
  const parsedUrl = url.parse(req.url , true);
  const token = parsedUrl.query.token;
  if(!token || Array.isArray(token)){
    sendError(ws , "Token not found");
    ws.close();
    return;
  }

  const w = ws as ExtWebSocket;
  try {
    const { userId , role } = jwt.verify(token! , process.env.JWTSECRET!) as JwtPayload;
    w.userId = userId;
    w.role = role;
  } catch (error) {
    sendError(w , "Unauthorized or invalid token");
    w.close();
    return;
  }

  w.on("message" , async( messages )=>{
    const { event , data } = JSON.parse(messages.toString());
    const { studentId , status } = data;
    switch(event){
        case "ATTENDANCE_MARKED":
            if( w.role !== "teacher"){
                sendError(w , "Forbidden, teacher event only")
                w.close();
                return;
            }
            if(!activeSession || activeSession.teacherId !== w.userId){
                sendError(w , "No active attendance session");
                w.close();
                return;
            }
            // @ts-ignore
            activeSession.attendance[studentId] = status;
            broadcast({ event : "ATTENDANCE_MARKED" , data : { studentId , status}});
            break;
        
        case "TODAY_SUMMARY" : 
            if(w.role !== "teacher"){
                sendError(w , "Forbidden, teacher event only");
                w.close();
                return;
            }
            if(!activeSession || activeSession.teacherId !== w.userId){
                sendError(w , "No active attendance session");
                w.close();
                return;
            }
            if(!activeSession.attendance){
                sendError(w , "The Attendance is still not persisted");
                w.close();
                return;
            }
            const res = Object.values(activeSession.attendance);
            const present = res.filter(( pre )=> pre === "present").length;
            const absent = res.filter(( abs )=> abs === "absent").length;
            const total = res.length;
            broadcast({event : "TODAY_SUMMARY" , data : { present , absent , total}});
            break;
         
        case "MY_ATTENDANCE" : 
            if(w.role !== "student"){
                sendError(w , "Forbidden, student event only");
                w.close();
                return;
            }     
            const cl = await db.class.findFirst({
                where : {
                    id : activeSession.classId!,
                    students : {
                        some : {
                            id : w.userId,
                        }
                    }
                }
            })
            if(!cl){
                sendError(w , "you are not enrolled to this class");
                w.close();
                return;
            }

            if(!activeSession || !activeSession.attendance){
                sendError(w , "No active attendance session");
                w.close();
                return;
            }
            const attendanceStatus = activeSession?.attendance[w.userId] || "not yet updated";
                w.send(JSON.stringify({
                    event : "MY_ATTENDANCE",
                    data : {
                        status : attendanceStatus,
                    }
            }))
            break;

        case "DONE" : 
            if(w.role !== "teacher"){
                sendError(w , "Forbidden, student event only");
                w.close();
                return;
            }    

            if( !activeSession ||activeSession.teacherId !== w.userId){
                sendError(w , "Forbidden , you are not class teacher");
                w.close();
                return;
            }

            const classDb = await db.class.findUnique({
                where : {
                    id : activeSession.classId!,
                },
                select : {
                    students : {
                        select : {
                            id : true,
                        }
                    }
                }
            })

            classDb?.students.forEach(( stdId )=>{
                // @ts-ignore
                if(!activeSession.attendance[stdId.id]){
                    // @ts-ignore
                    activeSession.attendance[stdId.id] = "absent";
                }
            })

            const result = Object.entries(activeSession.attendance!).map(([ key , value])=>({
                classId : activeSession.classId!,
                studentId : key,
                status : value as Status,
            }))

            if(result.length > 0){
                await db.attendance.createMany({
                    data : result,
                    skipDuplicates : true,
                })
            }

            const overAll  = Object.values(activeSession.attendance!);
            const p = overAll.filter(( pres ) => pres === "present").length;
            const a = overAll.filter(( abs )=> abs === "absent").length;
            const t = overAll.length;
            // @ts-ignore
            activeSession = null;
            broadcast(JSON.stringify({
                event : "DONE",
                data : {
                    message : "Attendance Persisted",
                    present : p,
                    absent : a,
                    total : t,
                }
            }))  
    }
  })

  w.on("close" , ()=>{
    console.log("closed");
  })
}

const broadcast = async( data : any)=>{
    wss.clients.forEach(( client )=>{
        if(client.readyState === WebSocket.OPEN){
            client.send(data);
        }
    })
};

app.post("/auth/signup" , async( req : Request , res : Response)=>{
    try {
        const body = req.body;
        const { success , data } = signupSchema.safeParse(body);
        if(!success){
            res.status(400).json({
                success : false,
                error : "Invalid request schema",
            })
            return;
        }
        const existingUser = await db.user.findUnique({
            where :{
                email : data.email,
            }
        })
        if(existingUser){
            res.status(400).json({
                success : false,
                error : "Email already exists",
            })
            return;
        }
        const user = await db.user.create({
            data : {
                ...data,
            }
        })
        res.status(201).json({
            success : true,
            data : {
                _id : user.id,
                name : user.name,
                email : user.email,
                role : user.role,
            }
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
})

app.post("/auth/login" , async(req : Request , res :Response)=>{
    try {
        const body = req.body;
        const { success ,data  } = signinSchema.safeParse(body);
        if(!success){
            res.status(400).json({
                success : false,
                error : "Invalid request schema",
            })
            return;
        }

        const user = await db.user.findUnique({
            where : {
                email : data.email,
            }
        })
        if(!user || user.password !== data.password){
            res.status(400).json({
                success : false,
                error : "Invalid email or password",
            })
            return;
        }

        const token = jwt.sign({ userId : user.id , role : user.role} , process.env.JWTSECRET!);
        res.status(200).json({
            success : true,
            data : {
                token,
            }
        })
        
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
})

app.get("/auth/me" , AuthMiddleware ,  async(req : Request , res : Response)=>{
    try {
        const { userId , role} = req;
        const user = await db.user.findUnique({
            where : {
                id : userId!,
            }
        })
        res.status(200).json({
            success : true,
            data : {
                _id : user?.id,
                name : user?.name,
                email : user?.email,
                role : user?.role,
            }
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
})

app.post("/class" , AuthMiddleware , teacherMiddleware ,  async (req : Request , res : Response)=>{
    try {
        const body = req.body;
        const { success , data } = classSchema.safeParse(body);
        if(!success){
            res.status(400).json({
                success : false,
                error : "Invalid request schema",
            })
            return;
        }
        const classDb = await db.class.create({
            data : {
                className : data.className,
                teacherId : req.userId!,
            }
        })
        res.status(201).json({
            success : true,
            data : {
                _id : classDb.id,
                className : classDb.className,
                teacherId : classDb.teacherId,
                studentIds : [],
            }
        })

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
})

app.post("/class/:id/add-student" , AuthMiddleware , teacherMiddleware , async(req : Request , res : Response)=>{
    try {
        const body = req.body;
        const { id } = req.params;
        if(!id || Array.isArray(id)){
            return res.status(400).json({
                success : false,
                error : "params required",
            })
        }
        const { success , data } = addStudent.safeParse(body);
        if(!success){
            res.status(400).json({
                success : false,
                error : "Invalid request schema",
            })
            return;
        }
        const classDb = await db.class.findUnique({
            where : {
                id,
            },
            select : {
                students : true,
                teacherId : true,
            }
        })
        if(!classDb || classDb.teacherId !== req.userId){
            res.status(403).json({
                success : false,
                error: "Forbidden, not class teacher",
            })
        }
        const student = await db.user.findUnique({
        where: {
          id: data.studentId,
        },
      });
      if (!student || student.role !== "student") {
        return res.status(404).json({
          success: false,
          error: "Student not found",
        });
      }

      const isStudentPresent = classDb?.students.some(( std )=> std.id === req.userId);
      if(isStudentPresent){
        res.status(403).json({
            success : "false",
            error : "student already present in the class",
        })
      }
        const classs = await db.class.update({
            where : {
                id,
            },
            data : {
                students : {
                    connect : {
                        id : data.studentId,
                    }
                }
            },
            select : {
                id : true,
                className : true,
                teacherId : true,
                students : {
                    select : {
                        id : true,
                    }
                }
            }
        })
        res.status(200).json({
            success : true,
            data : {
                _id : classs.id,
                className : classs.className,
                teacherId : classs.teacherId,
                studentIds : classs.students.map(( x) => x.id),
            }
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
})

app.get("/class/:id" , AuthMiddleware , async(req : Request , res :Response)=>{
    try {
        const { id } = req.params;
        if(!id || Array.isArray(id)){
            return res.status(400).json({
                success : false,
                error : "params required",
            })
        }
        const classs = await db.class.findUnique({
            where : {
                id,
            },
            select : {
                id : true,
                className : true,
                teacherId : true,
                students : {
                    select : {
                        id : true,
                        name : true,
                        email : true,
                    }
                }
            }
        })
        if(req.role === "teacher" && classs?.teacherId !== req.userId){
            res.status(403).json({
                success : false,
                error: "Forbidden, not class teacher",
            })
        }
        const valid = classs?.students.some(( std )=> std.id === req.userId);
        if(!valid){
            res.status(404).json({
                success : false,
                error : "Student not found",
            })
        }
        res.status(200).json({
            success : true,
            data : {
                _id : classs?.id,
                className : classs?.className,
                teacherId : classs?.teacherId,
                students : classs?.students,
                // i think we don't need to map it returns an array of students only
                // students : classs?.students.map(( std )=> ({
                //     _id : std.id,
                //     name : std.name,
                //     email : std.email,
                // }))
            }
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
})

app.get("/students" , AuthMiddleware , teacherMiddleware , async(req : Request , res : Response)=>{
    try {
        const students = await db.user.findMany({
            where : {
                role : "student",
            },
            select :{
                id : true,
                name : true,
                email : true,
            }
        })
        res.status(200).json({
            success : true,
            data : students,
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
})

app.get("/class/:id/my-attendance" , AuthMiddleware , studentMiddleware , async(req : Request , res : Response)=>{
    try {
        const { id } = req.params;
        if(!id || Array.isArray(id)){
            return res.status(400).json({
                success : false,
                error : "params required",
            })
        }
        const attendance = await db.attendance.findFirst({
           where : {
            classId : id,
            studentId : req.userId!,
           }
        })

        if(!attendance){
            res.status(404).json({
                success : false,
                error : "Class not found",
            })
        }
        const status = attendance?.status ?? null;
        res.status(200).json({
            success : true,
            data : {
                classId : attendance?.classId,
                status,
            }
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
})

app.post("/attendance/start" , AuthMiddleware , teacherMiddleware , async(req : Request , res : Response)=>{
    try {
        const body = req.body;
        const { success , data } = attendanceSchema.safeParse(body);
        if(!success){
            res.status(400).json({
                success : false,
                error : "Invalid request schema",
            })
            return;
        }
        const classs = await db.class.findUnique({
            where : {
                id : data.classId,
            }
        })
        if(!classs || classs.teacherId !== req.userId){
            res.status(403).json({
                success : false,
                error: "Forbidden, not class teacher",
            })
        }

        activeSession.classId = classs?.id!,
        activeSession.startedAt = new Date().toISOString(),
        activeSession.teacherId = classs?.teacherId!,
        activeSession.attendance = {};

        res.status(200).json({
            success : true,
            data : {
                classId : activeSession.classId,
                startedAt : activeSession.startedAt,
            }
        })

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
})

server.listen(3003 , ()=>{
    console.log("ws is running on 3003");
})
