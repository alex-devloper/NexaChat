import dotenv from "dotenv";

dotenv.config();

/**
 * Central env access. No hardcoded fallbacks for secrets or DB URLs:
 * a missing value fails loudly at startup instead of silently using a
 * weak default.
 */
const parsedPort = Number(process.env.PORT);
export const PORT =
  Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 5000;
export const NODE_ENV = process.env.NODE_ENV || "development";

export function getMongoUri(): string {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error(
      "MONGO_URI is not set. Add it to backend/.env (see .env.example)."
    );
  }
  return uri;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Add it to backend/.env (see .env.example)."
    );
  }
  return secret;
}

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
