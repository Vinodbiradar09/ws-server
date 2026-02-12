import express, { type Request, type Response } from "express";
import { db } from "./lib.js";
import {
  addStudent,
  attendanceSchema,
  classSchema,
  loginSchema,
  signupSchema,
} from "./types.js";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { AuthMiddleware, TeacherMiddleware } from "./middleware.js";
import WebSocket, { WebSocketServer } from "ws";
import { createServer } from "http";
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
import url from "url";
let activeSession: {
  classId?: string;
  startedAt?: string;
  attendance?: {};
} = {};

// const getActiveSession = ( teachedId = null)=>{
//   if(!activeSession)
// }

wss.on("connection", (ws, req) => {
  console.log("the client is connected");
  // @ts-ignore
  const parsedUrl = url.parse(req.url, true);
  const token = parsedUrl.query.token;
  console.log("token", token);
  if (!token || Array.isArray(token)) {
    ws.on("close", () => {
      console.log("connecttion closed");
    });
    return null;
  }
  const { userId, role } = jwt.verify(
    token,
    process.env.JWTSECRET!,
  ) as JwtPayload;
  if (!userId || !role) {
    ws.send(
      JSON.stringify({
        event: "ERROR",
        data: { message: "Unauthorized or invalid token" },
      }),
    );
    ws.on("close", () => {
      console.log("connecion closed due to invalid token error");
    });
  }
  console.log("userId", userId, role);
  // @ts-ignore
  ws.user = {
    userId,
    role,
  };
  ws.on("message", async (message) => {
    const parsed = JSON.parse(message.toString());
    console.log("dadta", parsed);
    const { event, data } = parsed;
    switch (event) {
      case "ATTENDANCE_MARKED":
        // @ts-ignore
        if (ws.user.role === "teacher") {
          if (!activeSession) {
            ws.send(
              JSON.stringify({
                event: "ERROR",
                data: { message: "No active attendance session" },
              }),
            );
          }
          // @ts-ignore
          activeSession.attendance[data.studentId] = data.status;
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(data);
            }
          });
        } else {
          ws.send(
            JSON.stringify({
              event: "ERROR",
              data: { message: "Forbidden, teacher event only" },
            }),
          );
          return;
        }

      case "TODAY_SUMMARY":
        // @ts-ignore
        if (ws.user.role === "teacher") {
          if (!activeSession) {
            ws.send(
              JSON.stringify({
                event: "ERROR",
                data: { message: "No active attendance session" },
              }),
            );
          }
          const result = Object.values(activeSession?.attendance!);
          const present = result.filter((res) => res === "present").length;
          const absent = result.filter((res) => res === "absent").length;
          const total = result.length;

          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  event: "TODAY_SUMMARY",
                  data: {
                    present,
                    absent,
                    total,
                  },
                }),
              );
            }
          });
        } else {
          ws.send(
            JSON.stringify({
              event: "ERROR",
              data: { message: "Forbidden, teacher event only" },
            }),
          );
          return;
        }

      case "MY_ATTENDANCE":
        // @ts-ignore
        if (ws.user.role === "student") {
          if (!activeSession) {
            ws.send(
              JSON.stringify({
                event: "ERROR",
                data: { message: "No active attendance session" },
              }),
            );
          }
          const classdB = await db.class.findFirst({
            where: {
              id: activeSession.classId!,
              students: {
                some: {
                  // @ts-ignore
                  id: ws.user.userId,
                },
              },
            },
          });
          if (!classdB) {
            ws.send(
              JSON.stringify({
                event: "ERROR",
                data: {
                  message: "No you have not enrolled this class",
                },
              }),
            );
          }

          // @ts-ignore
          const status = activeSession.attendance[ws.user.userId] || "not updated yet";
          ws.send(
            JSON.stringify({
              event: "MY_ATTENDANCE",
              data: {
                status,
              },
            }),
          );
        } else {
          ws.send(
            JSON.stringify({
              event: "ERROR",
              data: { message: "Forbidden, student event only" },
            }),
          );
        }

      case "DONE":
        // @ts-ignore
        if (ws.user.role === "teacher") {
          if (!activeSession) {
            ws.send(
              JSON.stringify({
                event: "ERROR",
                data: { message: "No active attendance session" },
              }),
            );
          }
          const students = await db.class.findUnique({
            where: {
              id: activeSession.classId!,
            },
            select: {
              id: true,
              students: true,
            },
          });

          students?.students.forEach((std) => {
            const studentId = std.id.toString();
            // @ts-ignore
            if (!activeSession.attendance[studentId]) {
              // @ts-ignore
              activeSession.attendance[studentId] = "absent";
            }
          });
          // @ts-ignore
          const attendanceData = Object.entries(activeSession.attendance).map(
            ([key, value]) => ({
              classId: activeSession.classId,
              studentId: key,
              // @ts-ignore
              status: value,
            }),
          );
          if (attendanceData.length > 0) {
            await db.attendance.updateMany({
              data: {
                ...attendanceData,
              },
            });
          }

          const attendanceEverything = Object.values(activeSession.attendance!);
          const present = attendanceEverything.filter(
            (atd) => atd === "present",
          ).length;
          const absent = attendanceEverything.filter(
            (atd) => atd === "absent",
          ).length;
          const total = attendanceEverything.length;
          // @ts-ignore
          activeSession = null;

          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  event: "DONE",
                  data: {
                    message: "Attendance Persisted",
                    present,
                    absent,
                    total,
                  },
                }),
              );
            }
          });
        } else {
          ws.send(
            JSON.stringify({
              event: "ERROR",
              data: { message: "Forbidden, teacher event only" },
            }),
          );
          return;
        }
    }

    ws.on("close" , ()=>{
      console.log("connection closed");
    })
  });
});

