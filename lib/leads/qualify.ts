// Deterministic qualification engine. Each assessment criterion is one check.
// A failing "reject" check means evidence shows the lead does NOT qualify;
// a failing "unverified" check means evidence is missing or malformed.
// AI fit scores never feed into this — qualification is evidence only.
import { RULES } from "./config"
import { isValidEvidenceUrl, isValidStableId, normalizePlatform, parseDate, profileUrlMatchesPlatform, withinDays } from "./normalize"
import { sortedContent } from "./messages"
import {
  APPROVED_COUNTRIES,
  CONTACT_SOURCES,
  EXCLUDED_ENTITY_TYPES,
  MONETIZATION_SIGNALS,
  NEED_SIGNALS,
  SEGMENTS,
  type CandidateStatus,
  type ChannelRecommendation,
  type LeadInput,
  type QualificationCheck,
} from "./types"

export type ActivityMetrics = {
  contentCount30d: number
  longformCount60d: number
  lastContentDate: string | null
  invalidItems: number
}

export function computeActivity(input: LeadInput, now: Date): ActivityMetrics {
  let c30 = 0
  let l60 = 0
  let invalid = 0
  let last: Date | null = null
  for (const item of input.contentItems) {
    const d = parseDate(item.publishedAt)
    if (!d || !isValidEvidenceUrl(item.url)) { invalid++; continue }
    if (withinDays(item.publishedAt, RULES.activityWindowDays, now)) c30++
    if (item.isLongform && withinDays(item.publishedAt, RULES.longformWindowDays, now)) l60++
    if (d.getTime() <= now.getTime() && (!last || d > last)) last = d
  }
  return { contentCount30d: c30, longformCount60d: l60, lastContentDate: last ? last.toISOString().slice(0, 10) : null, invalidItems: invalid }
}

export type QualifyContext = {
  now: Date
  channels: ChannelRecommendation
  duplicateOf: string | null // lead_id this record duplicates, if any
  firstMessageProblems: string[] | null // null = no message could be generated
}

export type QualificationResult = {
  status: CandidateStatus
  checks: QualificationCheck[]
  rejectionReason: string | null
  activity: ActivityMetrics
  missingFields: string[]
}

const REQUIRED_FIELDS: (keyof LeadInput)[] = [
  "creatorName", "segment", "countryIso2", "primaryLanguage", "primaryPlatform", "profileUrl",
  "stableCreatorId", "monetizationSignal", "monetizationEvidenceUrl", "need", "needEvidenceUrl", "checkedDate",
]

export function missingRequiredFields(input: LeadInput): string[] {
  return REQUIRED_FIELDS.filter((f) => {
    const v = input[f]
    return v == null || (typeof v === "string" && v.trim() === "")
  })
}

