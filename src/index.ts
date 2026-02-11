import express, { type Request, type Response } from "express";
import { db } from "./lib.js";
import {
  addStudent,
  attendanceSchema,
  classSchema,
  loginSchema,
  signupSchema,
} from "./types.js";
import jwt from "jsonwebtoken";
import { AuthMiddleware, TeacherMiddleware } from "./middleware.js";
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const activeSession: {
  classId?: string;
  startedAt?: string;
  attendance?: {};
} = {};

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
      if(classdb?.teacherId !== req.userId){
        return res.status(403).json({
          success: false,
          error: "Forbidden: not class teacher",
        });
      }
      const student = await db.user.findUnique({
        where : {
          id : data.studentId,
        }
      })
      if(!student || student.role !== "student"){
        return res.status(404).json({
          success : false,
          error : "Student not found",
        })
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
    console.log("students" , student);
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
        where : {
          classId_studentId : {
            classId : id,
            studentId : req.userId!,
          }
        },
        select : {
          status : true
        }
      })
      if(!attendance){
        return res.status(404).json({
          success : false,
          error : "Attendance not found",
        })
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
        where : {
          id : data.classId,
        }
      })
      if(!classdB || classdB.teacherId !== req.userId){
        res.status(403).json({
          success : false,
          error : "Forbidden, not class teacher"
        })
      }

      activeSession.classId = classdB?.id!,
      activeSession.startedAt = new Date().toISOString(),
      activeSession.attendance = {};

      res.status(200).json({
        success : true,
        data : {
          classId : classdB?.id,
          startedAt : activeSession.startedAt,
        }
      })

    } catch (error) {
      console.log(error);
      res.status(500).json({
        success : false,
        error : "internal server error",
      })
    }
  },
);

app.listen(3000 , ()=>{
  console.log("server is running at 3000");
})