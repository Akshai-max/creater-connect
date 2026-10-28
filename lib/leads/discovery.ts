// Discovery: find candidate creators and pre-fill a research row from what the
// creator publishes themselves. Two sources, both permitted:
//   - YouTube's public per-channel RSS feed (no key; last 15 uploads with exact
//     dates and descriptions), and
//   - the official YouTube Data API v3 (search by topic + region; needs a key).
// Signals (sponsor reads, offers, a business email) are extracted with plain
// rules from the creator's own text, and each one keeps the URL it came from.
// Nothing is inferred beyond that: entity type and need start as "needs review"
// unless the creator's own words state them, so a discovered row is never
// qualified until a person (or a stated signal) confirms it.
import { ProviderError } from "./providers"

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }>
const defaultFetcher: Fetcher = (u) => fetch(u, { headers: { "user-agent": "creator-crm-lead-engine/1.0 (+research)" } }) as any

export type DiscoveredVideo = { url: string; title: string; publishedAt: string; description: string; isLongform: boolean | null }
export type DiscoveredChannel = {
  channelId: string
  title: string
  channelUrl: string
  description: string // channel description (API) or "" (RSS has none)
  country: string | null // self-declared (API only)
  subscribers: number | null
  videos: DiscoveredVideo[]
  source: "youtube_rss" | "youtube_api"
}

// ── RSS (no key) ─────────────────────────────────────────────────────────────
const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&")
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? unescapeXml(m[1].trim()) : ""
}

export function parseYouTubeRss(xml: string, channelId: string): DiscoveredChannel {
  const head = xml.split("<entry>")[0]
  const videos = xml
    .split("<entry>")
    .slice(1)
    .map((e) => {
      const id = tag(e, "yt:videoId")
      return {
        url: `https://www.youtube.com/watch?v=${id}`,
        title: tag(e, "title"),
        publishedAt: tag(e, "published"),
        description: tag(e, "media:description"),
        // RSS has no duration. Shorts are flagged by URL in some feeds; otherwise unknown.
        isLongform: /\/shorts\//.test(e) ? false : null,
      }
    })
    .filter((v) => v.url && v.publishedAt)
  return {
    channelId,
    title: tag(head, "title"),
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    description: "",
    country: null,
    subscribers: null,
    videos,
    source: "youtube_rss",
  }
}

export async function fetchChannelsViaRss(channelIds: string[], opts: { fetcher?: Fetcher; delayMs?: number } = {}) {
  const fetcher = opts.fetcher ?? defaultFetcher
  const channels: DiscoveredChannel[] = []
  const errors: { ref: string; error: string }[] = []
  for (const id of channelIds) {
    try {
      const res = await fetcher(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`)
      if (!res.ok) throw new ProviderError("youtube_rss", `HTTP ${res.status}`)
      channels.push(parseYouTubeRss(await res.text(), id))
    } catch (e) {
      errors.push({ ref: `youtube_rss:${id}`, error: (e as Error).message })
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs)) // be polite
  }
  return { channels, errors }
}

// ── Official API (key) ───────────────────────────────────────────────────────
// search.list costs 100 quota units per call (free quota: 10,000/day).
export async function searchChannels(
  queries: string[],
  regions: string[],
  opts: { apiKey: string | undefined; maxPerQuery?: number; fetcher?: Fetcher },
): Promise<{ channelIds: string[]; apiUnits: number }> {
  if (!opts.apiKey) throw new ProviderError("youtube", "YOUTUBE_API_KEY is not set. Create one at console.cloud.google.com (YouTube Data API v3).")
  const fetcher = opts.fetcher ?? defaultFetcher
  const ids = new Set<string>()
  let units = 0
  for (const q of queries) {
    for (const region of regions) {
      const u =
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=${Math.min(opts.maxPerQuery ?? 25, 50)}` +
        `&relevanceLanguage=en&regionCode=${encodeURIComponent(region)}&q=${encodeURIComponent(q)}&key=${encodeURIComponent(opts.apiKey)}`
      units += 100
      const res = await fetcher(u)
      if (!res.ok) throw new ProviderError("youtube", `search HTTP ${res.status}`)
      for (const it of (await res.json()).items ?? []) if (it.id?.channelId) ids.add(it.id.channelId)
    }
  }
  return { channelIds: [...ids], apiUnits: units }
}

export async function fetchChannelsViaApi(channelIds: string[], opts: { apiKey: string | undefined; longformMinSeconds?: number; fetcher?: Fetcher }) {
  if (!opts.apiKey) throw new ProviderError("youtube", "YOUTUBE_API_KEY is not set.")
  const fetcher = opts.fetcher ?? defaultFetcher
  const api = "https://www.googleapis.com/youtube/v3"
  const longMin = opts.longformMinSeconds ?? 20 * 60
  let units = 0
  const get = async (url: string) => {
    units += 1
    const res = await fetcher(`${url}&key=${encodeURIComponent(opts.apiKey!)}`)
    if (!res.ok) throw new ProviderError("youtube", `HTTP ${res.status}`)
    return res.json()
  }
  const channels: DiscoveredChannel[] = []
  const errors: { ref: string; error: string }[] = []
  for (let i = 0; i < channelIds.length; i += 50) {
    const ch = await get(`${api}/channels?part=snippet,statistics,contentDetails&id=${channelIds.slice(i, i + 50).join(",")}`)
    for (const item of ch.items ?? []) {
      try {
        const uploads = item.contentDetails?.relatedPlaylists?.uploads
        const pl = uploads ? await get(`${api}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}`) : { items: [] }
        const vidIds: string[] = (pl.items ?? []).map((p: any) => p.contentDetails?.videoId).filter(Boolean)
        const vids = vidIds.length ? await get(`${api}/videos?part=snippet,contentDetails&id=${vidIds.join(",")}`) : { items: [] }
        channels.push({
          channelId: item.id,
          title: item.snippet?.title ?? "",
          channelUrl: `https://www.youtube.com/channel/${item.id}`,
          description: item.snippet?.description ?? "",
          country: item.snippet?.country ?? null,
          subscribers: item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount ?? 0),
          videos: (vids.items ?? []).map((v: any) => ({
            url: `https://www.youtube.com/watch?v=${v.id}`,
            title: v.snippet?.title ?? "",
            publishedAt: v.snippet?.publishedAt ?? "",
            description: v.snippet?.description ?? "",
            isLongform: durationSeconds(v.contentDetails?.duration) >= longMin,
          })),
          source: "youtube_api",
        })
      } catch (e) {
        errors.push({ ref: `youtube:${item.id}`, error: (e as Error).message })
      }
    }
  }
  return { channels, errors, apiUnits: units }
}

