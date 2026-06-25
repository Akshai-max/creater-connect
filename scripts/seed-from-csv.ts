// Combined seed for first-time setup.
// Adds a few synthetic sample candidates so the UI isn't empty, and OPTIONALLY
// imports creators from a CSV if one is present (see CSV_PATH / README).
// Idempotent: re-running doesn't dup; existing rows get updated.
// NOTE: the sample data below is entirely fictional. Do not commit real
// creator names, emails, or handles to this (public) repo.
import { db } from "../lib/db"
import { creators, candidates } from "../lib/db/schema"
import { sql } from "drizzle-orm"
import { parse } from "csv-parse/sync"
import fs from "node:fs"
import path from "node:path"

// Optional CSV import. Point CSV_PATH at your own export, or drop a file named
// seed-creators.csv in the project root. If absent, only the sample candidates seed.
const CSV_PATH = process.env.CSV_PATH || path.join(process.cwd(), "seed-creators.csv")

function lifecycleToStage(lifecycle: string, notes: string): string {
  const n = (notes || "").toLowerCase()
  if (n.includes("not happy with the pay") || n.includes("went cold")) return "Cold"
  if (n.includes("doesn't meet deadlines") || n.includes("unresponsive")) return "Cold"
  if (lifecycle === "Past hire") return "Past Hire"
  if (lifecycle === "Prospect") return "Lead"
  if (lifecycle === "Active") return "Briefed"
  return "Lead"
}
const parseInt0 = (s: any) => { if (!s) return null; const c = String(s).replace(/[$,\s]/g, "").replace(/^-$/, ""); if (!c) return null; const n = parseInt(c, 10); return isNaN(n) ? null : n }
const parseBool = (s: any) => { if (!s) return null; const v = String(s).toLowerCase().trim(); if (v === "yes" || v === "true") return true; if (v === "no" || v === "false") return false; return null }
const clean = (s: any) => { if (!s) return null; const t = String(s).trim(); if (!t || t === "-") return null; return t }

