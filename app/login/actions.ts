"use server"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

const COOKIE_NAME = "crm_auth"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export async function login(password: string, nextPath?: string): Promise<{ error?: string } | void> {
  const expected = process.env.APP_PASSWORD
  if (!expected) {
    // No password configured — anyone can sign in
    return redirect(nextPath || "/")
  }
  if (password !== expected) {
    return { error: "Incorrect password" }
  }
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, password, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  })
  redirect(nextPath || "/")
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
  redirect("/login")
}
