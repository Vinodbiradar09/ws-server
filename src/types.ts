import { z } from "zod"

export const signupSchema = z.object({
    name : z.string(),
    email : z.email(),
    password : z.string().min(6 , "the password must be mminimum six chars"),
    role : z.enum(["teacher" , "student"])
})

export const signinSchema = z.object({
    email : z.email(),
    password : z.string(),
})

export const classSchema = z.object({
    className : z.string(),
})

export const addStudent = z.object({
    studentId : z.string(),
})

export const attendanceSchema = z.object({
    classId : z.string(),
})