// Fictional sample candidates — placeholder data only. Replace freely.
const sampleCandidates = [
  { id: "cand_demo_1", handle: "@demo.creator", platform: "IG", fullName: "Demo Creator (sample)", followers: 8200, engagementRate: 6.4, email: "creator+demo1@example.com", location: "Austin, TX", bio: "UGC creator for brands | sample data", externalUrl: "https://example.com/demo1", source: "hashtag", sourceDetail: "#ugccreator", nicheRelevant: true, isUS: true, rateBand: "$50-$200", fitScore: 8.0, fitReasoning: "Sample candidate — micro UGC creator, healthy engagement." },
  { id: "cand_demo_2", handle: "@sample.reviews", platform: "YT", fullName: "Sample Reviewer (sample)", followers: 42000, engagementRate: 3.1, email: "creator+demo2@example.com", location: "Seattle, WA", bio: "Long-form product reviews | sample data", externalUrl: "https://example.com/demo2", source: "hashtag", sourceDetail: "#productreview", nicheRelevant: true, isUS: true, rateBand: "$300-$900", fitScore: 7.5, fitReasoning: "Sample candidate — long-form reviewer, mid-tier reach." },
  { id: "cand_demo_3", handle: "@example.expert", platform: "IG", fullName: "Sample Expert (sample)", followers: 3100, engagementRate: 5.0, email: null, location: "New York, NY", bio: "Industry expert | sample data", externalUrl: "https://example.com/demo3", source: "hashtag", sourceDetail: "#expertadvice", nicheRelevant: true, isUS: true, rateBand: "Authority/Endorsement", fitScore: 8.8, fitReasoning: "Sample candidate — credentialed authority/expert persona." },
  { id: "cand_demo_4", handle: "@maybe.fit", platform: "IG", fullName: "Maybe Creator (sample)", followers: 1500, engagementRate: 1.2, email: "creator+demo4@example.com", location: "Phoenix, AZ", bio: "Lifestyle | sample data", externalUrl: "https://example.com/demo4", source: "hashtag", sourceDetail: "#contentcreator", nicheRelevant: false, isUS: true, rateBand: "$50-$200", fitScore: 5.0, fitReasoning: "Sample candidate — borderline fit, low engagement." },
]

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Add it to .env.local first.")
    process.exit(1)
  }
  console.log("Seeding to:", new URL(process.env.DATABASE_URL).host)

  // Sample candidates first (no dependencies)
  let candCount = 0
  for (const c of sampleCandidates) {
    try {
      await db.insert(candidates).values({ ...c, status: "pending" } as any).onConflictDoNothing()
      candCount++
    } catch (e) { console.error(`Candidate ${c.handle} failed:`, (e as Error).message) }
  }
  console.log(`✅ Sample candidates: ${candCount}`)

  // CSV import (optional)
  if (!fs.existsSync(CSV_PATH)) {
    console.warn(`⚠ CSV not found at ${CSV_PATH} — skipping creator import`)
    console.warn(`  Set CSV_PATH env var to override, or upload manually later`)
    return
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(fs.readFileSync(CSV_PATH))
  const rows: any[] = parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true, bom: true })
  const valid = rows.filter((r) => (r.creator_id || "").trim().match(/^CR\d+/i))
  console.log(`Importing ${valid.length} creators from CSV…`)

  const counts: Record<string, number> = {}
  for (const r of valid) {
    const id = r.creator_id.trim().toUpperCase()
    const lifecycle = clean(r["Lifecycle status"]) || "Prospect"
    const flagNotes = clean(r["Flag notes"]) || ""
    const stage = lifecycleToStage(lifecycle, flagNotes)
    counts[stage] = (counts[stage] ?? 0) + 1
    const phoneMatch = flagNotes.match(/Phone:\s*([0-9()\-\s]+)/i)
    const phone = phoneMatch ? phoneMatch[1].trim() : null
    const row: any = {
      id,
      name: clean(r.Name) || id,
      handle: clean(r.Handle),
      platform: clean(r.Platform),
      profileUrl: clean(r["Profile URL"]),
      followers: parseInt0(r["Follower count"]),
      email: clean(r.Email),
      phone,
      location: clean(r.Location),
      source: clean(r.Source),
      persona: clean(r.Persona),
      niche: clean(r["Niche"]),
      audience: clean(r["Audience"]),
      ageBracket: clean(r["Age bracket"]),
      languages: clean(r.Languages),
      contentStyle: clean(r["Content style"]),
      rateCeiling: parseInt0(r["Rate ceiling ($)"]),
      ratePaid: parseInt0(r["Rate paid to date ($)"]),
      usageRights: clean(r["Usage rights default"]),
      exclusivity: clean(r.Exclusivity),
      campaignsActive: parseInt0(r["Campaigns active"]) ?? 0,
      campaignsCompleted: parseInt0(r["Campaigns completed"]) ?? 0,
      avgGrade: clean(r["Avg grade"]),
      repurposeEligible: parseBool(r["Repurpose eligible"]),
      flagNotes,
      lastContactDate: clean(r["Last contact date"]),
      lifecycleStatus: lifecycle,
      stage,
      stageChangedAt: new Date().toISOString(),
      createdAt: clean(r["Created date"]) || new Date().toISOString(),
      owner: clean(r.Owner) || "You",
    }
    try {
      await db.insert(creators).values(row).onConflictDoUpdate({
        target: creators.id,
        set: {
          name: row.name, handle: row.handle, platform: row.platform, profileUrl: row.profileUrl,
          followers: row.followers, email: row.email, phone: row.phone, location: row.location,
          source: row.source, persona: row.persona, niche: row.niche, audience: row.audience,
          ageBracket: row.ageBracket, languages: row.languages, contentStyle: row.contentStyle,
          rateCeiling: row.rateCeiling, ratePaid: row.ratePaid, usageRights: row.usageRights,
          exclusivity: row.exclusivity, campaignsActive: row.campaignsActive,
          campaignsCompleted: row.campaignsCompleted, avgGrade: row.avgGrade,
          repurposeEligible: row.repurposeEligible, flagNotes: row.flagNotes,
          lastContactDate: row.lastContactDate, lifecycleStatus: row.lifecycleStatus,
          // Don't override stage if already manually set to something other than "Lead"
          stage: sql`CASE WHEN ${creators.stage} IS NULL OR ${creators.stage} = 'Lead' THEN ${row.stage} ELSE ${creators.stage} END`,
        },
      })
    } catch (e) { console.error(`Failed ${id}:`, (e as Error).message) }
  }

  console.log("\n✅ Seed complete. Stage distribution:")
  for (const [s, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${s.padEnd(15)} ${n}`)
  }
}
main()
