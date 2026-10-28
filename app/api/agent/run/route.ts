import { NextResponse, type NextRequest } from "next/server"
import { and, eq } from "drizzle-orm"
import { checkBearer } from "@/lib/auth"
import { db } from "@/lib/db"
import { agentProposals } from "@/lib/db/schema"
import { runAgent } from "@/lib/agent/agent"
import { AGENT_SOURCES, type AgentSource } from "@/lib/agent/config"

export const maxDuration = 300

// POST /api/agent/run — start an agent run (n8n / cron). The agent only files
// proposals; nothing is sent until a person approves them.
// Auth: Authorization: Bearer ${AGENT_WEBHOOK_SECRET}
// Body (all optional): { sources: ("leads"|"candidates"|"pipeline")[], instructions, maxProposals, includeFixtures }
export async function POST(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"), process.env.AGENT_WEBHOOK_SECRET)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    const text = await req.text()
    body = text ? JSON.parse(text) : {}
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const sources = Array.isArray(body.sources) ? body.sources.filter((s): s is AgentSource => (AGENT_SOURCES as readonly string[]).includes(s as string)) : undefined
  if (Array.isArray(body.sources) && !sources?.length) return NextResponse.json({ error: `sources must be any of ${AGENT_SOURCES.join(", ")}` }, { status: 400 })
  if (body.instructions != null && (typeof body.instructions !== "string" || body.instructions.length > 2000)) return NextResponse.json({ error: "instructions must be a string up to 2000 chars" }, { status: 400 })
  if (body.maxProposals != null && !(Number.isInteger(body.maxProposals) && (body.maxProposals as number) > 0)) return NextResponse.json({ error: "maxProposals must be a positive integer" }, { status: 400 })

  const r = await runAgent({
    sources,
    instructions: (body.instructions as string | undefined) ?? null,
    maxProposals: body.maxProposals as number | undefined,
    includeFixtures: body.includeFixtures === true,
    trigger: "api",
  })
  const base = (process.env.APP_BASE_URL || req.nextUrl.origin).replace(/\/+$/, "")
  const proposals = await db.select().from(agentProposals).where(and(eq(agentProposals.runId, r.runId), eq(agentProposals.status, "pending")))
  return NextResponse.json(
    {
      ...r,
      reviewUrl: `${base}/agent`,
      pending: proposals.map((p) => ({ id: p.id, kind: p.kind, subject: p.subjectName, action: p.action, confidence: p.confidence, rationale: p.rationale })),
    },
    { status: r.status === "failed" ? 502 : 200 },
  )
}
