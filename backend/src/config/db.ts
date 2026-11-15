import mongoose from "mongoose";
import { getMongoUri } from "./env";

/**
 * Single source of truth for the Mongo connection.
 * server.ts must call connectDB() instead of using a hardcoded URI.
 */
export async function connectDB(): Promise<void> {
  const uri = getMongoUri();

  mongoose.set("strictQuery", true);

  console.log("⏳ Connecting to MongoDB...");

  try {
    // Fail with a clear error instead of hanging forever.
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", (err as Error).message);
    throw err;
  }
}