function durationSeconds(d: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || "")
  return m ? +(m[1] || 0) * 86400 + +(m[2] || 0) * 3600 + +(m[3] || 0) * 60 + +(m[4] || 0) : 0
}

// ── Signal extraction (rules over the creator's own text) ────────────────────
export type Signal = { value: string; evidenceUrl: string; quote: string }

const MONETIZATION_RULES: { signal: string; re: RegExp }[] = [
  { signal: "sponsorship", re: /\b(sponsored by|thanks? (?:to )?\S+(?: \S+)? for sponsoring|today'?s sponsor|this (?:episode|video) is (?:brought to you|sponsored) by|partner(?:ed)? with)\b/i },
  { signal: "affiliate", re: /\b(affiliate link|use (?:my )?code\s+\w+|promo code|discount code|i (?:may )?earn a (?:small )?commission)\b/i },
  { signal: "membership", re: /\b(patreon\.com\/|join this channel|become a (?:member|patron)|buymeacoffee\.com|ko-fi\.com\/)\b/i },
  { signal: "course", re: /\b(my (?:new |online )?course|enroll (?:now|today)|masterclass|cohort)\b/i },
  { signal: "subscription", re: /\b(substack\.com|newsletter)\b/i },
  { signal: "service", re: /\b(book a (?:free )?(?:call|consult|session)|work with me|coaching program|1:1 coaching|hire me)\b/i },
  { signal: "product", re: /\b(my (?:new )?book|merch|shop (?:my|the) |preset pack|templates? (?:shop|store))\b/i },
]

// Need: only when the creator states it. "Hiring an editor" is the common public form.
const NEED_RULES: { need: string; re: RegExp }[] = [
  { need: "editing", re: /\b(hiring (?:a |an )?(?:video |podcast )?editor|looking for (?:a |an )?(?:video |podcast )?editor|editor wanted|need(?:ing)? (?:a |an )?editor)\b/i },
  { need: "repurposing", re: /\b(hiring (?:a |an )?(?:shorts?|clips?) (?:editor|creator)|looking for (?:a |an )?(?:shorts?|clips?) editor)\b/i },
  { need: "team_workflow", re: /\b(we'?re hiring|join (?:my|our) team|now hiring)\b/i },
]

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const BUSINESS_RE = /(business|inquir|enquir|sponsor|collab|partnership|booking|press|media|contact)/i

const snippet = (text: string, idx: number, len: number) =>
  text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + len + 60)).replace(/\s+/g, " ").trim()

export function extractSignals(ch: DiscoveredChannel) {
  // Newest first so evidence is the most recent example.
  const texts = [
    ...[...ch.videos].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map((v) => ({ url: v.url, text: `${v.title}\n${v.description}`, at: v.publishedAt })),
    ...(ch.description ? [{ url: `${ch.channelUrl}/about`, text: ch.description, at: null as string | null }] : []),
  ]
  const monetization: Signal[] = []
  const need: Signal[] = []
  const emails: (Signal & { businessUse: boolean; lastSeen: string | null })[] = []
  for (const t of texts) {
    for (const r of MONETIZATION_RULES) {
      const m = r.re.exec(t.text)
      if (m && !monetization.some((s) => s.value === r.signal)) monetization.push({ value: r.signal, evidenceUrl: t.url, quote: snippet(t.text, m.index, m[0].length) })
    }
    for (const r of NEED_RULES) {
      const m = r.re.exec(t.text)
      if (m && !need.some((s) => s.value === r.need)) need.push({ value: r.need, evidenceUrl: t.url, quote: snippet(t.text, m.index, m[0].length) })
    }
    for (const m of t.text.matchAll(EMAIL_RE)) {
      const value = m[0].replace(/\.$/, "").toLowerCase()
      if (/\.(png|jpe?g|gif)$/.test(value) || /example\.com$/.test(value)) continue
      const around = snippet(t.text, m.index ?? 0, value.length)
      const prev = emails.find((e) => e.value === value)
      if (prev) {
        if (t.at && (!prev.lastSeen || t.at > prev.lastSeen)) prev.lastSeen = t.at
        continue
      }
      emails.push({ value, evidenceUrl: t.url, quote: around, businessUse: BUSINESS_RE.test(around), lastSeen: t.at })
    }
  }
  return { monetization, need, emails }
}

// ── Research row in the engine's CSV input format ────────────────────────────
export function toResearchRow(ch: DiscoveredChannel, opts: { now: Date; segmentHint?: string; countryHint?: string | null }) {
  const sig = extractSignals(ch)
  const email = sig.emails.find((e) => e.businessUse) ?? null
  const mon = sig.monetization[0] ?? null
  const need = sig.need[0] ?? null
  const looksPodcast = ch.videos.filter((v) => /\b(podcast|episode|ep\.?\s?\d+|#\d+)\b/i.test(v.title)).length >= Math.max(2, ch.videos.length / 3)
  const items = ch.videos.map((v) => ({ url: v.url, title: v.title, publishedAt: v.publishedAt, isLongform: v.isLongform }))
  const today = opts.now.toISOString().slice(0, 10)
  return {
    creator_name: ch.title,
    creator_segment: opts.segmentHint ?? (looksPodcast ? "video_podcaster" : "youtuber"),
    // A channel can be run by a company or network: a person must confirm.
    entity_type: "needs_review",
    country_iso2: ch.country ?? opts.countryHint ?? "",
    country_evidence_url: ch.country ? `${ch.channelUrl}/about` : "",
    primary_language: "",
    primary_platform: "youtube",
    profile_url: ch.channelUrl,
    stable_creator_id: ch.channelId,
    followers_or_subscribers: ch.subscribers ?? "",
    content_items: JSON.stringify(items),
    monetization_signal: mon?.value ?? "",
    monetization_evidence_url: mon?.evidenceUrl ?? "",
    monetization_quote: mon?.quote ?? "",
    incubrix_need: need?.value ?? "",
    need_signal_text: need ? `you mentioned "${need.quote.slice(0, 80)}"` : "",
    need_evidence_url: need?.evidenceUrl ?? "",
    email: email?.value ?? "",
    email_evidence_url: email?.evidenceUrl ?? "",
    email_last_active: email?.lastSeen?.slice(0, 10) ?? "",
    email_source: email ? "published" : "",
    email_business_use: email ? "yes" : "",
    email_quote: email?.quote ?? "",
    checked_date: today,
    source: ch.source,
    source_ref: ch.channelUrl,
    review_notes: [
      "CONFIRM: individual creator (not company/network)",
      need ? "" : "FIND: public need evidence",
      mon ? "" : "FIND: monetization evidence",
      email ? "" : "FIND: published business contact",
      ch.country ? "" : "FIND: country evidence",
      "CONFIRM: primary_language",
    ].filter(Boolean).join("; "),
  }
}
