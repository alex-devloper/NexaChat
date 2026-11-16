import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";

import authRoutes from "./routes/auth";
import userRoutes from "./routes/user";
import conversationRoutes from "./routes/conversations";
import messageRoutes from "./routes/messages";
import uploadRoutes from "./routes/upload";
import pushRoutes from "./routes/push";
import { apiLimiter } from "./middleware/rateLimit";

const app = express();

app.disable("x-powered-by");

// Only behind a real proxy (production) should forwarded headers be trusted.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  // Tolerate a trailing slash or surrounding quotes pasted from a dashboard.
  .map((origin) => origin.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  helmet({
    // Media is served from this origin but displayed by the Vite/Web origin.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.use(express.json({ limit: "100kb" }));

// Static media: never let a browser sniff or execute an upload as a page.
app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "uploads"), {
    index: false,
    dotfiles: "deny",
    maxAge: "7d",
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'");
      // Media URLs are unguessable but public, so keep them out of indexes.
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    },
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/push", pushRoutes);

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

// Central error handler: never leak stack traces to the client.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number; statusCode?: number })?.status;

  if (status === 400 || (err as Error)?.message?.includes("JSON")) {
    return res.status(400).json({ message: "Invalid request body" });
  }

  console.error("unhandled error:", err);
  return res.status(500).json({ message: "Something went wrong" });
});

export default app;
