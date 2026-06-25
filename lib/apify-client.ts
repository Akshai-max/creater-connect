// Thin wrapper over Apify run-sync-get-dataset-items endpoints.
// Used by /api/discover for hashtag scraping + profile enrichment.

const BASE = "https://api.apify.com/v2"

function token(): string {
  const t = process.env.APIFY_TOKEN
  if (!t) throw new Error("APIFY_TOKEN not set — add it to .env.local")
  return t
}

async function runActor<T = any>(actorId: string, input: Record<string, any>): Promise<T[]> {
  const url = `${BASE}/acts/${actorId.replace("/", "~")}/run-sync-get-dataset-items?token=${token()}`
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!r.ok) throw new Error(`Apify ${actorId} HTTP ${r.status}: ${await r.text().catch(() => "")}`)
  return r.json()
}

export type HashtagPost = {
  ownerUsername?: string
  ownerFullName?: string
  caption?: string
  url?: string
  likesCount?: number
  commentsCount?: number
  hashtags?: string[]
  mentions?: string[]
  timestamp?: string
  locationName?: string
}

export async function scrapeHashtag(hashtag: string, resultsLimit = 60): Promise<HashtagPost[]> {
  return runActor<HashtagPost>("apify/instagram-hashtag-scraper", {
    hashtags: [hashtag.replace("#", "")],
    resultsLimit,
  })
}

export type IGProfile = {
  username?: string
  fullName?: string
  followersCount?: number
  followsCount?: number
  postsCount?: number
  biography?: string
  externalUrl?: string
  externalUrls?: Array<{ url?: string; title?: string }>
  isBusinessAccount?: boolean
  verified?: boolean
  businessCategoryName?: string
  categoryName?: string
  public_email?: string
  businessEmail?: string
  businessPhoneNumber?: string
  profilePicUrl?: string
  profilePicUrlHD?: string
  latestPosts?: Array<{ caption?: string; likesCount?: number; commentsCount?: number; hashtags?: string[]; mentions?: string[]; timestamp?: string; url?: string }>
}

export async function scrapeProfiles(usernames: string[]): Promise<IGProfile[]> {
  if (!usernames.length) return []
  return runActor<IGProfile>("apify/instagram-profile-scraper", { usernames })
}

// Pull email out of bio + external linktree page (best-effort)
export async function findEmail(profile: IGProfile): Promise<string | null> {
  const bio = profile.biography || ""
  const fromBio = bio.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0]
  if (fromBio) return fromBio
  const businessEmail = (profile as any).public_email || (profile as any).businessEmail
  if (businessEmail) return businessEmail

  const url = profile.externalUrl
  if (!url) return null
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return null
    const html = await r.text()
    const matches = Array.from(html.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g))
      .map((m) => m[0].toLowerCase())
      .filter((e) => !/example|sentry|wixpress|noreply|\.png$|\.jpg$|cloudflare|googleapis|gstatic|fonts|herokuapp|shopify/i.test(e))
    return matches[0] ?? null
  } catch {
    return null
  }
}

// US detection from bio + name
const NON_US = /\b(uk|united kingdom|england|scotland|wales|ireland|🇬🇧|🇨🇦|canada|toronto|vancouver|🇦🇺|australia|sydney|melbourne|perth|brisbane|🇮🇹|italy|italia|milan|rome|toscana|🇪🇸|spain|barcelona|madrid|🇩🇪|germany|berlin|🇫🇷|france|paris|🇵🇹|portugal|lisbon|🇲🇽|mexico|🇧🇷|brazil|🇸🇦|saudi|🇦🇪|dubai|uae|🇮🇱|israel|tel aviv|🇮🇳|india|🇵🇭|philippines|🇿🇦|south africa|🇳🇿|new zealand|nz\b|latvia|estonia|lithuania|poland|hungary|netherlands|holland|sweden|norway|denmark|finland|austria|switzerland|greece|romania|serbia|croatia|turkey|japan|korea|china|hong kong|singapore|thailand|vietnam|indonesia|malaysia|kazakhstan)\b/i
const US_HINT = /\b(usa?|us-based|united states|🇺🇸|new york|nyc|los angeles|miami|chicago|seattle|portland|denver|austin|houston|dallas|atlanta|boston|philadelphia|phoenix|san francisco|san diego|nashville|orlando|tampa|brooklyn|manhattan|california|texas|florida|arizona|new jersey|colorado|nevada|massachusetts|pennsylvania|georgia|north carolina|south carolina|tennessee|virginia|maryland|illinois|ohio|michigan|minnesota|hawaii|utah)\b/i
const US_STATE = /(?:^|[,\s])\s*(NY|NJ|CA|TX|FL|AZ|WA|OR|CO|NV|MA|PA|GA|NC|SC|TN|VA|MD|IL|OH|MI|MN|MO|AL|KY|WI|CT|UT|OK|LA|MS|ME|NH|VT|DE|RI|HI|DC)\b/

export function detectIsUS(text: string | null | undefined): boolean | null {
  if (!text) return null
  if (NON_US.test(text)) return false
  if (US_HINT.test(text)) return true
  if (US_STATE.test(text)) return true
  return null
}

// Brand-handle filter (so we don't waste enrichment on brand accounts)
export function looksLikeBrandHandle(handle: string): boolean {
  const h = handle.toLowerCase()
  const brandWords = ["shop", "store", "sale", "buy", "deals", "finds", "official", "brand", "reviews", "outlet", "mall", "wholesale", "supplier", "manufacturer", "factory", "products", "agency"]
  if (brandWords.some((w) => h.includes(w))) return true
  if (/\.(co|us|uk|au|it|gr|nz)$/.test(h)) return true
  return false
}

// Hashtag rotation by day-of-week — keeps each daily run focused but covers ground over a week.
// EXAMPLE hashtags only — replace each set with hashtags relevant to YOUR niche
// (e.g. broad UGC tags, niche/topic tags, competitor tags, regional tags).
const HASHTAG_SETS: string[][] = [
  // Sunday: UGC marketplace
  ["ugccreator", "ugccommunity", "ugcportfolio"],
  // Monday: niche topic
  ["contentcreator", "creatoreconomy", "microinfluencer"],
  // Tuesday: product demos
  ["productreview", "honestreview", "unboxing"],
  // Wednesday: trending / discovery
  ["tiktokmademebuyit", "amazonfinds", "founditonig"],
  // Thursday: authority / expert voices
  ["expertadvice", "behindthebrand", "smallbusiness"],
  // Friday: regional
  ["ugcusa", "ugcnyc", "ugcla"],
  // Saturday: broad reach
  ["reels", "creatorsofinstagram", "newpost"],
]

export function hashtagsForToday(date = new Date()): string[] {
  return HASHTAG_SETS[date.getUTCDay()]
}

export function hashtagsForOffset(offsetDays: number): string[] {
  const idx = ((new Date().getUTCDay() + offsetDays) % 7 + 7) % 7
  return HASHTAG_SETS[idx]
}
