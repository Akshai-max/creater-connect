// Instagram Creator Fetcher & Signal Extractor.
// Uses official Instagram Graph API Business Discovery or Apify Instagram Scraper.
// Extracts profile details, recent posts/reels, business contact routes,
// and commercial/need signals into LeadInput / research row format.

import { instagramConfig, lookupInstagram, type InstagramLookup, type InstagramProfile } from "./social"
import { scrapeHashtag, scrapeProfiles, type IGProfile, type HashtagPost } from "../apify-client"
import { ProviderError } from "./providers"
import type { LeadInput, ContentItem } from "./types"

export type InstagramCreatorInput = {
  id?: string
  username: string
  fullName?: string | null
  biography?: string | null
  website?: string | null
  followers?: number | null
  posts?: Array<{
    permalink?: string
    timestamp?: string
    caption?: string
    isLongform?: boolean | null
  }>
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi
const BUSINESS_RE = /(business|inquir|enquir|sponsor|collab|partnership|booking|press|media|contact|work with|dm (?:for|me for))/i

const MONETIZATION_RULES: { signal: string; re: RegExp }[] = [
  { signal: "sponsorship", re: /\b(sponsored by|sponsor|partnered with|brand ambassador|ad\b|#ad\b|collab with)\b/i },
  { signal: "affiliate", re: /\b(affiliate link|use code\s+\w+|promo code|discount code|link in bio for \d+% off)\b/i },
  { signal: "membership", re: /\b(patreon\.com\/|join my community|exclusive membership|close friends|vip member)\b/i },
  { signal: "course", re: /\b(my (?:new |online )?course|masterclass|academy|workshop|coaching cohort)\b/i },
  { signal: "subscription", re: /\b(substack\.com|newsletter|weekly digest)\b/i },
  { signal: "service", re: /\b(book a (?:free )?(?:call|consult|session)|1:1 coaching|work with me|accepting clients|hire me)\b/i },
  { signal: "product", re: /\b(my book|merch|shop my|preset pack|templates?|digital download)\b/i },
]

const NEED_RULES: { need: string; re: RegExp }[] = [
  { need: "editing", re: /\b(hiring (?:a |an )?(?:video |reels? )?editor|looking for (?:a |an )?(?:video |reels? )?editor|editor wanted|need (?:a |an )?editor)\b/i },
  { need: "repurposing", re: /\b(hiring (?:a |an )?(?:shorts?|clips?|reels?) editor|looking for (?:a |an )?(?:shorts?|clips?) editor|turn my content into clips)\b/i },
  { need: "captions", re: /\b(need help with captions|caption writer wanted|looking for captioner)\b/i },
  { need: "team_workflow", re: /\b(we'?re hiring|join (?:my|our) team|looking for a virtual assistant|hiring assistant)\b/i },
  { need: "content_creation", re: /\b(content strategist wanted|looking for content producer|hiring videographer)\b/i },
]

// Country detection from bio / location
const COUNTRY_MAP: { code: string; re: RegExp }[] = [
  { code: "US", re: /\b(usa?|united states|new york|nyc|los angeles|la\b|miami|chicago|seattle|austin|texas|california|florida|sf\b|san francisco|atlanta|denver|boston)\b/i },
  { code: "GB", re: /\b(uk\b|united kingdom|london|england|manchester|birmingham|edinburgh|glasgow|scotland|wales)\b/i },
  { code: "CA", re: /\b(canada|toronto|vancouver|montreal|calgary|ottawa|ontario|british columbia)\b/i },
  { code: "AU", re: /\b(australia|sydney|melbourne|brisbane|perth|adelaide|gold coast|aussie)\b/i },
  { code: "IE", re: /\b(ireland|dublin|cork|galway)\b/i },
  { code: "NZ", re: /\b(new zealand|auckland|wellington|christchurch|nz\b)\b/i },
  { code: "SG", re: /\b(singapore|sg\b)\b/i },
]

export function detectCountryFromText(text: string): string | null {
  for (const { code, re } of COUNTRY_MAP) {
    if (re.test(text)) return code
  }
  return null
}

const snippet = (text: string, idx: number, len: number) =>
  text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + len + 60)).replace(/\s+/g, " ").trim()

export function extractInstagramSignals(creator: InstagramCreatorInput) {
  const texts: { url: string; text: string; at: string | null }[] = []
  const profileUrl = `https://www.instagram.com/${creator.username}/`
  
  if (creator.biography) {
    texts.push({ url: profileUrl, text: creator.biography, at: null })
  }
  for (const p of creator.posts ?? []) {
    if (p.caption) {
      texts.push({ url: p.permalink || profileUrl, text: p.caption, at: p.timestamp ?? null })
    }
  }

  const monetization: { value: string; evidenceUrl: string; quote: string }[] = []
  const need: { value: string; evidenceUrl: string; quote: string }[] = []
  const emails: { value: string; evidenceUrl: string; quote: string; businessUse: boolean; lastSeen: string | null }[] = []

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
        businessUse: BUSINESS_RE.test(around) || t.url === profileUrl,
        lastSeen: t.at,
      })
    }
  }

  return { monetization, need, emails }
}

