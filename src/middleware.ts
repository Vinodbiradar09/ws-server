import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { db } from "./lib.js";
export async function AuthMiddleware(req : Request , res : Response , next : NextFunction) {
    try {
        const token = req.cookies || req.headers;
        if(!token){
            res.status(400).json({
                success : false,
                error : "token not found",
            })
        }
        const userDecoder = jwt.verify(token , process.env.JWTSECRET!) as JwtPayload;
        if(!userDecoder){
            res.status(404).json({
                success : false,
                error : "user not found",
            })
        }
        const user = await db.user.findUnique({
            where : {
                id : userDecoder.userId,
            },
            select : {
                id : true,
                name : true,
                email : true,
                role : true,
            }
        })

        if(!user){
            return res.status(404).json({
                success : false,
                error : "user not found",
            })
        }
        req.userId = user.id,
        req.role = user.role,
        next();
                
    } catch (error) {
        console.log("error jwt" , error);
        res.status(500).json({
            success : false,
            error : "jwt error",
        })
    }
}

export async function  TeacherMiddleware(req : Request , res : Response , next : NextFunction) {
    try {
        const user = await db.user.findUnique({
            where : {
                id : req.userId!,
            }
        })
        if(user?.role !== "teacher"){
            res.status(403).json({
                success : false,
                error : 'Forbidden, teacher access required'
            })
            return;
        }
        next();
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "teacher access required",
        })
    }
}
