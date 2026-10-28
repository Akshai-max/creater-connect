// Deterministic, evidence-grounded outreach sequences. Every message references
// a real content item from the lead's evidence, names the sender, and carries
// opt-out language. No AI: drafts can only say what the evidence supports.
import { CHANNEL_LIMITS, OPT_OUT, VALUE_PROPS } from "./config"
import { isoDate, parseDate } from "./normalize"
import {
  NEED_SIGNALS,
  OUTREACH_CHANNELS,
  type ChannelRecommendation,
  type ContentItem,
  type GeneratedMessage,
  type LeadInput,
  type NeedSignal,
  type OutreachChannel,
  type Sender,
} from "./types"

export function sortedContent(items: ContentItem[]): ContentItem[] {
  return [...items]
    .filter((i) => parseDate(i.publishedAt) && i.url && i.title)
    .sort((a, b) => parseDate(b.publishedAt)!.getTime() - parseDate(a.publishedAt)!.getTime() || a.url.localeCompare(b.url))
}

const firstName = (name: string) => name.trim().split(/\s+/)[0]
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)
const kind = (i: ContentItem) => (i.isLongform ? "episode" : "video")

export function personalizationHook(item: ContentItem | undefined): string | null {
  if (!item) return null
  return `Recent ${kind(item)} "${item.title}" (${isoDate(parseDate(item.publishedAt)!)})`
}

function valueProp(need: string | null): string {
  return (NEED_SIGNALS as readonly string[]).includes(need ?? "") ? VALUE_PROPS[need as NeedSignal] : VALUE_PROPS.content_creation
}

function emailSignature(s: Sender): string {
  return [`${s.name}, ${s.role} at ${s.company}`, s.website, s.postalAddress].filter(Boolean).join("\n")
}

function build(channel: OutreachChannel, seq: 1 | 2 | 3, input: LeadInput, s: Sender, items: ContentItem[]): { subject: string | null; body: string; refs: string[] } {
  const hi = `Hi ${firstName(input.creatorName)},`
  const main = items[0]
  const second = items[1] ?? items[0]
  const vp = valueProp(input.need)
  // A stated need quotes the creator; an observed one says what we saw on their channel.
  const needText = input.needSignalText?.replace(/\.$/, "")
  const needLine = !needText ? "" : input.needSource === "observed" ? ` I noticed ${needText}.` : ` You mentioned ${needText}.`
  const refs = [main.url, input.needEvidenceUrl].filter(Boolean) as string[]

  if (channel === "email") {
    if (seq === 1) {
      return {
        subject: clip(`Idea for "${main.title}"`, 70),
        body: `${hi}\n\nI just went through your ${kind(main)} "${main.title}" (${main.url}).${needLine}\n\nI work at ${s.company}. We help creators ${vp}. Would it help if I sent a short example built from that ${kind(main)}?\n\n${emailSignature(s)}\n\n${OPT_OUT.email}`,
        refs,
      }
    }
    if (seq === 2) {
      return {
        subject: clip(`Re: Idea for "${main.title}"`, 70),
        body: `${hi}\n\nFollowing up on my note about "${main.title}". Your newer ${kind(second)} "${second.title}" (${second.url}) would work just as well for the example. Happy to send it over, no call needed.\n\n${emailSignature(s)}\n\n${OPT_OUT.email}`,
        refs: [...refs, second.url],
      }
    }
    return {
      subject: clip(`Closing the loop`, 70),
      body: `${hi}\n\nI'll stop here so I don't crowd your inbox. If you ever want help to ${vp}, just reply to this email.\n\n${emailSignature(s)}\n\n${OPT_OUT.email}`,
      refs,
    }
  }

  const optOut = OPT_OUT.dm
  if (channel === "linkedin") {
    if (seq === 1) {
      // Connection note: hard 300-char limit, so title is clipped to fit.
      const fixed = `${hi} I enjoyed your ${kind(main)} "". I'm ${s.name}, ${s.role} at ${s.company}; we help creators ${vp}. ${optOut}`
      const room = Math.max(15, CHANNEL_LIMITS.linkedin.connection - fixed.length)
      return { subject: null, body: `${hi} I enjoyed your ${kind(main)} "${clip(main.title, room)}". I'm ${s.name}, ${s.role} at ${s.company}; we help creators ${vp}. ${optOut}`, refs }
    }
    if (seq === 2) {
      return {
        subject: null,
        body: `Thanks for connecting, ${firstName(input.creatorName)}.${needLine} If useful, I can put together a short example from "${second.title}" (${second.url}) to show how ${s.company} could ${vp}. Worth sending?\n\n${s.name}, ${s.role}, ${s.company}\n${optOut}`,
        refs: [...refs, second.url],
      }
    }
    return { subject: null, body: `${hi} last note from me. If ${s.company} could help later, my inbox is open.\n\n${s.name}, ${s.role}, ${s.company}\n${optOut}`, refs }
  }

  // instagram
  if (seq === 1) {
    return {
      subject: null,
      body: `${hi} just watched "${clip(main.title, 90)}" and really liked it.${needLine} I'm ${s.name} from ${s.company}; we help creators ${vp}. Could I send you a quick example made from that ${kind(main)}? ${optOut}`,
      refs,
    }
  }
  if (seq === 2) {
    return { subject: null, body: `${hi} quick follow-up: happy to make the example from "${clip(second.title, 90)}" instead if that's easier. ${s.name}, ${s.company}. ${optOut}`, refs: [...refs, second.url] }
  }
  return { subject: null, body: `${hi} won't keep messaging. If you ever want that example, just reply here. ${s.name}, ${s.company}. ${optOut}`, refs }
}

