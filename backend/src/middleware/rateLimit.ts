import rateLimit from "express-rate-limit";

const tooMany = { message: "Too many requests. Please slow down and try again." };

/** Broad safety net for every API request. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: tooMany,
});

/** Signup / password-reset style endpoints: cheap to abuse, so keep it tight. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: tooMany,
});

/** Login: brute-force protection. Successful logins are not counted. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many login attempts. Try again in a few minutes." },
});

/** Uploads write to disk, so cap them separately. */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many uploads. Please wait a moment." },
});

/** Search endpoint used to look users up by username. */
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: tooMany,
});

export const pushLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: tooMany,
});
