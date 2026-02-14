import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { db } from "./lib.js";

export const AuthMiddleware = async( req : Request , res : Response , next : NextFunction)=>{
    try {
        const header = req.headers.authorization;
        if(!header){
            res.status(401).json({
                success : false,
                error : "Unauthorized, token missing or invalid",
            })
            return;
        }
        const [scheme , token ] = header?.split(" ");
        const { userId , role } = jwt.verify(token! , process.env.JWTSECRET!) as JwtPayload;
        const user = await db.user.findUnique({
            where : {
                id : userId,
            }
        })
        if(!user || user.role !== role){
            return res.status(404).json({
                success: false,
                error: "User not found"
            })
        }
        req.userId = user.id,
        req.role = user.role,
        next();
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "jwt error",
        })
    }
}

export const teacherMiddleware = async(req : Request , res : Response , next : NextFunction)=>{
    try {
        const { userId , role } = req;
        if( role !== "teacher"){
            res.status(403).json({
                success : false,
                error : "Forbidden, teacher access required",
            })
            return;
        }
        next();
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
}

export const studentMiddleware = async(req : Request , res : Response , next : NextFunction)=>{
    try {
        const { userId , role } = req;
        if(role !== "student"){
            res.status(403).json({
                success : false,
                error : "Student not found"
            })
            return;
        }
        next();
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success : false,
            error : "internal server error",
        })
    }
}