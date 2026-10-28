// Shared types + constants for the lead-generation engine.
// Everything in lib/leads/ except repo.ts / engine.ts is pure (no DB access),
// so the rules can be unit-tested and reasoned about deterministically.

export const APPROVED_COUNTRIES = ["US", "CA", "GB", "IE", "AU", "NZ", "SG"] as const
export type ApprovedCountry = (typeof APPROVED_COUNTRIES)[number]

export const SEGMENTS = ["podcaster", "video_podcaster", "youtuber", "expert_creator"] as const
export type Segment = (typeof SEGMENTS)[number]

// Entity types we must exclude even if they publish content.
export const EXCLUDED_ENTITY_TYPES = ["agency", "management", "brand", "publication", "directory", "fan_account"] as const

export const PLATFORMS = ["youtube", "instagram", "tiktok", "apple_podcasts", "spotify", "linkedin", "x"] as const
export type Platform = (typeof PLATFORMS)[number]

export const OUTREACH_CHANNELS = ["email", "linkedin", "instagram"] as const
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number]

export const MONETIZATION_SIGNALS = ["sponsorship", "product", "service", "course", "membership", "subscription", "affiliate", "other"] as const
export const NEED_SIGNALS = [
  "content_creation",
  "repurposing",
  "editing",
  "captions",
  "publishing_consistency",
  "content_backlog",
  "team_workflow",
] as const
export type NeedSignal = (typeof NEED_SIGNALS)[number]

// How a contact route was obtained. Only "published" routes count as evidence.
export const CONTACT_SOURCES = ["published", "guessed", "inferred"] as const

export type ContentItem = {
  url: string
  title: string
  publishedAt: string // ISO date or datetime
  isLongform: boolean | null // null = duration unknown (e.g. RSS feeds carry no duration)
}

export type ContactRoute = {
  channel: OutreachChannel
  value: string // email address, LinkedIn URL, or Instagram handle
  evidenceUrl: string | null // public page where the creator publishes this route
  lastActiveAt: string | null // most recent evidence the route is in use
  source: string // "published" | "guessed" | "inferred"
  businessUse: boolean // evidence states it's for business / collaborations
  responseEvidenceUrl?: string | null // evidence the creator replies on this route (rare)
}

export type LeadInput = {
  creatorName: string
  segment: string
  entityType: string // "individual" for real creators
  countryIso2: string | null
  countryEvidenceUrl: string | null
  primaryLanguage: string | null
  primaryPlatform: string
  profileUrl: string
  stableCreatorId: string
  followers: number | null
  contentItems: ContentItem[]
  monetizationSignal: string | null
  monetizationEvidenceUrl: string | null
  need: string | null
  needSignalText: string | null // short paraphrase of the public need evidence
  // "stated": the creator said it. "observed": read from their public channel data
  // (e.g. no caption tracks, no Shorts). Messages phrase the two differently.
  needSource?: "stated" | "observed" | null
  needEvidenceUrl: string | null
  contacts: ContactRoute[]
  checkedDate: string | null // when a human/provider last verified the evidence
  source: string
  sourceRef: string | null
}

export type CheckSeverity = "reject" | "unverified"
export type QualificationCheck = {
  id: string
  label: string
  pass: boolean
  severity: CheckSeverity // what a failure means
  reason: string
}

export type CandidateStatus = "qualified" | "unverified" | "rejected"

export type ScoreFactor = { key: string; label: string; points: number; max: number; reason: string }

export type ChannelOption = {
  channel: OutreachChannel
  value: string
  evidenceUrl: string | null
  verified: boolean
  active: boolean
  score: number
  notes: string[]
}

export type ChannelRecommendation = {
  best: OutreachChannel | null
  backup: OutreachChannel | null
  bestValue: string | null
  bestEvidenceUrl: string | null
  bestReason: string
  backupReason: string
  evidenceUsed: string[]
  verificationStatus: "verified" | "partial" | "none"
  options: ChannelOption[]
  unavailable: { channel: OutreachChannel; reason: string }[]
}

export type GeneratedMessage = {
  channel: OutreachChannel
  sequence: 1 | 2 | 3
  subject: string | null
  body: string
  status: "draft" | "unavailable"
  unavailableReason: string | null
  evidenceRefs: string[]
}

export type Sender = {
  name: string
  role: string
  company: string
  website: string | null
  postalAddress: string | null
}
