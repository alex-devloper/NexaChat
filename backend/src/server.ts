import http from "http";
import mongoose from "mongoose";

import app from "./app";
import { connectDB } from "./config/db";
import { PORT } from "./config/env";
import { initSocket } from "./socket";

const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 60_000;

/**
 * A rotating home IP makes MongoDB Atlas refuse connections. Previously that
 * killed the whole API (and with it every call), so the server now retries
 * forever and starts listening as soon as the database is reachable.
 */
async function waitForDatabase(): Promise<void> {
  let attempt = 0;

  for (;;) {
    attempt += 1;

    try {
      await connectDB();
      return;
    } catch {
      const waitMs = Math.min(RETRY_BASE_MS * attempt, RETRY_MAX_MS);

      console.error(
        `⚠️  MongoDB not reachable (attempt ${attempt}). Retrying in ${
          waitMs / 1000
        }s.\n` +
          `    Fix: MongoDB Atlas → Network Access → "Add Current IP Address" (or 0.0.0.0/0 for local dev).`
      );

      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function start() {
  await waitForDatabase();

  const server = http.createServer(app);
  initSocket(server);

  server.listen(PORT, () => {
    console.log(`🚀 NexaChat API + Socket.IO on http://localhost:${PORT}`);

    if ((process.env.STORAGE_DRIVER || "local").toLowerCase() === "local") {
      console.log(
        "ℹ️  Media is stored on this machine (backend/uploads). For hosting use STORAGE_DRIVER=s3 or cloudinary so files survive restarts."
      );
    }
  });

  // The driver reconnects on its own; we only log so problems are visible.
  mongoose.connection.on("disconnected", () => {
    console.warn("⚠️  MongoDB disconnected — reconnecting…");
  });

  mongoose.connection.on("reconnected", () => {
    console.log("✅ MongoDB reconnected — calls and messages are live again");
  });
}

start().catch((err) => {
  console.error("❌ Server failed to start:", (err as Error).message);
  process.exit(1);
});
