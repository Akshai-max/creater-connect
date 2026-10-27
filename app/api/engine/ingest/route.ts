import { NextResponse, type NextRequest } from "next/server"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { checkBearer } from "@/lib/auth"
import { runEngine } from "@/lib/leads/engine"

export const maxDuration = 300

// POST /api/engine/ingest — push LeadInput rows from any provider.
// Auth: Authorization: Bearer ${ENGINE_WEBHOOK_SECRET}
// Body: { "leads": [ { ...LeadInput or CSV-format row } ] }  (max 2000 per call)
export async function POST(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"), process.env.ENGINE_WEBHOOK_SECRET)
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const rows = (payload as { leads?: unknown })?.leads
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: "Body must be { leads: [...] } with at least one row" }, { status: 400 })
  if (rows.length > 2000) return NextResponse.json({ error: "Max 2000 leads per request" }, { status: 413 })
  if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) return NextResponse.json({ error: "Each lead must be an object" }, { status: 400 })

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-"))
  const file = path.join(dir, "ingest.json")
  fs.writeFileSync(file, JSON.stringify(rows))
  try {
    const s = await runEngine({ provider: "file", input: file, outDir: path.join(dir, "out") })
    return NextResponse.json({
      runId: s.runId, status: s.status, durationMs: s.durationMs, inserted: s.inserted, updated: s.updated, unchanged: s.unchanged,
      qualified: s.qualified, unverified: s.unverified, rejected: s.rejected, duplicates: s.duplicates, failed: s.failed,
      errors: s.errors.slice(0, 50),
    }, { status: s.status === "succeeded" ? 200 : 500 })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
