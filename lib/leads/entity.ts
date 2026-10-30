// Entity check: is a channel run by an individual creator, or by a company?
// A model (Groq, then Gemini, then local Ollama: lib/llm/router.ts) reads the creator's
// own text and must copy an exact quote that shows its answer. The quote is then checked word for word against that text:
// the creator's words are the evidence, the model only points at them. A missing or
// altered quote, or "unsure", leaves the row for a person to review.
import { defaultRouter, type LlmRouter } from "../llm/router"

export const ENTITY_ANSWERS = ["individual", "agency", "brand", "publication", "unsure"] as const
export type EntityAnswer = (typeof ENTITY_ANSWERS)[number]

export type EntitySource = {
  channelUrl: string
  title: string
  description: string
  // description: optional, fetched only for leads the title-only check couldn't decide (hosts often
  // write "I'm …" or "hosted by …" there). A quote found in it points at that video.
  videos: { url: string; title: string; description?: string }[]
}

export type EntityVerdict = {
  entityType: EntityAnswer | "needs_review"
  quote: string | null
  evidenceUrl: string | null
  reason: string
  model: string
}

const SYSTEM = `You classify who runs a YouTube channel.
- "individual": one person, or co-hosts, publishing as themselves (creator, podcaster, coach, consultant, educator). A personal brand named after the person counts.
- "agency": a marketing, talent or production agency, or a management firm.
- "brand": a company or product selling its own goods or software.
- "publication": a media outlet, network, magazine, news site, directory or fan/compilation account.
- "unsure": the text doesn't show it.
Copy one short exact quote (max 15 words) from the channel text that shows WHO runs the channel: a sentence where the person introduces themselves, names the hosts, or describes the organisation. Copy it character for character from the channel text only, never from these instructions. A video title about some topic doesn't show who runs the channel. If no quote shows it, answer "unsure".`

const SCHEMA = {
  type: "object",
  properties: { entity: { type: "string", enum: [...ENTITY_ANSWERS] }, quote: { type: "string" } },
  required: ["entity", "quote"],
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim()

export function entityPrompt(src: EntitySource): string {
  return [
    `Channel name: ${src.title}`,
    `Channel description: ${src.description.slice(0, 900) || "(none)"}`,
    `Recent video titles:`,
    ...src.videos.filter((v) => v.title).slice(0, 8).map((v) => `- ${v.title}`),
    ...(src.videos.some((v) => v.description)
      ? [`Recent video descriptions:`, ...src.videos.filter((v) => v.description).slice(0, 5).map((v) => `- ${v.description!.replace(/\s+/g, " ").slice(0, 400)}`)]
      : []),
  ].join("\n")
}

/** Where in the creator's own text a quote appears, or null if it doesn't (word for word, ignoring case and spacing). */
export function locateQuote(src: EntitySource, quote: string): string | null {
  const q = norm(quote).replace(/^["'“”]+|["'“”.]+$/g, "")
  if (q.length < 6) return null
  if (norm(src.title).includes(q) || norm(src.description).includes(q)) return `${src.channelUrl}/about`
  const v = src.videos.find((x) => norm(x.title).includes(q))
    ?? src.videos.find((x) => x.description && norm(x.description.replace(/\s+/g, " ").slice(0, 400)).includes(q))
  return v ? v.url : null
}

// The quote must also say who runs the channel, not just exist. Checked by code, so a
// real but irrelevant quote (a video topic, a slogan) can't decide the entity type.
const PERSON_RE = /\b(i'?m|i am|i've|i'll|i help|i teach|i coach|my name|my (?:show|channel|podcast|journey|life|family|husband|wife|kids)|join me|with me|me and|hosted by|host(?:ed)?|co-?hosts?|your hosts?|with your host)\b/i
const ORG_RE = /\b(agency|we are an?|we're an?|our (?:team|company|clients|agency|network)|company|network|magazine|newspaper|news|media group|official (?:channel|youtube)|inc|llc|ltd|limited|studios?|productions|brand|publication)\b/i

export function quoteShowsEntity(entity: EntityAnswer, quote: string): boolean {
  const q = norm(quote)
  if (entity === "individual") return PERSON_RE.test(q)
  if (entity === "agency" || entity === "brand" || entity === "publication") return ORG_RE.test(q)
  return false
}

/** Turn a model answer into a verdict. Only a located quote that says who runs the channel can set the entity type. */
export function verdictFrom(src: EntitySource, answer: { entity?: string; quote?: string }, model: string): EntityVerdict {
  const entity = (ENTITY_ANSWERS as readonly string[]).includes(answer.entity ?? "") ? (answer.entity as EntityAnswer) : "unsure"
  const quote = (answer.quote ?? "").trim()
  if (entity === "unsure") return { entityType: "needs_review", quote: null, evidenceUrl: null, reason: "model unsure", model }
  const at = locateQuote(src, quote)
  if (!at) return { entityType: "needs_review", quote: quote || null, evidenceUrl: null, reason: `quote not found in the channel's text: "${quote.slice(0, 60)}"`, model }
  if (!quoteShowsEntity(entity, quote)) return { entityType: "needs_review", quote, evidenceUrl: at, reason: `quote doesn't say who runs the channel (model said ${entity}): "${quote.slice(0, 60)}"`, model }
  return { entityType: entity, quote, evidenceUrl: at, reason: `quote found at ${at}`, model }
}

export async function classifyEntity(src: EntitySource, opts: { router?: LlmRouter; subjectRef?: string } = {}) {
  const router = opts.router ?? defaultRouter()
  const started = Date.now()
  const r = await router.call({
    purpose: "entity_check",
    subjectRef: opts.subjectRef ?? src.channelUrl,
    json: true,
    schema: SCHEMA,
    maxTokens: 800, // the default hosted models reason first; 200 ran out before the JSON
    messages: [
      { role: "system", content: `${SYSTEM}
Reply with JSON only: {"entity": one of ${ENTITY_ANSWERS.join("|")}, "quote": "..."}.` },
      { role: "user", content: entityPrompt(src) },
    ],
    parse: (m) => {
      const v = JSON.parse((m.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "")) as { entity?: string; quote?: string }
      if (!v || typeof v !== "object" || typeof v.entity !== "string") throw new Error(`reply has no "entity": ${(m.content ?? "").slice(0, 80)}`)
      return v
    },
  })
  const model = `${r.provider}/${r.model}`
  return { answer: r.value, verdict: verdictFrom(src, r.value, model), ms: Date.now() - started, provider: r.provider }
}
