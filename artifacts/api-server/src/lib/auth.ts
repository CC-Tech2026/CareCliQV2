import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Verify an HS256 JWT issued by the Python backend (signed with SESSION_SECRET).
 * Returns the decoded payload or null when the token is missing/invalid/expired.
 * Implemented with the Node crypto module so no extra dependency is required.
 */
export function verifyHs256Jwt(
  token: string,
  secret: string,
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = base64UrlDecode(signatureB64);
  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  const exp = payload["exp"];
  if (typeof exp === "number" && Date.now() / 1000 >= exp) {
    return null;
  }

  return payload;
}

/**
 * Express middleware that requires a valid backend-issued JWT and attaches the
 * authenticated user id (the token `sub` claim) to `req.userId`.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server authentication is not configured" });
    return;
  }

  const authHeader = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const payload = verifyHs256Jwt(match[1], secret);
  const sub = payload?.["sub"];
  if (!payload || (typeof sub !== "string" && typeof sub !== "number")) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  req.userId = String(sub);
  next();
}
