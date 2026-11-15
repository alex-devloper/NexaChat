import "express";

declare global {
  namespace Express {
    interface Request {
      /** Set by middleware/auth.ts after a valid Bearer token is verified. */
      userId?: string;
    }
  }
}

export {};
