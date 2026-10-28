// Discovery → research CSV (README › Discovery). Output feeds `npm run engine -- --input`.
//   npm run discover-youtube -- --ids data/channel-ids.txt --out data/discovered.csv           (RSS, no key)
//   npm run discover-youtube -- --ids data/channel-ids.txt --api --out data/discovered.csv     (official API)
//   npm run discover-youtube -- --query "podcast;business coach" --regions US,GB,AU --out data/discovered.csv (API search)
// Instagram/LinkedIn backup channels come from links in the creator's own YouTube text.
// With INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_IG_USER_ID set, each Instagram handle is checked
// with the official Business Discovery API (cached 30 days in data/instagram-cache.json).
//   --no-instagram skips those lookups; --ig-delay <ms> sets the pause between them.
// Channel id file: one channel per line, optionally "UC… <country> <segment>" when
// you've confirmed them by hand; "#" starts a comment.
import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { fetchChannelsViaApi, fetchChannelsViaRss, searchChannels, toResearchRow, type DiscoveredChannel } from "../lib/leads/discovery"
import { extractSocialLinks, instagramConfig, lookupInstagram, type InstagramLookup } from "../lib/leads/social"

const { values } = parseArgs({
  options: {
    ids: { type: "string" },
    query: { type: "string" },
    regions: { type: "string", default: "US,GB,CA,AU" },
    max: { type: "string", default: "25" },
    api: { type: "boolean", default: false },
    out: { type: "string", default: "data/discovered.csv" },
    now: { type: "string" },
    "no-instagram": { type: "boolean", default: false },
    "ig-delay": { type: "string", default: "1500" },
    "ig-cache": { type: "string", default: "data/instagram-cache.json" },
  },
})

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const now = values.now ? new Date(values.now) : new Date()
  const key = process.env.YOUTUBE_API_KEY
  const hints = new Map<string, { country?: string; segment?: string }>()
  let ids: string[] = []
  let apiUnits = 0

  if (values.ids) {
    for (const line of fs.readFileSync(values.ids, "utf8").split(/\r?\n/)) {
      const [id, country, segment] = line.replace(/#.*/, "").trim().split(/\s+/)
      if (!id) continue
      ids.push(id)
      hints.set(id, { country, segment })
    }
  } else if (values.query) {
    const r = await searchChannels(values.query.split(";").map((q) => q.trim()).filter(Boolean), values.regions!.split(","), { apiKey: key, maxPerQuery: Number(values.max) })
    ids = r.channelIds
    apiUnits += r.apiUnits
  } else {
    throw new Error("pass --ids <file> or --query <q1;q2>")
  }

  let channels: DiscoveredChannel[]
  let errors: { ref: string; error: string }[]
  if (values.api || values.query) {
    const r = await fetchChannelsViaApi(ids, { apiKey: key })
    ;({ channels, errors } = r)
    apiUnits += r.apiUnits
  } else {
    ;({ channels, errors } = await fetchChannelsViaRss(ids, { delayMs: 300 }))
  }

  const ig = await instagramLookups(channels, now)
  const rows = channels.map((c) => toResearchRow(c, {
    now, countryHint: hints.get(c.channelId)?.country, segmentHint: hints.get(c.channelId)?.segment,
    instagram: ig.byChannel.get(c.channelId) ?? null,
  }))
  if (!rows.length) throw new Error(`no channels fetched (${errors.length} errors: ${errors.slice(0, 3).map((e) => `${e.ref} ${e.error}`).join("; ")})`)
  const cols = Object.keys(rows[0])
  fs.mkdirSync(path.dirname(values.out!), { recursive: true })
  fs.writeFileSync(values.out!, [cols.join(","), ...rows.map((r) => cols.map((c) => esc((r as Record<string, unknown>)[c])).join(","))].join("\n") + "\n")
  const count = (k: string) => rows.filter((r) => (r as Record<string, unknown>)[k]).length
  console.log(JSON.stringify({
    out: values.out, channels: rows.length, errors, apiUnits,
    withMonetizationEvidence: count("monetization_signal"), withNeedEvidence: count("incubrix_need"), withBusinessEmail: count("email"),
    withInstagram: count("instagram_handle"), instagramActive: count("instagram_last_active"), withLinkedIn: count("linkedin_url"),
    instagram: ig.summary,
    next: "Review the rows (review_notes column), confirm entity_type=individual and fill gaps with real evidence, then: npm run engine -- --input " + values.out,
  }, null, 2))
}

// Official Instagram Business Discovery lookups for handles the creators published.
async function instagramLookups(channels: DiscoveredChannel[], now: Date) {
  const byChannel = new Map<string, InstagramLookup>()
  const cfg = instagramConfig()
  const summary = { configured: !!cfg, looked_up: 0, from_cache: 0, found: 0, not_professional: 0, failed: 0, stopped: null as string | null }
  if (!cfg || values["no-instagram"]) return { byChannel, summary }
  const cachePath = values["ig-cache"]!
  type Entry = { at: string; result: InstagramLookup }
  let cache: Record<string, Entry> = {}
  try { cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) } catch { /* first run */ }
  const fresh = (e: Entry | undefined) => !!e && now.getTime() - new Date(e.at).getTime() < 30 * 86_400_000 && (e.result.ok || e.result.reason === "not_professional_or_missing")
  const delay = Number(values["ig-delay"])
  try {
    for (const ch of channels) {
      const handle = extractSocialLinks(ch).instagram[0]?.value
      if (!handle) continue
      let result: InstagramLookup
      if (fresh(cache[handle])) {
        result = cache[handle].result
        summary.from_cache++
      } else {
        result = await lookupInstagram(handle, cfg)
        summary.looked_up++
        if (!result.ok && result.reason === "rate_limited") {
          summary.stopped = `rate limited after ${summary.looked_up} lookups - rerun later; cached results are kept`
          break
        }
        cache[handle] = { at: now.toISOString(), result }
        if (delay) await new Promise((r) => setTimeout(r, delay))
      }
      byChannel.set(ch.channelId, result)
      if (result.ok) summary.found++
      else if (result.reason === "not_professional_or_missing") summary.not_professional++
      else summary.failed++
    }
  } catch (e) {
    summary.stopped = (e as Error).message // e.g. expired token: rows keep a CONFIRM note instead
  }
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1))
  return { byChannel, summary }
}

main().catch((e) => {
  console.error(`[discover] ${(e as Error).message}`)
  process.exitCode = 1
})
