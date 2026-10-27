// Input providers. Each returns raw rows for processBatch() plus cost/usage.
// Only permitted sources: files you supply, the official YouTube Data API,
// and rows already in this CRM. No scraping behind logins.
import fs from "node:fs"
import path from "node:path"
import { parse } from "csv-parse/sync"

export type ProviderRow = { row: Record<string, unknown>; ref: string }
export type ProviderResult = { rows: ProviderRow[]; costUsd: number; apiUnits: number; notes: string[] }

export class ProviderError extends Error {
  constructor(public provider: string, message: string) {
    super(`[${provider}] ${message}`)
  }
}

// ── File provider: CSV (README › CSV input format) or JSON array of LeadInput ──
export function readInputFile(file: string): ProviderResult {
  if (!fs.existsSync(file)) throw new ProviderError("file", `input not found: ${file}`)
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "")
  const base = path.basename(file)
  if (file.toLowerCase().endsWith(".json")) {
    let data: unknown
    try { data = JSON.parse(text) } catch (e) { throw new ProviderError("file", `invalid JSON in ${base}: ${(e as Error).message}`) }
    if (!Array.isArray(data)) throw new ProviderError("file", `${base} must contain a JSON array`)
    return { rows: data.map((row, i) => ({ row: row as Record<string, unknown>, ref: `${base}#${i + 1}` })), costUsd: 0, apiUnits: 0, notes: [] }
  }
  let records: Record<string, string>[]
  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: false })
  } catch (e) {
    throw new ProviderError("file", `CSV parse error in ${base}: ${(e as Error).message}`)
  }
  // Line numbers are 1-based and include the header row.
  return { rows: records.map((row, i) => ({ row, ref: `${base}:${i + 2}` })), costUsd: 0, apiUnits: 0, notes: [] }
}

// ── YouTube Data API v3 (official, quota-based, free tier) ────────────────────
// Fills activity + identity fields for known channel ids. Commercial, need and
// contact evidence still come from the merge file — the API doesn't expose them.
type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>

function isoDurationSeconds(d: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || "")
  if (!m) return 0
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0))
}

export async function fetchYouTubeActivity(
  channelIds: string[],
  opts: { apiKey: string | undefined; longformMinSeconds?: number; fetcher?: Fetcher },
): Promise<{ byChannel: Map<string, Record<string, unknown>>; apiUnits: number; errors: { ref: string; error: string }[] }> {
  if (!opts.apiKey) throw new ProviderError("youtube", "YOUTUBE_API_KEY is not set. Create one at console.cloud.google.com (YouTube Data API v3).")
  const fetcher: Fetcher = opts.fetcher ?? ((u) => fetch(u) as any)
  const longMin = opts.longformMinSeconds ?? 20 * 60
  const api = "https://www.googleapis.com/youtube/v3"
  const byChannel = new Map<string, Record<string, unknown>>()
  const errors: { ref: string; error: string }[] = []
  let units = 0

  const get = async (url: string) => {
    units += 1
    const res = await fetcher(`${url}&key=${encodeURIComponent(opts.apiKey!)}`)
    if (!res.ok) throw new ProviderError("youtube", `HTTP ${res.status}`)
    return res.json()
  }

  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50)
    const ch = await get(`${api}/channels?part=snippet,statistics,contentDetails&id=${batch.join(",")}`)
    for (const item of ch.items ?? []) {
      try {
        const uploads = item.contentDetails?.relatedPlaylists?.uploads
        const pl = uploads ? await get(`${api}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}`) : { items: [] }
        const ids: string[] = (pl.items ?? []).map((p: any) => p.contentDetails?.videoId).filter(Boolean)
        const vids = ids.length ? await get(`${api}/videos?part=snippet,contentDetails&id=${ids.join(",")}`) : { items: [] }
        const contentItems = (vids.items ?? []).map((v: any) => ({
          url: `https://www.youtube.com/watch?v=${v.id}`,
          title: v.snippet?.title ?? "",
          publishedAt: v.snippet?.publishedAt ?? "",
          isLongform: isoDurationSeconds(v.contentDetails?.duration) >= longMin,
        }))
        const langs = (vids.items ?? []).map((v: any) => (v.snippet?.defaultAudioLanguage || v.snippet?.defaultLanguage || "").split("-")[0]).filter(Boolean)
        const lang = langs.length ? mode(langs) : item.snippet?.defaultLanguage?.split("-")[0] ?? null
        byChannel.set(item.id, {
          stable_creator_id: item.id,
          primary_platform: "youtube",
          profile_url: `https://www.youtube.com/channel/${item.id}`,
          followers_or_subscribers: item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount ?? 0),
          content_items: JSON.stringify(contentItems),
          ...(lang ? { primary_language: lang } : {}),
          // Self-declared channel country; evidence URL is the channel's about page.
          ...(item.snippet?.country ? { country_iso2: item.snippet.country, country_evidence_url: `https://www.youtube.com/channel/${item.id}/about` } : {}),
          _youtube_title: item.snippet?.title,
        })
      } catch (e) {
        errors.push({ ref: `youtube:${item.id}`, error: (e as Error).message })
      }
    }
    for (const id of batch) if (!byChannel.has(id) && !errors.some((e) => e.ref === `youtube:${id}`)) errors.push({ ref: `youtube:${id}`, error: "channel not found" })
  }
  return { byChannel, apiUnits: units, errors }
}

function mode(xs: string[]): string {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
}

// Merge API activity over file rows that share a stable_creator_id. API data
// wins for activity fields because it's fetched fresh; file wins for evidence.
export function mergeYouTube(rows: ProviderRow[], byChannel: Map<string, Record<string, unknown>>): ProviderRow[] {
  return rows.map(({ row, ref }) => {
    const yt = byChannel.get(String(row.stable_creator_id ?? ""))
    if (!yt) return { row, ref }
    const { _youtube_title, ...fields } = yt
    return { row: { ...row, ...fields, source: row.source ?? "youtube_api" }, ref }
  })
}
