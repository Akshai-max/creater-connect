import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { candidates, creators } from "@/lib/db/schema"
import { sql } from "drizzle-orm"

// Receives Apify webhook with newly-scraped candidates.
// Expected payload shape:
// { source: string, sourceDetail?: string, candidates: [{ handle, fullName, followers, engagementRate, email, location, bio, externalUrl, nicheRelevant, isUS, rateBand, fitScore, fitReasoning }] }
//
// Auth: simple shared-secret in `Authorization: Bearer ${APIFY_WEBHOOK_SECRET}`

export async function POST(req: NextRequest) {
  const expected = process.env.APIFY_WEBHOOK_SECRET
  if (expected) {
    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.replace(/^Bearer\s+/i, "")
    if (token !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!Array.isArray(payload?.candidates)) {
    return NextResponse.json({ error: "Missing candidates array" }, { status: 400 })
  }

  // Build a lowercase-handle dedup set against existing creators + candidates
  const existingCreators = await db.select({ handle: creators.handle }).from(creators)
  const existingCandidates = await db.select({ handle: candidates.handle }).from(candidates)
  const seen = new Set([...existingCreators, ...existingCandidates]
    .map((r) => (r.handle ?? "").toLowerCase().replace("@", "")))

  const inserted: string[] = []
  const skipped: string[] = []

  for (const c of payload.candidates) {
    const handle = String(c.handle ?? "").trim()
    if (!handle) { skipped.push("(no handle)"); continue }
    const key = handle.toLowerCase().replace("@", "")
    if (seen.has(key)) { skipped.push(handle); continue }
    seen.add(key)

    const id = `cand_${key}_${Date.now().toString(36).slice(-4)}`
    try {
      await db.insert(candidates).values({
        id,
        handle: handle.startsWith("@") ? handle : `@${handle}`,
        platform: c.platform ?? "IG",
        fullName: c.fullName ?? null,
        followers: c.followers ?? null,
        engagementRate: c.engagementRate ?? null,
        email: c.email ?? null,
        location: c.location ?? null,
        bio: c.bio ?? null,
        externalUrl: c.externalUrl ?? null,
        source: payload.source ?? "apify",
        sourceDetail: payload.sourceDetail ?? c.sourceDetail ?? null,
        nicheRelevant: c.nicheRelevant ?? null,
        isUS: c.isUS ?? null,
        rateBand: c.rateBand ?? null,
        fitScore: c.fitScore ?? null,
        fitReasoning: c.fitReasoning ?? null,
        status: "pending",
      } as any)
      inserted.push(handle)
    } catch (e) {
      skipped.push(`${handle} (db error)`)
    }
  }

  return NextResponse.json({
    inserted: inserted.length,
    skipped: skipped.length,
    insertedHandles: inserted,
    skippedHandles: skipped,
  })
}

export async function GET() {
  // Health check
  const counts = await db.select({ c: sql<number>`count(*)` }).from(candidates)
  return NextResponse.json({ ok: true, candidatesInDb: counts[0]?.c ?? 0 })
}
