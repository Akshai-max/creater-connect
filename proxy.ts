import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const COOKIE_NAME = "crm_auth"

// Public routes (no password required)
function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/login")) return true
  if (pathname.startsWith("/_next")) return true
  if (pathname.startsWith("/favicon")) return true
  if (pathname === "/robots.txt") return true
  if (pathname === "/sitemap.xml") return true
  // Apify webhook auths via APIFY_WEBHOOK_SECRET, not the user password
  if (pathname.startsWith("/api/apify/")) return true
  // Discovery cron auths via CRON_SECRET / x-vercel-cron header
  if (pathname.startsWith("/api/discover")) return true
  // Avatar proxy — must be loadable by <img> tags in any context
  if (pathname.startsWith("/api/avatar/")) return true
  // Seed-test tracking links are opened from test inboxes (no session cookie)
  if (pathname.startsWith("/api/t/")) return true
  // Engine ingest auths via ENGINE_WEBHOOK_SECRET
  if (pathname.startsWith("/api/engine/ingest")) return true
  return false
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isPublic(pathname)) return NextResponse.next()

  const expected = process.env.APP_PASSWORD
  if (!expected) {
    // No password set → app is open. Allow through with a console hint in dev.
    return NextResponse.next()
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value
  if (cookie === expected) return NextResponse.next()

  // Redirect to login, preserving target path
  const loginUrl = new URL("/login", req.url)
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname + req.nextUrl.search)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // Run on every path except static assets and image optimizer.
  matcher: ["/((?!_next/static|_next/image).*)"],
}