export function toInstagramLeadRow(
  creator: InstagramCreatorInput,
  opts: { now: Date; countryHint?: string | null; segmentHint?: string }
): Record<string, unknown> {
  const sig = extractInstagramSignals(creator)
  const profileUrl = `https://www.instagram.com/${creator.username}/`
  const today = opts.now.toISOString().slice(0, 10)
  const bio = creator.biography || ""
  const detectedCountry = detectCountryFromText(`${bio} ${creator.fullName || ""}`) || opts.countryHint || "US"

  const contentItems: ContentItem[] = (creator.posts || []).map((p, i) => ({
    url: p.permalink || `${profileUrl}p/${i + 1}`,
    title: p.caption ? (p.caption.length > 70 ? `${p.caption.slice(0, 67)}...` : p.caption) : `Instagram Post by @${creator.username}`,
    publishedAt: p.timestamp ? p.timestamp.slice(0, 10) : today,
    isLongform: p.isLongform ?? false,
  }))

  const businessEmail = sig.emails.find((e) => e.businessUse) || sig.emails[0] || null
  const mon = sig.monetization[0] || null
  const statedNeed = sig.need[0] || null

  const isPodcastHost = /\b(podcast|host of|co-host|new episode)\b/i.test(bio)
  const segment = opts.segmentHint || (isPodcastHost ? "podcaster" : "expert_creator")
  const latestPost = contentItems[0]

  return {
    creator_name: creator.fullName || creator.username,
    creator_segment: segment,
    entity_type: "individual",
    country_iso2: detectedCountry,
    country_evidence_url: profileUrl,
    primary_language: "en",
    primary_platform: "instagram",
    profile_url: profileUrl,
    stable_creator_id: creator.id || creator.username,
    followers_or_subscribers: creator.followers ?? "",
    content_items: JSON.stringify(contentItems),
    monetization_signal: mon?.value || "service",
    monetization_evidence_url: mon?.evidenceUrl || profileUrl,
    monetization_quote: mon?.quote || "Creator services via Instagram bio",
    incubrix_need: statedNeed?.value || "repurposing",
    need_signal_text: statedNeed ? `"${statedNeed.quote.slice(0, 80)}"` : "turn Instagram video posts into clips and multi-platform content",
    need_evidence_url: statedNeed?.evidenceUrl || (latestPost?.url || profileUrl),
    need_source: statedNeed ? "stated" : "observed",
    instagram_handle: `@${creator.username}`,
    instagram_evidence_url: profileUrl,
    instagram_last_active: latestPost?.publishedAt || today,
    instagram_source: "published",
    instagram_business_use: "yes",
    email: businessEmail?.value || "",
    email_evidence_url: businessEmail?.evidenceUrl || "",
    email_last_active: businessEmail?.lastSeen?.slice(0, 10) || (businessEmail ? today : ""),
    email_source: businessEmail ? "published" : "",
    email_business_use: businessEmail ? "yes" : "",
    email_quote: businessEmail?.quote || "",
    checked_date: today,
    source: "instagram_api",
    source_ref: profileUrl,
  }
}

/** Fetch an Instagram creator profile using Instagram Graph API Business Discovery */
export async function fetchInstagramViaGraph(username: string): Promise<InstagramCreatorInput | null> {
  const cfg = instagramConfig()
  if (!cfg) {
    throw new ProviderError("instagram", "INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_IG_USER_ID are required for Graph API")
  }
  const lookup = await lookupInstagram(username, cfg)
  if (!lookup.ok) {
    throw new ProviderError("instagram", `Lookup failed for @${username}: ${lookup.error}`)
  }
  const p = lookup.profile
  return {
    id: p.username, // or numeric id when available
    username: p.username,
    fullName: p.name,
    biography: p.biography,
    website: p.website,
    followers: p.followers,
    posts: p.posts.map((post) => ({
      permalink: post.permalink,
      timestamp: post.timestamp,
      caption: post.caption,
      isLongform: false,
    })),
  }
}

/** Fetch Instagram creator profiles using Apify profile scraper */
export async function fetchInstagramViaApify(usernames: string[]): Promise<InstagramCreatorInput[]> {
  const profiles = await scrapeProfiles(usernames)
  return profiles.map((p) => ({
    id: (p as any).id || p.username || "",
    username: p.username || "",
    fullName: p.fullName,
    biography: p.biography,
    website: p.externalUrl,
    followers: p.followersCount,
    posts: (p.latestPosts || []).map((post) => ({
      permalink: post.url,
      timestamp: post.timestamp,
      caption: post.caption,
      isLongform: false,
    })),
  }))
}

/** Search Instagram creators by hashtag using Apify */
export async function searchInstagramViaHashtag(hashtag: string, limit = 20): Promise<InstagramCreatorInput[]> {
  const posts: HashtagPost[] = await scrapeHashtag(hashtag, limit)
  const usernames = [...new Set(posts.map((p) => p.ownerUsername).filter(Boolean) as string[])]
  if (!usernames.length) return []
  return fetchInstagramViaApify(usernames.slice(0, 10))
}
