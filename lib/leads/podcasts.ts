// Podcast directory source for discovery: Apple's public iTunes Search API (no key) finds podcasts
// by topic, and each podcast's public RSS feed (which podcasters publish for directories) gives
// its links and the owner email the podcaster put in <itunes:owner>. Only podcasts that link a
// YouTube channel become leads, because leads are keyed by YouTube channel.
import { extractYouTubeRefs, type YouTubeRef } from "./discovery"

export type PodcastFetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }>
type Fetcher = PodcastFetcher
const UA = { "user-agent": "creator-crm-lead-engine/1.0 (+research)" }
const defaultFetcher: Fetcher = (u) => fetch(u, { headers: UA, signal: AbortSignal.timeout(10_000) }) as any

export type ApplePodcast = { collectionId: number; name: string; artist: string; feedUrl: string; appleUrl: string }

/** iTunes Search API, podcasts only. `country` is a 2-letter store code (us, gb, au). */
export async function searchApplePodcasts(term: string, opts: { country: string; limit?: number; fetcher?: Fetcher }): Promise<ApplePodcast[]> {
  const fetcher = opts.fetcher ?? defaultFetcher
  const u = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=${opts.limit ?? 25}` +
    `&country=${encodeURIComponent(opts.country.toLowerCase())}&term=${encodeURIComponent(term)}`
  const res = await fetcher(u)
  if (!res.ok) throw new Error(`iTunes search HTTP ${res.status}`)
  const j = await res.json()
  return (j.results ?? [])
    .filter((r: any) => r.feedUrl && r.collectionId)
    .map((r: any) => ({ collectionId: r.collectionId, name: r.collectionName ?? "", artist: r.artistName ?? "", feedUrl: r.feedUrl, appleUrl: r.collectionViewUrl ?? "" }))
}

export type FeedInfo = { ownerEmail: string | null; latestEpisodeAt: string | null; youtube: YouTubeRef[] }

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
const MAX_FEED_CHARS = 3_000_000

/** Reads the parts of an RSS feed we need: the owner email, the newest episode date, YouTube links
 *  in the show's own text and its newest few episodes. */
export function parseFeed(xml: string): FeedInfo {
  const firstItem = xml.search(/<item[\s>]/i)
  const head = firstItem >= 0 ? xml.slice(0, firstItem) : xml
  const items = xml.slice(Math.max(firstItem, 0)).split(/<\/item>/i).slice(0, 5).join("")
  const owner = /<itunes:owner>[\s\S]*?<itunes:email>([\s\S]*?)<\/itunes:email>/i.exec(head)?.[1]
  const email = owner ? decode(owner) : null
  const dates = [...xml.slice(Math.max(firstItem, 0), Math.max(firstItem, 0) + 200_000).matchAll(/<pubDate>([\s\S]*?)<\/pubDate>/gi)]
    .map((m) => Date.parse(decode(m[1]))).filter((t) => Number.isFinite(t))
  return {
    ownerEmail: email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null,
    latestEpisodeAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    youtube: extractYouTubeRefs(decode(head) + "\n" + decode(items)),
  }
}

export async function fetchFeed(feedUrl: string, opts: { fetcher?: Fetcher } = {}): Promise<FeedInfo> {
  const fetcher = opts.fetcher ?? defaultFetcher
  const res = await fetcher(feedUrl)
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`)
  return parseFeed((await res.text()).slice(0, MAX_FEED_CHARS))
}
