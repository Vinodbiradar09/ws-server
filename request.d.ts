declare namespace Express {
    export interface Request {
        userId? : string,
        role? : "teacher" | "student"
    }
}