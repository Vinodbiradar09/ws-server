import { User } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      userId?: string; // attaches Prisma's User type to req
      role? : string,
    }
  }
}