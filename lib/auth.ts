import { timingSafeEqual } from "node:crypto"

// Constant-time bearer check. With no secret configured, requests are allowed
// only outside production so local dev keeps working.
export function checkBearer(authHeader: string | null, secret: string | undefined, env: string | undefined = process.env.NODE_ENV): { ok: boolean; reason?: string } {
  if (!secret) return env === "production" ? { ok: false, reason: "secret not configured" } : { ok: true }
  const token = (authHeader ?? "").replace(/^Bearer\s+/i, "")
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad token" }
  return { ok: true }
}
