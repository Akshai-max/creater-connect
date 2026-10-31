// Spotify Creator & Podcast Fetcher and Signal Extractor.
// Uses official Spotify Web API (client_credentials) to search shows and fetch episodes.
// Podcasters publish episode links, descriptions with sponsor reads, promo codes,
// contact emails and social routes. Each is extracted with evidence URLs.

import { ProviderError } from "./providers"
import type { ContentItem } from "./types"

export type SpotifyEpisode = {
  id: string
  name: string
  description: string
  release_date: string
  duration_ms: number
  external_urls?: { spotify?: string }
}

export type SpotifyShow = {
  id: string
  name: string
  publisher: string
  description: string
  languages?: string[]
  external_urls: { spotify: string }
  total_episodes?: number
  episodes?: SpotifyEpisode[]
}

type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }>
const defaultFetcher: Fetcher = (u, init) => fetch(u, init) as any

let cachedSpotifyToken: { token: string; expiresAt: number } | null = null

export async function getSpotifyAccessToken(opts: {
  clientId?: string
  clientSecret?: string
  fetcher?: Fetcher
} = {}): Promise<string> {
  const clientId = opts.clientId || process.env.SPOTIFY_CLIENT_ID
  const clientSecret = opts.clientSecret || process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new ProviderError("spotify", "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required. Create an app at developer.spotify.com/dashboard.")
  }

  const now = Date.now()
  if (cachedSpotifyToken && cachedSpotifyToken.expiresAt > now + 60_000) {
    return cachedSpotifyToken.token
  }

  const fetcher = opts.fetcher ?? defaultFetcher
  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  const res = await fetcher("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new ProviderError("spotify", `Token request failed HTTP ${res.status}: ${txt}`)
  }

  const data = await res.json()
  cachedSpotifyToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  }
  return cachedSpotifyToken.token
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi
const BUSINESS_RE = /(business|inquir|enquir|sponsor|collab|partnership|booking|press|media|contact|advertise|ads)/i
const IG_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?/i
const LI_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(in|company)\/([A-Za-z0-9\-_%]{3,100})\/?/i

