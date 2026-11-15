import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret, JWT_EXPIRES_IN } from "../config/env";

type TokenPayload = { userId: string };

export function signToken(userId: string): string {
  const options: jwt.SignOptions = {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  };
  return jwt.sign({ userId }, getJwtSecret(), options);
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;

  const [scheme, token] = header.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return null;

  return token.trim();
}

/**
 * Verifies the Bearer JWT and sets req.userId.
 * Every private route must use this; the client never gets to name the user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readBearerToken(req);

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as TokenPayload;

    if (!payload?.userId) {
      return res.status(401).json({ message: "Invalid token" });
    }

    req.userId = String(payload.userId);
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}
