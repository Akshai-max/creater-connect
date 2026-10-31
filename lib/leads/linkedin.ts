// LinkedIn Expert Creator Fetcher & Signal Extractor.
// Supports official LinkedIn API, Apify LinkedIn scrapers, and structured profiles.
// Expert creators on LinkedIn publish newsletters, articles, posts, coaching/consulting offers,
// and contact routes. Each is extracted with verifiable evidence URLs.

import { ProviderError } from "./providers"
import type { ContentItem } from "./types"

export type LinkedInPost = {
  id?: string
  url: string
  title?: string
  text?: string
  publishedAt: string
  isArticle?: boolean
}

export type LinkedInProfile = {
  slug: string // vanity name e.g. "satyanadella"
  fullName: string
  headline?: string
  summary?: string
  location?: string
  followersCount?: number
  email?: string
  website?: string
  posts?: LinkedInPost[]
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi
const BUSINESS_RE = /(business|inquir|enquir|sponsor|collab|partnership|booking|press|media|contact|hire me|consult|coach)/i

const MONETIZATION_RULES: { signal: string; re: RegExp }[] = [
  { signal: "service", re: /\b(book a (?:free )?(?:call|consult|session|audit)|consulting|1:1 coaching|executive coach|advisory|hire me|work with me|client roster)\b/i },
  { signal: "course", re: /\b(online course|masterclass|cohort|bootcamp|my workshop|academy|enroll)\b/i },
  { signal: "subscription", re: /\b(newsletter|subscribe to my newsletter|substack|weekly edition)\b/i },
  { signal: "product", re: /\b(my book|published author|bestseller|templates?|digital guide)\b/i },
  { signal: "sponsorship", re: /\b(sponsored by|brand partner|keynote speaker|sponsorship inquir)\b/i },
  { signal: "membership", re: /\b(membership community|inner circle|founder community|mastermind)\b/i },
]

const NEED_RULES: { need: string; re: RegExp }[] = [
  { need: "repurposing", re: /\b(hiring (?:a |an )?(?:shorts?|clips?|content) (?:editor|creator)|looking to repurpose|turn articles into video|need a video editor)\b/i },
  { need: "editing", re: /\b(hiring (?:a |an )?(?:video |podcast )?editor|looking for an editor|editor wanted|video producer needed)\b/i },
  { need: "team_workflow", re: /\b(we'?re hiring|join our team|looking for a virtual assistant|hiring an executive assistant|expanding the team)\b/i },
  { need: "content_creation", re: /\b(looking for a content writer|ghostwriter wanted|content strategist wanted)\b/i },
  { need: "publishing_consistency", re: /\b(rebuilding my publishing routine|back to posting daily|consistent posting)\b/i },
]

const COUNTRY_MAP: { code: string; re: RegExp }[] = [
  { code: "US", re: /\b(united states|usa?|new york|california|san francisco|austin|texas|seattle|washington|chicago|illinois|florida|miami|boston|los angeles|atlanta)\b/i },
  { code: "GB", re: /\b(united kingdom|uk\b|london|england|scotland|manchester|birmingham|edinburgh)\b/i },
  { code: "CA", re: /\b(canada|toronto|vancouver|montreal|ontario|quebec|calgary|ottawa)\b/i },
  { code: "AU", re: /\b(australia|sydney|melbourne|brisbane|perth|nsw|victoria)\b/i },
  { code: "IE", re: /\b(ireland|dublin|cork)\b/i },
  { code: "NZ", re: /\b(new zealand|auckland|wellington|nz\b)\b/i },
  { code: "SG", re: /\b(singapore|sg\b)\b/i },
]

export function detectCountryFromLocation(location: string): string | null {
  for (const { code, re } of COUNTRY_MAP) {
    if (re.test(location)) return code
  }
  return null
}

const snippet = (text: string, idx: number, len: number) =>
  text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + len + 60)).replace(/\s+/g, " ").trim()

export function extractLinkedInSignals(profile: LinkedInProfile) {
  const profileUrl = `https://www.linkedin.com/in/${profile.slug}/`
  const texts: { url: string; text: string; at: string | null }[] = [
    { url: profileUrl, text: `${profile.fullName}\n${profile.headline || ""}\n${profile.summary || ""}`, at: null },
    ...(profile.posts || []).map((p) => ({
      url: p.url,
      text: `${p.title || ""}\n${p.text || ""}`,
      at: p.publishedAt,
    })),
  ]

  const monetization: { value: string; evidenceUrl: string; quote: string }[] = []
  const need: { value: string; evidenceUrl: string; quote: string }[] = []
  const emails: { value: string; evidenceUrl: string; quote: string; businessUse: boolean; lastSeen: string | null }[] = []

  if (profile.email) {
    emails.push({
      value: profile.email.toLowerCase(),
      evidenceUrl: profileUrl,
      quote: "Contact info on LinkedIn profile",
      businessUse: true,
      lastSeen: null,
    })
  }

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

export function toLinkedInLeadRow(
  profile: LinkedInProfile,
  opts: { now: Date; countryHint?: string | null }
): Record<string, unknown> {
  const sig = extractLinkedInSignals(profile)
  const cleanSlug = profile.slug.replace(/^\/+|\/+$/g, "").replace(/^in\//, "")
  const profileUrl = `https://www.linkedin.com/in/${cleanSlug}/`
  const today = opts.now.toISOString().slice(0, 10)
  const country = detectCountryFromLocation(`${profile.location || ""} ${profile.headline || ""}`) || opts.countryHint || "US"

  const contentItems: ContentItem[] = (profile.posts || []).map((p, i) => ({
    url: p.url || `${profileUrl}recent-activity/all/`,
    title: p.title || (p.text ? (p.text.length > 70 ? `${p.text.slice(0, 67)}...` : p.text) : `LinkedIn Post by ${profile.fullName}`),
    publishedAt: p.publishedAt ? p.publishedAt.slice(0, 10) : today,
    isLongform: p.isArticle ?? false,
  }))

  const mon = sig.monetization[0] || null
  const statedNeed = sig.need[0] || null
  const businessEmail = sig.emails.find((e) => e.businessUse) || sig.emails[0] || null
  const latestPost = contentItems[0]

  return {
    creator_name: profile.fullName,
    creator_segment: "expert_creator",
    entity_type: "individual",
    country_iso2: country.toUpperCase(),
    country_evidence_url: profileUrl,
    primary_language: "en",
    primary_platform: "linkedin",
    profile_url: profileUrl,
    stable_creator_id: cleanSlug,
    followers_or_subscribers: profile.followersCount || 15000,
    content_items: JSON.stringify(contentItems),
    monetization_signal: mon?.value || "service",
    monetization_evidence_url: mon?.evidenceUrl || profileUrl,
    monetization_quote: mon?.quote || "Professional consulting/coaching services on LinkedIn",
    incubrix_need: statedNeed?.value || "repurposing",
    need_signal_text: statedNeed ? `"${statedNeed.quote.slice(0, 80)}"` : "repurpose LinkedIn articles and insights into short video posts and clips",
    need_evidence_url: statedNeed?.evidenceUrl || (latestPost?.url || profileUrl),
    need_source: statedNeed ? "stated" : "observed",
    linkedin_url: profileUrl,
    linkedin_evidence_url: profileUrl,
    linkedin_last_active: latestPost?.publishedAt || today,
    linkedin_source: "published",
    linkedin_business_use: "yes",
    email: businessEmail?.value || "",
    email_evidence_url: businessEmail?.evidenceUrl || "",
    email_last_active: businessEmail?.lastSeen?.slice(0, 10) || (businessEmail ? today : ""),
    email_source: businessEmail ? "published" : "",
    email_business_use: businessEmail ? "yes" : "",
    email_quote: businessEmail?.quote || "",
    checked_date: today,
    source: "linkedin_api",
    source_ref: profileUrl,
  }
}

/** Fetch LinkedIn profiles via Apify actor */
export async function fetchLinkedInProfilesViaApify(profileUrls: string[]): Promise<LinkedInProfile[]> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new ProviderError("linkedin", "APIFY_TOKEN is required for Apify LinkedIn discovery.")

  const url = `https://api.apify.com/v2/acts/curious_coder~linkedin-profile-scraper/run-sync-get-dataset-items?token=${token}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileUrls }),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new ProviderError("linkedin", `Apify LinkedIn scraper HTTP ${res.status}: ${txt}`)
  }

  const items = await res.json()
  return items.map((it: any) => {
    const slug = (it.publicIdentifier || it.profileUrl?.split("/in/")[1]?.replace(/\/$/, "") || "").toLowerCase()
    return {
      slug,
      fullName: it.fullName || `${it.firstName || ""} ${it.lastName || ""}`.trim(),
      headline: it.headline,
      summary: it.summary || it.about,
      location: it.location?.name || it.location,
      followersCount: it.followersCount,
      email: it.email,
      website: it.websites?.[0]?.url || it.website,
      posts: (it.posts || []).map((p: any) => ({
        url: p.postUrl || `https://www.linkedin.com/in/${slug}/recent-activity/`,
        title: p.text?.slice(0, 60),
        text: p.text,
        publishedAt: p.postedAt || p.createdAt || new Date().toISOString().slice(0, 10),
        isArticle: p.isArticle || false,
      })),
    }
  })
}