app.post("/auth/signup", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const { success, data } = signupSchema.safeParse(body);
    if (!success) {
      res.status(400).json({
        success: false,
        error: "Invalid request schema",
      });
      return;
    }
    const existingUser = await db.user.findUnique({
      where: {
        email: data?.email,
      },
    });
    if (existingUser) {
      res.status(400).json({
        success: false,
        error: "Email already exists",
      });
    }
    const user = await db.user.create({
      data: { ...data },
    });
    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      error: "internal server error",
    });
  }
});

app.post("/auth/login", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const { success, data } = loginSchema.safeParse(body);
    if (!success) {
      res.status(400).json({
        success: false,
        error: "Invalid request schema",
      });
      return;
    }
    const user = await db.user.findUnique({
      where: {
        email: data.email,
      },
    });
    if (user?.password !== data.password || !user) {
      res.status(400).json({
        success: false,
        error: "Invalid email or password",
      });
    }
    const token = jwt.sign(
      { userId: user?.id, role: user?.role },
      process.env.JWTSECRET!,
    );
    res.status(200).json({
      success: true,
      data: {
        token,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      error: "internal server error",
    });
  }
});

app.get("/auth/me", AuthMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    const user = await db.user.findUnique({
      where: {
        id: userId!,
      },
    });
    res.status(200).json({
      success: true,
      data: {
        id: user?.id,
        name: user?.name,
        email: user?.email,
        role: user?.role,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      error: "internal server error",
    });
  }
});

app.post(
  "/class",
  AuthMiddleware,
  TeacherMiddleware,
  async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const { success, data } = classSchema.safeParse(body);
      if (!success) {
        res.status(400).json({
          success: false,
          error: "Invalid request schema",
        });
        return;
      }
      const classdB = await db.class.create({
        data: {
          className: data.className,
          teacherId: req.userId!,
        },
      });
      res.status(201).json({
        success: true,
        data: {
          id: classdB.id,
          className: classdB.className,
          teachedId: classdB.teacherId,
          studentIds: [],
        },
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({
        success: false,
        error: "internal server error",
      });
    }
  },
);

