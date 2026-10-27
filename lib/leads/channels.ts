// Transparent best/backup channel selection. Only routes the creator publishes
// count; we never infer that someone responds on a channel without evidence.
import { RULES } from "./config"
import { isValidContactValue, isValidEvidenceUrl, parseDate, ageDays, withinDays } from "./normalize"
import { OUTREACH_CHANNELS, type ChannelOption, type ChannelRecommendation, type ContactRoute, type OutreachChannel } from "./types"

// Suitability for a first B2B pitch, plus the platform restriction we honor.
const CHANNEL_PROFILE: Record<OutreachChannel, { suitability: number; restriction: string }> = {
  email: { suitability: 3, restriction: "Commercial email: include sender identity, postal address and opt-out (CAN-SPAM/GDPR/PECR)." },
  linkedin: { suitability: 2, restriction: "LinkedIn: send manually from your own account; no automation tools (User Agreement §8.2)." },
  instagram: { suitability: 1, restriction: "Instagram: send manually; automated DMs to non-followers violate Meta platform terms." },
}

export function assessRoute(route: ContactRoute, now: Date): ChannelOption {
  const notes: string[] = []
  const validValue = isValidContactValue(route.channel, route.value)
  const evidence = isValidEvidenceUrl(route.evidenceUrl)
  const published = route.source === "published"
  if (!validValue) notes.push(`malformed ${route.channel} value`)
  if (!evidence) notes.push("no valid public evidence URL")
  if (!published) notes.push(`route is ${route.source}, not published by the creator`)
  const verified = validValue && evidence && published
  const active = withinDays(route.lastActiveAt, RULES.contactActiveDays, now)
  if (!active) notes.push(route.lastActiveAt ? `last activity older than ${RULES.contactActiveDays}d or invalid date` : "no activity date")
  if (!route.businessUse) notes.push("no evidence it is used for business enquiries")

  let score = 0
  if (verified) {
    score += 10
    if (route.businessUse) score += 4
    if (active) {
      const d = parseDate(route.lastActiveAt)!
      score += ageDays(d, now) <= 30 ? 3 : 2
    }
    if (isValidEvidenceUrl(route.responseEvidenceUrl)) score += 2
    score += CHANNEL_PROFILE[route.channel].suitability
  }
  return { channel: route.channel, value: route.value, evidenceUrl: route.evidenceUrl, verified, active, score, notes }
}

export function recommendChannels(contacts: ContactRoute[], now: Date): ChannelRecommendation {
  // One option per channel: keep the strongest route if several are listed.
  const byChannel = new Map<OutreachChannel, ChannelOption>()
  for (const r of contacts) {
    const opt = assessRoute(r, now)
    const prev = byChannel.get(r.channel)
    if (!prev || opt.score > prev.score) byChannel.set(r.channel, opt)
  }
  const options = [...byChannel.values()]
  // Usable = verified AND active AND business use. Deterministic tie-break by channel order.
  const usable = options
    .filter((o) => o.verified && o.active && !o.notes.some((n) => n.startsWith("no evidence it is used")))
    .sort((a, b) => b.score - a.score || OUTREACH_CHANNELS.indexOf(a.channel) - OUTREACH_CHANNELS.indexOf(b.channel))

  const unavailable: ChannelRecommendation["unavailable"] = []
  for (const ch of OUTREACH_CHANNELS) {
    const o = byChannel.get(ch)
    if (!o) unavailable.push({ channel: ch, reason: `No ${ch} route found in public evidence; not inferred.` })
    else if (!usable.includes(o)) unavailable.push({ channel: ch, reason: `${ch} route not usable: ${o.notes.join("; ")}.` })
  }

  const best = usable[0] ?? null
  const backup = usable[1] ?? null
  const why = (o: ChannelOption) => {
    const parts = [`published ${o.channel} route with evidence (${o.evidenceUrl})`, "marked for business use", o.active ? `active within ${RULES.contactActiveDays}d` : ""]
    parts.push(CHANNEL_PROFILE[o.channel].restriction)
    return parts.filter(Boolean).join("; ")
  }

  return {
    best: best?.channel ?? null,
    backup: backup?.channel ?? null,
    bestValue: best?.value ?? null,
    bestEvidenceUrl: best?.evidenceUrl ?? null,
    bestReason: best ? `Highest-scoring verified route (score ${best.score}): ${why(best)}. No response-rate evidence assumed.` : "No verified, active, business-use contact route.",
    backupReason: backup ? `Second verified route (score ${backup.score}): ${why(backup)}.` : best ? "Only one verified route; no backup available." : "No verified routes.",
    evidenceUsed: usable.map((o) => o.evidenceUrl!).filter(Boolean),
    verificationStatus: usable.length >= 2 ? "verified" : usable.length === 1 ? "partial" : "none",
    options,
    unavailable,
  }
}
