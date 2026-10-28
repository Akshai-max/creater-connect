// Checks every agent proposal must pass before it is stored (and again when a
// reviewer approves an edited version). Pure functions: no DB, no network.
import { CHANNEL_LIMITS } from "../leads/config"
import type { Sender } from "../leads/types"
import type { PitchChannel } from "./config"

export type PitchDraft = {
  channel: PitchChannel
  recipient: string | null
  subject: string | null
  body: string
  evidenceUrls: string[]
}

export type PitchContext = {
  sender: Sender | null
  // Contact values the creator publishes for this channel (from stored evidence).
  knownRecipients: string[]
  // URLs present in stored evidence; the agent may cite only these.
  allowedEvidence: string[]
  // Titles/URLs of the creator's content; the first message must reference one when any exist.
  contentRefs: { title: string; url: string }[]
  isFirstMessage: boolean
}

const norm = (s: string) => s.trim().toLowerCase().replace(/^@/, "").replace(/\/+$/, "")

export function validatePitch(d: PitchDraft, ctx: PitchContext): string[] {
  const problems: string[] = []
  const body = d.body ?? ""
  if (!ctx.sender) problems.push("sender identity not configured (SENDER_NAME, SENDER_ROLE, SENDER_COMPANY)")
  if (!body.trim()) problems.push("empty body")

  const limit = d.channel === "email" ? CHANNEL_LIMITS.email : d.channel === "linkedin" ? CHANNEL_LIMITS.linkedin.message : CHANNEL_LIMITS.instagram
  if (body.length > limit) problems.push(`body is ${body.length} chars; ${d.channel} limit is ${limit}`)
  if (d.channel === "email" && !d.subject?.trim()) problems.push("email needs a subject")
  if (ctx.sender && (!body.includes(ctx.sender.name) || !body.includes(ctx.sender.company)))
    problems.push(`body must name the sender ("${ctx.sender.name}") and company ("${ctx.sender.company}")`)
  if (!/unsubscribe|no thanks/i.test(body)) problems.push('body must include an opt-out ("reply unsubscribe" for email, "reply no thanks" for DMs)')
  if (d.channel === "email" && ctx.sender && !ctx.sender.postalAddress) problems.push("email needs SENDER_POSTAL_ADDRESS (CAN-SPAM)")

  // No invented contacts: the recipient must be a route the creator publishes.
  if (!d.recipient) problems.push(`no published ${d.channel} contact for this creator`)
  else if (!ctx.knownRecipients.some((r) => norm(r) === norm(d.recipient!)))
    problems.push(`recipient "${d.recipient}" is not a published ${d.channel} contact for this creator`)

  // No invented evidence: every cited URL must already be stored.
  if (!d.evidenceUrls.length) problems.push("cite at least one evidence URL from get_details")
  const allowed = new Set(ctx.allowedEvidence.map(norm))
  const unknown = d.evidenceUrls.filter((u) => !allowed.has(norm(u)))
  if (unknown.length) problems.push(`evidence URLs not in stored evidence: ${unknown.join(", ")}`)

  if (ctx.isFirstMessage && ctx.contentRefs.length) {
    const lower = body.toLowerCase()
    const refs = ctx.contentRefs.some((c) => lower.includes(c.title.slice(0, 20).toLowerCase()) || body.includes(c.url))
    if (!refs) problems.push("first message must mention one of the creator's specific content items (title or URL from get_details)")
  }
  return problems
}

export function validateRationale(rationale: string, confidence: number): string[] {
  const problems: string[] = []
  if (!rationale || rationale.trim().length < 20) problems.push("rationale must explain the decision (20+ characters)")
  if (!(confidence >= 0 && confidence <= 1)) problems.push("confidence must be between 0 and 1")
  return problems
}
