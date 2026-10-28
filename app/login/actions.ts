"use server"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { SESSION_COOKIE, SESSION_MAX_AGE, passwordMatches, passwordMissingInProduction, sessionToken } from "@/lib/session"

export async function login(password: string, nextPath?: string): Promise<{ error?: string } | void> {
  if (passwordMissingInProduction()) return { error: "APP_PASSWORD is not set on the server." }
  const expected = process.env.APP_PASSWORD
  if (!expected) {
    // Local dev without a password: the app is open.
    return redirect(safeNext(nextPath))
  }
  if (!passwordMatches(password, expected)) {
    return { error: "Incorrect password" }
  }
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  })
  redirect(safeNext(nextPath))
}

// Only same-site paths: "//evil.com" or "https://…" would be an open redirect.
function safeNext(nextPath?: string): string {
  return nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") && !nextPath.startsWith("/\\") ? nextPath : "/"
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
  redirect("/login")
}