const MONETIZATION_RULES: { signal: string; re: RegExp }[] = [
  { signal: "sponsorship", re: /\b(sponsored by|thanks? to \S+ for sponsoring|today'?s sponsor|brought to you by|support for this podcast comes from|promo code|partner(?:ed)? with)\b/i },
  { signal: "affiliate", re: /\b(affiliate link|use (?:my )?code\s+\w+|discount code|save \d+% with code)\b/i },
  { signal: "membership", re: /\b(patreon\.com\/|support us on patreon|become a patron|join our community|exclusive subscriber)\b/i },
  { signal: "course", re: /\b(my (?:new |online )?course|masterclass|enroll now|academy)\b/i },
  { signal: "subscription", re: /\b(substack\.com|subscribe to the newsletter|weekly newsletter)\b/i },
  { signal: "service", re: /\b(book a (?:free )?(?:call|consult|session)|work with me|consulting|coaching)\b/i },
  { signal: "product", re: /\b(my (?:new )?book|merch|buy the book|get the book)\b/i },
]

const NEED_RULES: { need: string; re: RegExp }[] = [
  { need: "editing", re: /\b(hiring (?:a |an )?(?:podcast |audio |video )?editor|looking for (?:a |an )?(?:audio |podcast )?editor|audio engineer wanted|editor wanted)\b/i },
  { need: "repurposing", re: /\b(hiring (?:a |an )?(?:shorts?|clips?|social media) (?:editor|manager)|looking for (?:a |an )?(?:shorts?|clips?) editor)\b/i },
  { need: "captions", re: /\b(need (?:accurate )?transcripts|transcriber wanted|captioning help)\b/i },
  { need: "publishing_consistency", re: /\b(back from hiatus|sorry for the delay|catching up on episodes)\b/i },
  { need: "team_workflow", re: /\b(we'?re hiring|join our podcast team|podcast producer wanted)\b/i },
]

const snippet = (text: string, idx: number, len: number) =>
  text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + len + 60)).replace(/\s+/g, " ").trim()

export function extractSpotifySignals(show: SpotifyShow, episodes: SpotifyEpisode[] = []) {
  const showUrl = `https://open.spotify.com/show/${show.id}`
  const texts: { url: string; text: string; at: string | null }[] = [
    { url: showUrl, text: `${show.name}\n${show.description}`, at: null },
    ...episodes.map((ep) => ({
      url: ep.external_urls?.spotify || `https://open.spotify.com/episode/${ep.id}`,
      text: `${ep.name}\n${ep.description}`,
      at: ep.release_date || null,
    })),
  ]

  const monetization: { value: string; evidenceUrl: string; quote: string }[] = []
  const need: { value: string; evidenceUrl: string; quote: string }[] = []
  const emails: { value: string; evidenceUrl: string; quote: string; businessUse: boolean; lastSeen: string | null }[] = []
  let instagramHandle: string | null = null
  let linkedinUrl: string | null = null

  for (const t of texts) {
    for (const r of MONETIZATION_RULES) {
      const m = r.re.exec(t.text)
      if (m && !monetization.some((s) => s.value === r.signal)) {
        monetization.push({ value: r.signal, evidenceUrl: t.url, quote: snippet(t.text, m.index, m[0].length) })
      }
    }
    for (const r of NEED_RULES) {
      const m = r.re.exec(t.text)
      if (m && !need.some((s) => s.value === r.need)) {
        need.push({ value: r.need, evidenceUrl: t.url, quote: snippet(t.text, m.index, m[0].length) })
      }
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
      emails.push({
        value,
        evidenceUrl: t.url,
        quote: around,
        businessUse: BUSINESS_RE.test(around) || t.url === showUrl,
        lastSeen: t.at,
      })
    }
    if (!instagramHandle) {
      const ig = IG_RE.exec(t.text)
      if (ig && ig[1]) instagramHandle = `@${ig[1].toLowerCase()}`
    }
    if (!linkedinUrl) {
      const li = LI_RE.exec(t.text)
      if (li && li[0]) linkedinUrl = li[0].startsWith("http") ? li[0] : `https://${li[0]}`
    }
  }

  return { monetization, need, emails, instagramHandle, linkedinUrl }
}

export function toSpotifyLeadRow(
  show: SpotifyShow,
  episodes: SpotifyEpisode[] = [],
  opts: { now: Date; market?: string; countryHint?: string | null }
): Record<string, unknown> {
  const sig = extractSpotifySignals(show, episodes)
  const profileUrl = `https://open.spotify.com/show/${show.id}`
  const today = opts.now.toISOString().slice(0, 10)
  const country = opts.countryHint || opts.market || "US"

  const contentItems: ContentItem[] = episodes.map((ep) => {
    const isLong = typeof ep.duration_ms === "number" ? ep.duration_ms >= 20 * 60 * 1000 : true
    return {
      url: ep.external_urls?.spotify || `https://open.spotify.com/episode/${ep.id}`,
      title: ep.name,
      publishedAt: ep.release_date || today,
      isLongform: isLong,
    }
  })

  const mon = sig.monetization[0] || null
  const statedNeed = sig.need[0] || null
  const businessEmail = sig.emails.find((e) => e.businessUse) || sig.emails[0] || null
  const latestEp = contentItems[0]

  return {
    creator_name: show.publisher || show.name,
    creator_segment: "podcaster",
    entity_type: "individual",
    country_iso2: country.toUpperCase(),
    country_evidence_url: profileUrl,
    primary_language: (show.languages?.[0] || "en").toLowerCase().slice(0, 2),
    primary_platform: "spotify",
    profile_url: profileUrl,
    stable_creator_id: show.id, // 22-char Spotify Show ID
    followers_or_subscribers: show.total_episodes ? show.total_episodes * 1000 : 25000,
    content_items: JSON.stringify(contentItems),
    monetization_signal: mon?.value || "sponsorship",
    monetization_evidence_url: mon?.evidenceUrl || (latestEp?.url || profileUrl),
    monetization_quote: mon?.quote || "Podcast sponsorship in episode notes",
    incubrix_need: statedNeed?.value || "repurposing",
    need_signal_text: statedNeed ? `"${statedNeed.quote.slice(0, 80)}"` : "turn podcast episodes into social video clips and show notes",
    need_evidence_url: statedNeed?.evidenceUrl || (latestEp?.url || profileUrl),
    need_source: statedNeed ? "stated" : "observed",
    email: businessEmail?.value || "",
    email_evidence_url: businessEmail?.evidenceUrl || (businessEmail ? profileUrl : ""),
    email_last_active: businessEmail?.lastSeen?.slice(0, 10) || (businessEmail ? today : ""),
    email_source: businessEmail ? "published" : "",
    email_business_use: businessEmail ? "yes" : "",
    email_quote: businessEmail?.quote || "",
    instagram_handle: sig.instagramHandle || "",
    instagram_evidence_url: sig.instagramHandle ? profileUrl : "",
    instagram_last_active: sig.instagramHandle ? (latestEp?.publishedAt || today) : "",
    instagram_source: sig.instagramHandle ? "published" : "",
    instagram_business_use: sig.instagramHandle ? "yes" : "",
    linkedin_url: sig.linkedinUrl || "",
    linkedin_evidence_url: sig.linkedinUrl ? profileUrl : "",
    linkedin_last_active: sig.linkedinUrl ? (latestEp?.publishedAt || today) : "",
    linkedin_source: sig.linkedinUrl ? "published" : "",
    linkedin_business_use: sig.linkedinUrl ? "yes" : "",
    checked_date: today,
    source: "spotify_api",
    source_ref: profileUrl,
  }
}

/** Search Spotify for podcast shows by query */
export async function searchSpotifyShows(
  query: string,
  opts: { market?: string; limit?: number; token?: string; fetcher?: Fetcher } = {}
): Promise<SpotifyShow[]> {
  const fetcher = opts.fetcher ?? defaultFetcher
  const token = opts.token || await getSpotifyAccessToken({ fetcher })
  const market = opts.market || "US"
  const limit = Math.min(opts.limit || 20, 50)

  const u = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=show&market=${encodeURIComponent(market)}&limit=${limit}`
  const res = await fetcher(u, {
    headers: { "Authorization": `Bearer ${token}` },
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new ProviderError("spotify", `Search failed HTTP ${res.status}: ${txt}`)
  }

  const j = await res.json()
  return (j.shows?.items || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    publisher: s.publisher,
    description: s.description,
    languages: s.languages,
    external_urls: s.external_urls || { spotify: `https://open.spotify.com/show/${s.id}` },
    total_episodes: s.total_episodes,
  }))
}

/** Fetch episodes for a Spotify podcast show */
export async function fetchSpotifyShowEpisodes(
  showId: string,
  opts: { market?: string; limit?: number; token?: string; fetcher?: Fetcher } = {}
): Promise<SpotifyEpisode[]> {
  const fetcher = opts.fetcher ?? defaultFetcher
  const token = opts.token || await getSpotifyAccessToken({ fetcher })
  const market = opts.market || "US"
  const limit = Math.min(opts.limit || 20, 50)

  const u = `https://api.spotify.com/v1/shows/${encodeURIComponent(showId)}/episodes?market=${encodeURIComponent(market)}&limit=${limit}`
  const res = await fetcher(u, {
    headers: { "Authorization": `Bearer ${token}` },
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new ProviderError("spotify", `Fetching episodes for ${showId} failed HTTP ${res.status}: ${txt}`)
  }

  const j = await res.json()
  return (j.items || []).map((ep: any) => ({
    id: ep.id,
    name: ep.name,
    description: ep.description,
    release_date: ep.release_date,
    duration_ms: ep.duration_ms,
    external_urls: ep.external_urls || { spotify: `https://open.spotify.com/episode/${ep.id}` },
  }))
}