app.post(
  "/class/:id/add-student",
  AuthMiddleware,
  TeacherMiddleware,
  async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const { id } = req.params;
      if (!id || Array.isArray(id)) {
        return res.status(404).json({
          success: false,
          error: "paramas id not found",
        });
      }
      const { success, data } = addStudent.safeParse(body);
      if (!success) {
        res.status(400).json({
          success: false,
          error: "Invalid request schema",
        });
        return;
      }
      const classdb = await db.class.findUnique({
        where: {
          id: id!,
        },
      });
      if (!classdb) {
        res.status(403).json({
          success: false,
          error: "Class not found",
        });
      }
      if (classdb?.teacherId !== req.userId) {
        return res.status(403).json({
          success: false,
          error: "Forbidden: not class teacher",
        });
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
      const result = await db.class.update({
        where: {
          id,
        },
        data: {
          students: {
            connect: {
              id: data.studentId,
            },
          },
        },
        select: {
          id: true,
          className: true,
          teacherId: true,
          students: {
            select: {
              id: true,
            },
          },
        },
      });
      res.status(200).json({
        success: true,
        data: {
          id: result.id,
          className: result.className,
          teacherId: result.teacherId,
          studentIds: result.students,
        },
      });
    } catch (error) {
      console.log(error);
      return res.status(500).json({
        success: false,
        error: "internal server error",
      });
    }
  },
);

app.get("/class/:id", AuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id || Array.isArray(id)) {
      return res.status(404).json({
        success: false,
        error: "params id not found",
      });
    }
    const classdB = await db.class.findUnique({
      where: {
        id,
      },
      include: {
        students: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
    if (!classdB) {
      res.status(404).json({
        success: false,
        error: "Class not found",
      });
    }
    const studentIds = classdB?.students.map((ids) => ids);
    const student = studentIds?.some((std) => std.id === req.userId!);
    console.log("students", student);
    if (classdB?.teacherId !== req.userId && !student) {
      res.status(404).json({
        success: false,
        error: "User not found",
      });
    }
    res.status(200).json({
      success: true,
      data: {
        id: classdB?.id,
        className: classdB?.className,
        teacherId: classdB?.teacherId,
        students: classdB?.students,
      },
    });
    // if(req.role === "teacher" && classdB?.teacherId === req.userId){

    // } else if (req.role === "student" && student ){

    // } else {

    // }
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      error: "internal server error",
    });
  }
});

app.get(
  "/students",
  AuthMiddleware,
  TeacherMiddleware,
  async (req: Request, res: Response) => {
    try {
      const students = await db.user.findMany({
        where: {
          role: "student",
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });
      if (students.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Students not found",
        });
      }
      res.status(200).json({
        success: true,
        data: students,
      });
    } catch (error) {
      console.log(error);
      return res.status(500).json({
        success: false,
        error: "internal server error",
      });
    }
  },
);

app.get(
  "/class/:id/my-attendance",
  AuthMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id || Array.isArray(id)) {
        return res.status(404).json({
          success: false,
          error: "params id not found",
        });
      }
      const classdB = await db.class.findFirst({
        where: {
          id,
          students: {
            some: {
              id: req.userId!,
            },
          },
        },
      });
      if (!classdB) {
        res.status(404).json({
          success: false,
          error: "Class not found",
        });
      }
      const attendance = await db.attendance.findUnique({
        where: {
          classId_studentId: {
            classId: id,
            studentId: req.userId!,
          },
        },
        select: {
          status: true,
        },
      });
      if (!attendance) {
        return res.status(404).json({
          success: false,
          error: "Attendance not found",
        });
      }
      res.status(200).json({
        success: true,
        data: {
          classId: classdB?.id,
          status: attendance.status,
        },
      });
    } catch (error) {
      console.log(error);
      return res.status(500).json({
        success: false,
        error: "internal server error",
      });
    }
  },
);

app.post(
  "/attendance/start",
  AuthMiddleware,
  TeacherMiddleware,
  async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const { success, data } = attendanceSchema.safeParse(body);
      if (!success) {
        res.status(400).json({
          success: false,
          error: "Invalid request schema",
        });
        return;
      }
      const classdB = await db.class.findUnique({
        where: {
          id: data.classId,
        },
      });
      if (!classdB || classdB.teacherId !== req.userId) {
        res.status(403).json({
          success: false,
          error: "Forbidden, not class teacher",
        });
      }

      ((activeSession.classId = classdB?.id!),
        (activeSession.startedAt = new Date().toISOString()),
        (activeSession.attendance = {}));

      res.status(200).json({
        success: true,
        data: {
          classId: activeSession?.classId,
          startedAt: activeSession.startedAt,
        },
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({
        success: false,
        error: "internal server error",
      });
    }
  },
);

server.listen(3000, () => {
  console.log("server is running at 3000");
});
