import { NextResponse, type NextRequest } from "next/server"
import { and, desc, eq } from "drizzle-orm"
import { checkBearer } from "@/lib/auth"
import { db } from "@/lib/db"
import { agentProposals } from "@/lib/db/schema"

const STATUSES = ["pending", "approved", "rejected", "sent", "failed"]

// GET /api/agent/proposals?status=pending&runId=… — for n8n notifications/digests.
export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"), process.env.AGENT_WEBHOOK_SECRET)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const status = req.nextUrl.searchParams.get("status") ?? "pending"
  if (!STATUSES.includes(status)) return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 })
  const runId = req.nextUrl.searchParams.get("runId")
  const conds = [eq(agentProposals.status, status)]
  if (runId) conds.push(eq(agentProposals.runId, runId))
  const rows = await db.select().from(agentProposals).where(and(...conds)).orderBy(desc(agentProposals.createdAt)).limit(200)
  return NextResponse.json({ count: rows.length, proposals: rows })
}