export function qualify(input: LeadInput, ctx: QualifyContext): QualificationResult {
  const { now } = ctx
  const checks: QualificationCheck[] = []
  const add = (id: string, label: string, pass: boolean, severity: QualificationCheck["severity"], reason: string) =>
    checks.push({ id, label, pass, severity, reason: pass ? "ok" : reason })

  // 1. Real creator, approved category, approved country, English.
  const excluded = (EXCLUDED_ENTITY_TYPES as readonly string[]).includes(input.entityType)
  add("entity", "Individual creator (not agency/brand/publication/directory/fan)", !excluded && input.entityType === "individual",
    excluded ? "reject" : "unverified",
    excluded ? `excluded entity type: ${input.entityType}` : `entity type "${input.entityType || "missing"}" is not "individual"`)
  const segOk = (SEGMENTS as readonly string[]).includes(input.segment)
  add("segment", "Approved creator segment", segOk, input.segment ? "reject" : "unverified",
    input.segment ? `segment "${input.segment}" not in ${SEGMENTS.join("/")}` : "segment missing")
  const countryOk = !!input.countryIso2 && (APPROVED_COUNTRIES as readonly string[]).includes(input.countryIso2)
  add("country", "Approved country with evidence", countryOk && isValidEvidenceUrl(input.countryEvidenceUrl),
    input.countryIso2 && !countryOk ? "reject" : "unverified",
    !input.countryIso2 ? "country missing" : !countryOk ? `country ${input.countryIso2} not approved` : "country evidence URL missing or malformed")
  add("language", "Recent content mainly in English", input.primaryLanguage === "en",
    input.primaryLanguage ? "reject" : "unverified",
    input.primaryLanguage ? `primary language "${input.primaryLanguage}" is not English` : "primary language missing")

  // 2. Official profile + stable identifier.
  const platform = normalizePlatform(input.primaryPlatform)
  const profileOk = !!platform && profileUrlMatchesPlatform(input.profileUrl, platform)
  const idOk = !!platform && isValidStableId(input.stableCreatorId, platform)
  add("profile", "Official profile URL + stable platform id", profileOk && idOk, "unverified",
    !profileOk ? `profile URL does not match platform ${input.primaryPlatform}` : `stable id "${input.stableCreatorId}" is not a valid ${platform} id`)

  // 3. Activity: ≥8 items in 30d OR ≥2 long-form in 60d.
  const activity = computeActivity(input, now)
  const active = activity.contentCount30d >= RULES.minContent30d || activity.longformCount60d >= RULES.minLongform60d
  const hasContentEvidence = input.contentItems.length - activity.invalidItems > 0
  // Items of unknown length in the 60-day window could still be long-form, so a
  // shortfall is "unverified" (fetch durations), never a rejection.
  const unknownLength = input.contentItems.filter((i) => i.isLongform === null && withinDays(i.publishedAt, RULES.longformWindowDays, now)).length
  const couldPass = activity.longformCount60d + unknownLength >= RULES.minLongform60d
  add("activity", `≥${RULES.minContent30d} items/30d or ≥${RULES.minLongform60d} long-form/60d`, active,
    hasContentEvidence && !couldPass ? "reject" : "unverified",
    !hasContentEvidence
      ? "no valid dated content items in evidence"
      : couldPass
      ? `only ${activity.contentCount30d} items in 30d and ${activity.longformCount60d} confirmed long-form in 60d; ${unknownLength} items of unknown length (fetch durations with YOUTUBE_API_KEY)`
      : `only ${activity.contentCount30d} items in 30d and ${activity.longformCount60d} long-form in 60d`)

  // 4. Commercial activity.
  const monOk = (MONETIZATION_SIGNALS as readonly string[]).includes(input.monetizationSignal ?? "") && isValidEvidenceUrl(input.monetizationEvidenceUrl)
  add("monetization", "Public monetization evidence", monOk, "unverified",
    !input.monetizationSignal ? "monetization signal missing" : !isValidEvidenceUrl(input.monetizationEvidenceUrl) ? "monetization evidence URL missing or malformed" : `unknown monetization signal "${input.monetizationSignal}"`)

  // 5. Demonstrated need.
  const needOk = (NEED_SIGNALS as readonly string[]).includes(input.need ?? "") && isValidEvidenceUrl(input.needEvidenceUrl)
  add("need", "Public evidence of a relevant need", needOk, "unverified",
    !input.need ? "need missing" : !isValidEvidenceUrl(input.needEvidenceUrl) ? "need evidence URL missing or malformed" : `unknown need "${input.need}"`)

  // 6 + 7. Business contact route, published (never guessed), active ≤60d.
  const guessed = input.contacts.filter((c) => c.source !== "published")
  add("no_guessing", "No guessed or inferred contact routes", guessed.length === 0, "reject",
    `${guessed.map((c) => `${c.channel} is ${(CONTACT_SOURCES as readonly string[]).includes(c.source) ? c.source : `"${c.source}"`}`).join(", ")}`)
  add("contact", `Verified business contact active within ${RULES.contactActiveDays}d`, !!ctx.channels.best, "unverified",
    ctx.channels.unavailable.map((u) => u.reason).join(" ") || "no usable contact route")

  // 8. Personalization from a specific recent item.
  const recent = sortedContent(input.contentItems).find((i) => withinDays(i.publishedAt, RULES.personalizationMaxAgeDays, now))
  add("personalization", `Specific content item from last ${RULES.personalizationMaxAgeDays}d to personalize`, !!recent, "unverified",
    "no dated content item with title + URL in the personalization window")

  // 9. Sender identification + opt-out in the generated message.
  const msgOk = ctx.firstMessageProblems !== null && ctx.firstMessageProblems.length === 0
  add("message", "First message has sender ID, opt-out, content reference", msgOk, "unverified",
    ctx.firstMessageProblems === null ? "no first message could be generated" : ctx.firstMessageProblems.join("; "))

  // 10. Complete, freshly checked, unique.
  const missing = missingRequiredFields(input)
  add("complete", "All required fields present", missing.length === 0, "unverified", `missing: ${missing.join(", ")}`)
  const checked = parseDate(input.checkedDate)
  const fresh = withinDays(input.checkedDate, RULES.evidenceFreshnessDays, now)
  add("fresh", `Evidence checked within ${RULES.evidenceFreshnessDays}d`, fresh, "unverified",
    !checked ? "checked_date missing or malformed" : checked > now ? "checked_date is in the future" : `checked_date older than ${RULES.evidenceFreshnessDays}d`)
  add("unique", "Unique (stable id + canonical profile URL)", !ctx.duplicateOf, "reject", `duplicate of ${ctx.duplicateOf}`)

  const failing = checks.filter((c) => !c.pass)
  const status: CandidateStatus = failing.some((c) => c.severity === "reject") ? "rejected" : failing.length ? "unverified" : "qualified"
  // Rejection-severity reasons first so the headline reason is the decisive one.
  const ordered = [...failing].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "reject" ? -1 : 1))
  return {
    status,
    checks,
    rejectionReason: ordered.length ? ordered.map((c) => `${c.id}: ${c.reason}`).join(" | ") : null,
    activity,
    missingFields: missing,
  }
}
