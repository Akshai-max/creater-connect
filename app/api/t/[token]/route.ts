import { NextResponse, type NextRequest } from "next/server"
import { clickByToken } from "@/lib/leads/seed-repo"

// Seed-test tracking link: logs a click event, then redirects to the target.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/t/[token]">) {
  const { token } = await ctx.params
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return new NextResponse("Not found", { status: 404 })
  const target = await clickByToken(token)
  if (!target) return new NextResponse("Not found", { status: 404 })
  return NextResponse.redirect(target.startsWith("http") ? target : new URL(target, req.url))
}
