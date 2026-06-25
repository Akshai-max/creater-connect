// Detect junk candidates: brand accounts, dropshippers, storefronts, dormant tiny accounts.
// Used both at discovery-time (to skip insert) and at cleanup-time (to bulk-reject existing).
//
// The signal lists below are EXAMPLES. Tune them to your own niche — add bio
// phrases that competitors/resellers in your category use, and add words that
// signal a genuine creator in your space to NICHE_FRIENDLY_SIGNALS.

const BRAND_BIO_SIGNALS = [
  // Sales / shop language — strong signal this is a store, not a creator
  "shop now", "buy now", "order now", "dm to order", "shop link",
  "free shipping", "worldwide shipping", "free worldwide", "use code",
  "available now", "click link below", "click the link below",
  "shop with me", "shop my", "shop the link",
  // Reseller / dropshipper / brand self-identifiers
  "official store", "official brand", "5-in-1", "as seen on tv",
  "supplements", "detox |", "health coaching",
  // Unrelated industries (add/remove for your niche)
  "homemade accessories", "kids fashion", "custom handmade",
  "wearable art", "clay art", "resin art",
  "marine content", "decoupage", "hand painted furniture",
  "daily motivation", "boss energy",
]

const NICHE_FRIENDLY_SIGNALS = [
  // Words that indicate a real creator worth keeping (pull them BACK from rejection).
  // Add terms specific to YOUR niche here.
  "ugc creator", "ugc content", "content creator",
  "before after", "before/after", "tutorial", "honest review",
]

const STOREFRONT_SIGNALS = [
  // Signals of a local/brick-and-mortar business rather than an individual creator
  "salon", "studio", "boutique", "storefront",
  "accepting new clients", "book now", "book an appointment",
  "dm for booking", "booking open",
  "phone:", "call:", "📍", // location pin often means brick-and-mortar
]

export type QualityVerdict =
  | { keep: true; reason?: string }
  | { keep: false; reason: string }

export function judgeCandidate(c: {
  handle?: string | null
  bio?: string | null
  followers?: number | null
  engagementRate?: number | null
  personaMatch?: string | null
  fitScore?: number | null
  nicheRelevant?: boolean | null
  externalUrl?: string | null
}): QualityVerdict {
  const bio = (c.bio || "").toLowerCase()
  const fc = c.followers ?? 0
  const er = c.engagementRate ?? 0
  const persona = c.personaMatch ?? ""

  // Authority/Expert creators (credentialed, notable) play by different rules
  const isAuthority = /authority|endorsement|expert|notable/i.test(persona)

  // 1) Hard reject: 0 followers (private/dead)
  if (fc === 0 && !isAuthority) {
    return { keep: false, reason: "0 followers (likely dead/private account)" }
  }

  // 2) Hard reject: tiny + non-authority
  if (fc < 200 && !isAuthority) {
    return { keep: false, reason: `Too small (${fc} followers, no authority credential)` }
  }

  // 3) Hard reject: brand bio signals (unless a niche-friendly signal overrides)
  const matchedBrand = BRAND_BIO_SIGNALS.find((s) => bio.includes(s))
  const hasNicheFriendly = NICHE_FRIENDLY_SIGNALS.some((s) => bio.includes(s))
  if (matchedBrand && !hasNicheFriendly) {
    return { keep: false, reason: `Brand/shop signal: "${matchedBrand}"` }
  }

  // 4) Hard reject: storefront (local clientele, won't take national brand deals)
  const storefrontHits = STOREFRONT_SIGNALS.filter((s) => bio.includes(s)).length
  if (storefrontHits >= 2 && !hasNicheFriendly) {
    return { keep: false, reason: "Local storefront (multiple booking/location signals)" }
  }

  // 5) Soft reject: tiny + low ER and not niche-relevant
  if (fc < 1000 && er < 2 && !c.nicheRelevant && !isAuthority) {
    return { keep: false, reason: "Tiny audience + low engagement + not niche-relevant" }
  }

  // 6) Reject very-low fit score (heuristic gave up)
  if ((c.fitScore ?? 0) < 4) {
    return { keep: false, reason: `Low fit score (${c.fitScore})` }
  }

  return { keep: true }
}
