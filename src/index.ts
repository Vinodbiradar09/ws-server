import express, { type Request, type Response } from "express";
import { db } from "./lib.js";
import { loginSchema, signupSchema } from "./types.js";
import jwt from "jsonwebtoken";
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
        where : {
            email : data.email,
        }
    })
    if(user?.password !== data.password || !user){
        res.status(400).json({
            success : false,
            error : "Invalid email or password",
        })
    }
    const token = jwt.sign({userId : user?.id , role : user?.role} , process.env.JWTSECRET!);
    res.status(200).json({
        success : true,
        data : {
            token,
        }
    })
  } catch (error) {
    console.log(error);
    res.status(500).json({
        success : false,
        error : "internal server error",
    })
  }
});

app.get("/auth/me" , async(req : Request , res : Response)=>{
    try {
        const userId = req.userId;
        const user = await db.user.findUnique({
          where : {
            id : userId!,
          }
        })
        res.status(200).json({
          success : true,
          data : {
            id : user?.id,
            name : user?.name,
            email : user?.email,
            role : user?.role,
          }
        })

    } catch (error) {
        console.log(error);
        res.status(500).json({
          success : false,
          error : "internal server error",
        })
    }
})
