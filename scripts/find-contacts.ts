// Business contacts from creators' own websites (lib/leads/website-contacts.ts), for leads that have
// no email yet.
//   npm run find-contacts -- --in data/discovered-2026-10-29.csv [--limit 30] [--dry-run]
// Per lead: 1 YouTube unit (the newest video descriptions, for the links the creator shares and
// when they last shared them), then a few pages on the sites linked there, honouring robots.txt.
// A found email goes into the empty email columns with the page as evidence; an existing email is
// never replaced. Every lead's outcome is cached in data/contact-finder-cache.json so it isn't
// looked up again for --recheck-days. Leads already rejected for other reasons are skipped: a
// contact wouldn't qualify them. Ends with a JSON summary (engine-cycle reads it).
import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { parse } from "csv-parse/sync"
import { eq } from "drizzle-orm"
import { csvEscape } from "../lib/leads/export"
import { Crawler, applyWebsiteContact, findWebsiteContact, type VideoText } from "../lib/leads/website-contacts"

const { values } = parseArgs({
  options: {
    in: { type: "string", default: "data/discovered-2026-10-29.csv" },
    limit: { type: "string", default: "30" },
    videos: { type: "string", default: "15" },
    "recheck-days": { type: "string", default: "30" },
    cache: { type: "string", default: "data/contact-finder-cache.json" },
    "dry-run": { type: "boolean", default: false },
  },
})

type Row = Record<string, string>
type CacheEntry = { at: string; found: string | null; reason: string }

async function recentVideos(channelId: string, apiKey: string, max: number): Promise<VideoText[]> {
  if (!/^UC[\w-]{22}$/.test(channelId)) return []
  const u = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=${max}&playlistId=UU${channelId.slice(2)}&key=${apiKey}`
  const r = await fetch(u, { signal: AbortSignal.timeout(15_000) })
  if (r.status === 404) return []
  if (!r.ok) throw new Error(`YouTube playlistItems HTTP ${r.status}`)
  const j = (await r.json()) as { items?: { snippet: { description?: string; publishedAt?: string; resourceId?: { videoId?: string } } }[] }
  return (j.items ?? []).map((i) => ({
    url: `https://www.youtube.com/watch?v=${i.snippet.resourceId?.videoId ?? ""}`,
    description: i.snippet.description ?? "",
    publishedAt: i.snippet.publishedAt ?? "",
  }))
}

// Lead statuses from the database, so leads rejected for other reasons are skipped.
async function statuses(): Promise<Map<string, string>> {
  try {
    const { db } = await import("../lib/db")
    const { leads } = await import("../lib/db/schema")
    const rows = await db.select({ key: leads.identityKey, status: leads.candidateStatus }).from(leads).where(eq(leads.isFixture, false))
    return new Map(rows.map((r) => [String(r.key).replace(/^youtube:/, ""), r.status]))
  } catch (e) {
    console.warn(`[contacts] couldn't read lead statuses (${(e as Error).message.slice(0, 80)}); checking every lead`)
    return new Map()
  }
}

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not set")
  const file = values.in!
  const rows = parse(fs.readFileSync(file, "utf8"), { columns: true, skip_empty_lines: true }) as Row[]
  const cols = Object.keys(rows[0] ?? {})
  for (const c of ["email", "email_evidence_url", "email_last_active", "email_source", "email_business_use", "email_quote", "review_notes"]) if (!cols.includes(c)) cols.push(c)
  let cache: Record<string, CacheEntry> = {}
  try { cache = JSON.parse(fs.readFileSync(values.cache!, "utf8")) } catch { /* first run */ }
  const saveCache = () => { if (values["dry-run"]) return; fs.mkdirSync(path.dirname(values.cache!), { recursive: true }); fs.writeFileSync(values.cache!, JSON.stringify(cache, null, 1)) }
  const saveCsv = () => { if (!values["dry-run"]) fs.writeFileSync(file, [cols.join(","), ...rows.map((r) => cols.map((c) => csvEscape(r[c] ?? "")).join(","))].join("\n") + "\n") }

  const status = await statuses()
  const now = Date.now()
  const fresh = (id: string) => { const c = cache[id]; return c && now - Date.parse(c.at) < Number(values["recheck-days"]) * 86_400_000 }
  const okEntity = (r: Row) => ["individual", "needs_review", ""].includes((r.entity_type ?? "").toLowerCase())
  const todo = rows
    .filter((r) => r.stable_creator_id && !(r.email ?? "").trim() && okEntity(r) && status.get(r.stable_creator_id) !== "rejected" && !fresh(r.stable_creator_id))
    // Confirmed individuals first, then leads the engine has already scored as unverified.
    .sort((a, b) => Number(b.entity_type === "individual") - Number(a.entity_type === "individual")
      || Number(status.get(b.stable_creator_id) === "unverified") - Number(status.get(a.stable_creator_id) === "unverified"))
  const limit = Number(values.limit)
  const stats = { rows: rows.length, eligible: todo.length, checked: 0, found: 0, business: 0, withDate: 0, noSite: 0, units: 0, pages: 0, errors: 0 }
  console.log(`[contacts] ${todo.length} leads without an email to look up; checking ${Math.min(limit, todo.length)}`)

  const crawler = new Crawler()
  for (const row of todo.slice(0, limit)) {
    const id = row.stable_creator_id
    try {
      const videos = await recentVideos(id, apiKey, Number(values.videos))
      stats.units++
      const r = await findWebsiteContact({ channelDescription: row.channel_description ?? "", videos, crawler, creatorName: row.creator_name ?? "" })
      stats.checked++
      if (r.sites.length === 0) stats.noSite++
      cache[id] = { at: new Date().toISOString(), found: r.contact?.email ?? null, reason: r.reason }
      if (r.contact && applyWebsiteContact(row, r.contact)) {
        stats.found++
        if (r.contact.businessUse) stats.business++
        if (r.contact.lastActive) stats.withDate++
        console.log(`  ${row.creator_name}: ${r.contact.email}${r.contact.businessUse ? " (business)" : ""} from ${r.contact.pageUrl}`)
      }
    } catch (e) {
      stats.errors++
      console.log(`  ${row.creator_name}: error ${(e as Error).message.slice(0, 120)}`)
      if (/YouTube .*HTTP 403/.test((e as Error).message)) break // quota used up
    }
    if (stats.checked % 10 === 0) { saveCache(); saveCsv() }
  }
  stats.pages = crawler.pages
  saveCache()
  saveCsv()
  console.log(JSON.stringify({ out: values["dry-run"] ? null : file, ...stats }, null, 2))
}

main().catch((e) => {
  console.error(`[contacts] ${(e as Error).message}`)
  process.exitCode = 1
})