export function generateSequences(
  input: LeadInput,
  rec: ChannelRecommendation,
  sender: Sender | null,
  channels: readonly OutreachChannel[] = OUTREACH_CHANNELS,
): GeneratedMessage[] {
  const items = sortedContent(input.contentItems)
  const out: GeneratedMessage[] = []
  for (const ch of channels) {
    const unavailable = rec.unavailable.find((u) => u.channel === ch)
    const reason = !sender
      ? "Sender identity not configured (set SENDER_NAME, SENDER_ROLE, SENDER_COMPANY)."
      : unavailable
      ? unavailable.reason
      : items.length === 0
      ? "No dated content item with URL and title to personalize from."
      : null
    for (const seq of [1, 2, 3] as const) {
      if (reason) {
        out.push({ channel: ch, sequence: seq, subject: null, body: "", status: "unavailable", unavailableReason: reason, evidenceRefs: [] })
        continue
      }
      const m = build(ch, seq, input, sender!, items)
      out.push({ channel: ch, sequence: seq, subject: m.subject, body: m.body, status: "draft", unavailableReason: null, evidenceRefs: [...new Set(m.refs)] })
    }
  }
  return out
}

// Segment-level sequence templates (the brief's "sequences for each segment on at
// least 3 channels"). Rendered from the same builder as per-lead drafts, with
// {{placeholders}} where lead evidence goes, so the two can never drift apart.
const SEGMENT_TEMPLATE_INPUTS: { label: string; segment: string; need: NeedSignal; longform: boolean }[] = [
  { label: "Podcaster/Video Podcaster", segment: "video_podcaster", need: "repurposing", longform: true },
  { label: "YouTuber/Video-First Creator", segment: "youtuber", need: "publishing_consistency", longform: false },
  { label: "Expert-Led Creator", segment: "expert_creator", need: "content_creation", longform: true },
]

export function segmentTemplatesMarkdown(sender: Sender | null): string {
  const s = sender ?? { name: "{{sender_name}}", role: "{{sender_role}}", company: "{{sender_company}}", website: "{{sender_website}}", postalAddress: "{{sender_postal_address}}" }
  const parts = [
    "# Outreach sequences by segment\n",
    "Templates for each segment on 3 channels (email, LinkedIn, Instagram): 1 initial message + 2 follow-ups.",
    "Per-lead drafts in this folder fill the {{placeholders}} from that lead's stored evidence only.",
    "Cadence: initial on day 0, follow-up 1 on day 3, follow-up 2 on day 7. LinkedIn and Instagram are sent by hand.\n",
  ]
  for (const t of SEGMENT_TEMPLATE_INPUTS) {
    const item = (n: 1 | 2): ContentItem => ({ url: `{{recent_content_url_${n}}}`, title: `{{recent_content_title_${n}}}`, publishedAt: "2000-01-0" + n, isLongform: t.longform })
    const input = { creatorName: "{{first_name}}", need: t.need, needSignalText: "{{need_evidence_paraphrase}}", needEvidenceUrl: "{{need_evidence_url}}" } as LeadInput
    parts.push(`## ${t.label}\n\n_Example need: ${t.need} → "${VALUE_PROPS[t.need]}". The value line follows each lead's evidenced need._\n`)
    for (const ch of OUTREACH_CHANNELS) {
      parts.push(`### ${ch}\n`)
      for (const seq of [1, 2, 3] as const) {
        const m = build(ch, seq, input, s, [item(1), item(2)])
        parts.push(`#### ${seq === 1 ? "Initial" : `Follow-up ${seq - 1}`}\n${m.subject ? `**Subject:** ${m.subject}\n\n` : ""}${m.body}\n`)
      }
    }
  }
  return parts.join("\n")
}

export type MessageValidation = { ok: boolean; problems: string[] }

export function validateMessage(m: Pick<GeneratedMessage, "channel" | "sequence" | "body" | "subject">, sender: Sender, contentRef: { title: string; url: string } | null): MessageValidation {
  const problems: string[] = []
  const body = m.body ?? ""
  const limit = m.channel === "email" ? CHANNEL_LIMITS.email : m.channel === "linkedin" ? (m.sequence === 1 ? CHANNEL_LIMITS.linkedin.connection : CHANNEL_LIMITS.linkedin.message) : CHANNEL_LIMITS.instagram
  if (!body.trim()) problems.push("empty body")
  if (body.length > limit) problems.push(`body ${body.length} chars exceeds ${m.channel} limit ${limit}`)
  if (!body.includes(sender.name) || !body.includes(sender.company)) problems.push("missing sender identification")
  if (!/unsubscribe|no thanks/i.test(body)) problems.push("missing opt-out language")
  if (m.channel === "email" && !m.subject) problems.push("email missing subject")
  if (m.sequence === 1 && contentRef && !body.includes(contentRef.title.slice(0, 15)) && !body.includes(contentRef.url)) problems.push("no reference to specific content item")
  return { ok: problems.length === 0, problems }
}
