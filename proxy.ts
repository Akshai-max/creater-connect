import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE, isValidSession, passwordMissingInProduction } from "./lib/session"

// Public routes (no password required)
function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/login")) return true
  if (pathname.startsWith("/_next")) return true
  if (pathname.startsWith("/favicon")) return true
  if (pathname === "/robots.txt") return true
  if (pathname === "/sitemap.xml") return true
  // Apify webhook auths via APIFY_WEBHOOK_SECRET, not the user password
  if (pathname.startsWith("/api/apify/")) return true
  // Discovery cron auths via CRON_SECRET
  if (pathname.startsWith("/api/discover")) return true
  // Avatar proxy — must be loadable by <img> tags in any context
  if (pathname.startsWith("/api/avatar/")) return true
  // Seed-test tracking links are opened from test inboxes (no session cookie)
  if (pathname.startsWith("/api/t/")) return true
  // Engine ingest auths via ENGINE_WEBHOOK_SECRET
  if (pathname.startsWith("/api/engine/ingest")) return true
  // Agent API (n8n) auths via AGENT_WEBHOOK_SECRET
  if (pathname.startsWith("/api/agent/")) return true
  return false
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isPublic(pathname)) return NextResponse.next()

  // Never serve the CRM openly in production.
  if (passwordMissingInProduction()) {
    return new NextResponse("APP_PASSWORD is not set. Add it to the server's environment variables.", { status: 503 })
  }
  const expected = process.env.APP_PASSWORD
  if (!expected) return NextResponse.next() // local dev without a password

  if (isValidSession(req.cookies.get(SESSION_COOKIE)?.value, expected)) return NextResponse.next()

  // Redirect to login, preserving target path
  const loginUrl = new URL("/login", req.url)
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname + req.nextUrl.search)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // Run on every path except static assets and image optimizer.
  matcher: ["/((?!_next/static|_next/image).*)"],
}
