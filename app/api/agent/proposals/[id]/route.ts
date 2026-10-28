import { NextResponse, type NextRequest } from "next/server"
import { checkBearer } from "@/lib/auth"
import { decideProposal } from "@/app/agent/decide"

// POST /api/agent/proposals/:id — record a reviewer's decision from n8n
// (e.g. an approval button in Slack/email). A named reviewer is required:
// this endpoint exists for human decisions, not for automation to approve itself.
// Body: { decision: "approve"|"reject", reviewer: string, subject?, body?, note? }
export async function POST(req: NextRequest, ctx: RouteContext<"/api/agent/proposals/[id]">) {
  const auth = checkBearer(req.headers.get("authorization"), process.env.AGENT_WEBHOOK_SECRET)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  let b: Record<string, unknown>
  try {
    b = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (b.decision !== "approve" && b.decision !== "reject") return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 })
  if (typeof b.reviewer !== "string" || !b.reviewer.trim()) return NextResponse.json({ error: "reviewer (the person deciding) is required" }, { status: 400 })
  for (const k of ["subject", "body", "note"]) if (b[k] != null && typeof b[k] !== "string") return NextResponse.json({ error: `${k} must be a string` }, { status: 400 })
  const r = await decideProposal(id, { decision: b.decision, reviewer: b.reviewer.trim(), subject: b.subject as string | undefined, body: b.body as string | undefined, note: b.note as string | undefined })
  return NextResponse.json(r, { status: r.ok ? 200 : r.status === "missing" ? 404 : 409 })
}
