import { createHmac, timingSafeEqual } from "node:crypto"

// Single-password sign-in. The cookie holds an HMAC of APP_PASSWORD, never the
// password itself, so a leaked cookie doesn't reveal it. Changing APP_PASSWORD
// signs everyone out.
export const SESSION_COOKIE = "crm_auth"
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export function sessionToken(password: string): string {
  return createHmac("sha256", password).update("creator-crm-session-v1").digest("hex")
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function passwordMatches(input: string, expected: string): boolean {
  // Compare fixed-length digests so the check doesn't leak the password's length.
  return safeEqual(sessionToken(input), sessionToken(expected))
}

export function isValidSession(cookie: string | undefined, expected: string): boolean {
  return !!cookie && safeEqual(cookie, sessionToken(expected))
}

/** In production the app must not run without a password. */
export function passwordMissingInProduction(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" && !env.APP_PASSWORD
}
