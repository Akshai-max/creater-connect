// Engine configuration. Thresholds are the assessment's rules; sender identity
// and value props come from env so nothing environment-specific is hardcoded.
import type { NeedSignal, Sender } from "./types"

export const RULES = {
  activityWindowDays: 30,
  minContent30d: 8,
  longformWindowDays: 60,
  minLongform60d: 2,
  contactActiveDays: 60,
  personalizationMaxAgeDays: 60,
  evidenceFreshnessDays: 14, // checked_date must be within this many days
  priorityACount: Number(process.env.PRIORITY_A_COUNT || 25),
  maxCountryShare: 0.6,
  minApprovedShare: 0.8,
  minApprovedCountries: 3,
} as const

export const CHANNEL_LIMITS = {
  email: 1200, // body chars; keep pitches short
  linkedin: { connection: 300, message: 700 },
  instagram: 700, // IG DMs cap at 1000; stay well under
} as const

export function senderFromEnv(env: Record<string, string | undefined> = process.env): Sender | null {
  const name = env.SENDER_NAME?.trim()
  const role = env.SENDER_ROLE?.trim()
  const company = env.SENDER_COMPANY?.trim() || env.BRAND_NAME?.trim()
  if (!name || !role || !company) return null
  return {
    name,
    role,
    company,
    website: env.SENDER_WEBSITE?.trim() || null,
    postalAddress: env.SENDER_POSTAL_ADDRESS?.trim() || null,
  }
}

// What the product does for each need. Kept modest and editable: these are
// claims about YOUR product, so adjust them to match what it actually does.
export const VALUE_PROPS: Record<NeedSignal, string> = {
  content_creation: "turn what you already record into more finished posts",
  repurposing: "turn each long episode into short clips and posts without extra editing hours",
  editing: "cut the time spent editing each episode",
  captions: "get accurate captions and transcripts out faster",
  publishing_consistency: "keep a steady publishing schedule across platforms",
  content_backlog: "work through a backlog of recorded content",
  team_workflow: "give your team one place for drafts, reviews and publishing",
}

export const OPT_OUT = {
  email: `If you'd rather not get emails from me, reply "unsubscribe" and I won't contact you again.`,
  dm: `If you'd rather not hear from me, reply "no thanks" and I won't message again.`,
} as const
