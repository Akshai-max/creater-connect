// Outreach agent: Claude (tool runner) or a local Ollama model reads the CRM through narrow tools and
// files proposals for human review. It has no tool that sends, moves a stage or
// changes a candidate - those happen only when a person approves a proposal.
import Anthropic from "@anthropic-ai/sdk"
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema"
import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner"
import { and, desc, eq, inArray, ne } from "drizzle-orm"
import { db } from "../db"
import { activities, agentProposals, agentRuns, candidates, creators, leadEvidence, leads, outreach, outreachMessages, tasks } from "../db/schema"
import { CHANNEL_LIMITS, OPT_OUT, senderFromEnv } from "../leads/config"
import { STAGES } from "../stages"
import { AGENT_LIMITS, AGENT_SOURCES, PITCH_CHANNELS, NEXT_STEP_ACTIONS, agentModel, agentProvider, costUsd, ollamaUrl, type AgentSource, type PitchChannel } from "./config"
import { validatePitch, validateRationale } from "./guardrails"
import { runOllamaLoop } from "./ollama"
import { runRouterLoop } from "../llm/agent-loop"
import { LlmRouter, providersFromEnv } from "../llm/router"
import { AGENT_SYSTEM_PROMPT, buildTask } from "./prompt"

const newId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const nowIso = () => new Date().toISOString()
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null)
const clampLimit = (n: number | undefined, d = 15) => Math.max(1, Math.min(AGENT_LIMITS.listLimitCap, Math.floor(n ?? d)))
const json = (v: unknown) => JSON.stringify(v)

export type RunOptions = {
  sources?: AgentSource[]
  instructions?: string | null
  maxProposals?: number
  includeFixtures?: boolean
  trigger?: "manual" | "api"
}

export type RunResult = {
  runId: string
  status: "succeeded" | "failed"
  proposals: number
  summary: string | null
  error: string | null
  costUsd: number
  durationMs: number
}

// ── Evidence context for a pitch subject (lead or pipeline creator) ──────────
async function pitchContext(subjectType: "lead" | "creator", subjectId: string, channel: PitchChannel) {
  if (subjectType === "lead") {
    const l = (await db.select().from(leads).where(eq(leads.id, subjectId)))[0]
    if (!l) return null
    const ev = await db.select().from(leadEvidence).where(eq(leadEvidence.leadId, subjectId))
    return {
      name: l.creatorName,
      qualified: l.candidateStatus === "qualified",
      knownRecipients: ev.filter((e) => e.kind === "contact" && e.channel === channel && e.source === "published" && e.value).map((e) => e.value!),
      allowedEvidence: ev.map((e) => e.url).filter(Boolean) as string[],
      contentRefs: ev.filter((e) => e.kind === "content" && e.url && e.label).map((e) => ({ title: e.label!, url: e.url! })),
    }
  }
  const c = (await db.select().from(creators).where(eq(creators.id, subjectId)))[0]
  if (!c) return null
  const linked = (await db.select().from(leads).where(eq(leads.creatorId, subjectId)))[0]
  const ev = linked ? await db.select().from(leadEvidence).where(eq(leadEvidence.leadId, linked.id)) : []
  return {
    name: c.name,
    qualified: true, // already in the pipeline
    knownRecipients: channel === "email" && c.email ? [c.email] : ev.filter((e) => e.kind === "contact" && e.channel === channel && e.value).map((e) => e.value!),
    allowedEvidence: [c.profileUrl, c.externalUrl, ...ev.map((e) => e.url)].filter(Boolean) as string[],
    contentRefs: ev.filter((e) => e.kind === "content" && e.url && e.label).map((e) => ({ title: e.label!, url: e.url! })),
  }
}

async function hasPending(subjectType: string, subjectId: string, kind: string) {
  const rows = await db.select({ id: agentProposals.id }).from(agentProposals).where(
    and(eq(agentProposals.subjectType, subjectType), eq(agentProposals.subjectId, subjectId), eq(agentProposals.kind, kind), eq(agentProposals.status, "pending")),
  )
  return rows.length > 0
}

async function pendingIds(subjectType: string): Promise<Set<string>> {
  const rows = await db.select({ id: agentProposals.subjectId }).from(agentProposals).where(and(eq(agentProposals.subjectType, subjectType), eq(agentProposals.status, "pending")))
  return new Set(rows.map((r) => r.id))
}

// ── Tools ───────────────────────────────────────────────────────────────────
function buildTools(run: { id: string; sources: AgentSource[]; includeFixtures: boolean; maxProposals: number; made: { n: number } }) {
  const sender = senderFromEnv()
  const capReached = () => run.made.n >= run.maxProposals
  const store = async (row: Omit<typeof agentProposals.$inferInsert, "id" | "runId" | "createdAt" | "status">) => {
    const id = newId("prop")
    await db.insert(agentProposals).values({ ...row, id, runId: run.id, createdAt: nowIso(), status: "pending" })
    run.made.n++
    return id
  }
  const tools = []

  if (run.sources.includes("leads")) {
    tools.push(
      betaTool({
        name: "list_qualified_leads",
        description: "List rule-qualified leads, highest priority and score first. Each row says whether it already has a pending proposal.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 50, description: "Rows to return (default 15)" },
            priority: { type: "string", enum: ["A", "B", "C"], description: "Only this priority" },
          },
          additionalProperties: false,
        },
        run: async ({ limit, priority }) => {
          const conds = [eq(leads.candidateStatus, "qualified")]
          if (!run.includeFixtures) conds.push(eq(leads.isFixture, false))
          if (priority) conds.push(eq(leads.priority, priority))
          const rows = await db.select().from(leads).where(and(...conds)).orderBy(desc(leads.leadScore)).limit(clampLimit(limit))
          const pending = await pendingIds("lead")
          return json(rows.map((l) => ({
            lead_id: l.id, name: l.creatorName, segment: l.segment, country: l.countryIso2, priority: l.priority, score: l.leadScore,
            need: l.need, best_channel: l.bestChannel, backup_channel: l.backupChannel, hook: l.personalizationHook,
            in_pipeline: !!l.creatorId, has_pending_proposal: pending.has(l.id), demo_fixture: l.isFixture,
          })))
        },
      }),
    )
  }

  if (run.sources.includes("candidates")) {
    tools.push(
      betaTool({
        name: "list_review_candidates",
        description: "List discovered candidates waiting on the review queue, with the discovery fit score, red flags, and the rule-based qualification status if the lead engine has evaluated them.",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "Rows to return (default 15)" } },
          additionalProperties: false,
        },
        run: async ({ limit }) => {
          const rows = await db.select().from(candidates).where(eq(candidates.status, "pending")).orderBy(desc(candidates.fitScore)).limit(clampLimit(limit))
          const linked = rows.length ? await db.select().from(leads).where(inArray(leads.candidateId, rows.map((r) => r.id))) : []
          const pending = await pendingIds("candidate")
          return json(rows.map((c) => {
            const l = linked.find((x) => x.candidateId === c.id)
            return {
              candidate_id: c.id, handle: c.handle, name: c.fullName, platform: c.platform, followers: c.followers,
              fit_score: c.fitScore, fit_reasoning: c.fitReasoning, red_flags: c.redFlags, location: c.location,
              qualification: l ? { status: l.candidateStatus, reason: l.rejectionReason } : "not evaluated",
              has_pending_proposal: pending.has(c.id),
            }
          }))
        },
      }),
    )
  }

  if (run.sources.includes("pipeline")) {
    tools.push(
      betaTool({
        name: "list_pipeline_creators",
        description: "List creators in the pipeline with their stage, days in stage, last outreach and open tasks.",
        inputSchema: {
          type: "object",
          properties: {
            stage: { type: "string", enum: [...STAGES], description: "Only this stage" },
            limit: { type: "integer", minimum: 1, maximum: 50, description: "Rows to return (default 20)" },
          },
          additionalProperties: false,
        },
        run: async ({ stage, limit }) => {
          const conds = [ne(creators.status, "archived")]
          if (stage) conds.push(eq(creators.stage, stage))
          const rows = await db.select().from(creators).where(and(...conds)).limit(clampLimit(limit, 20))
          const ids = rows.map((r) => r.id)
          const outs = ids.length ? await db.select().from(outreach).where(inArray(outreach.creatorId, ids)).orderBy(desc(outreach.createdAt)) : []
          const open = ids.length ? await db.select().from(tasks).where(and(inArray(tasks.creatorId, ids), eq(tasks.completed, false))) : []
          const pending = await pendingIds("creator")
          return json(rows.map((c) => {
            const last = outs.find((o) => o.creatorId === c.id)
            return {
              creator_id: c.id, name: c.name, handle: c.handle, platform: c.platform, stage: c.stage, days_in_stage: daysSince(c.stageChangedAt),
              has_email: !!c.email, last_outreach: last ? { status: last.status, subject: last.subject, sent_at: last.sentAt, created_at: last.createdAt } : null,
              open_tasks: open.filter((t) => t.creatorId === c.id).map((t) => t.title), has_pending_proposal: pending.has(c.id),
            }
          }))
        },
      }),
    )
  }

  tools.push(
    betaTool({
      name: "get_details",
      description: "Full stored evidence for one creator: content items, monetization and need evidence, published contacts, existing drafts, recent activity, plus the sender block and opt-out lines to use in messages.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["lead", "candidate", "creator"] },
          id: { type: "string" },
        },
        required: ["type", "id"],
        additionalProperties: false,
      },
      run: async ({ type, id }) => {
        const writing = {
          sender: sender ? { name: sender.name, role: sender.role, company: sender.company, website: sender.website, postal_address: sender.postalAddress } : "NOT CONFIGURED - pitches will be rejected until SENDER_* is set",
          opt_out: OPT_OUT,
          limits: { email_chars: CHANNEL_LIMITS.email, linkedin_message_chars: CHANNEL_LIMITS.linkedin.message, instagram_chars: CHANNEL_LIMITS.instagram },
        }
        if (type === "lead") {
          const l = (await db.select().from(leads).where(eq(leads.id, id)))[0]
          if (!l) return json({ error: "lead not found" })
          const ev = await db.select().from(leadEvidence).where(eq(leadEvidence.leadId, id))
          const drafts = await db.select().from(outreachMessages).where(and(eq(outreachMessages.leadId, id), eq(outreachMessages.sequence, 1)))
          return json({
            lead: { id: l.id, name: l.creatorName, status: l.candidateStatus, rejection_reason: l.rejectionReason, segment: l.segment, country: l.countryIso2, followers: l.followers, priority: l.priority, score: l.leadScore, best_channel: l.bestChannel, backup_channel: l.backupChannel, checked_date: l.checkedDate, demo_fixture: l.isFixture },
            evidence: ev.map((e) => ({ kind: e.kind, url: e.url, label: e.label, value: e.value, channel: e.channel, published_at: e.publishedAt, long_form: e.isLongform, last_active: e.lastActiveAt, source: e.source })),
            template_first_messages: drafts.map((d) => ({ channel: d.channel, status: d.status, subject: d.subject, body: d.body })),
            writing,
          })
        }
        if (type === "candidate") {
          const c = (await db.select().from(candidates).where(eq(candidates.id, id)))[0]
          if (!c) return json({ error: "candidate not found" })
          const l = (await db.select().from(leads).where(eq(leads.candidateId, id)))[0]
          return json({ candidate: c, qualification: l ? { status: l.candidateStatus, reason: l.rejectionReason, checks: l.qualificationChecks } : "not evaluated by the lead engine" })
        }
        const c = (await db.select().from(creators).where(eq(creators.id, id)))[0]
        if (!c) return json({ error: "creator not found" })
        const acts = await db.select().from(activities).where(eq(activities.creatorId, id)).orderBy(desc(activities.createdAt)).limit(10)
        const outs = await db.select().from(outreach).where(eq(outreach.creatorId, id)).orderBy(desc(outreach.createdAt)).limit(5)
        const linked = (await db.select().from(leads).where(eq(leads.creatorId, id)))[0]
        const ev = linked ? await db.select().from(leadEvidence).where(eq(leadEvidence.leadId, linked.id)) : []
        return json({
          creator: { id: c.id, name: c.name, handle: c.handle, platform: c.platform, email: c.email, profile_url: c.profileUrl, external_url: c.externalUrl, niche: c.niche, followers: c.followers, stage: c.stage, days_in_stage: daysSince(c.stageChangedAt), bio: c.bio },
          outreach: outs.map((o) => ({ status: o.status, subject: o.subject, body: o.body?.slice(0, 400), sent_at: o.sentAt, replied_at: o.repliedAt })),
          recent_activity: acts.map((a) => ({ type: a.type, title: a.title, at: a.createdAt })),
          lead_evidence: ev.map((e) => ({ kind: e.kind, url: e.url, label: e.label, value: e.value, channel: e.channel, published_at: e.publishedAt })),
          writing,
        })
      },
    }),
  )

  if (run.sources.includes("leads") || run.sources.includes("pipeline")) {
    tools.push(
      betaTool({
        name: "propose_pitch",
        description: "File a first-message pitch for human review (it is NOT sent). For a qualified lead or a pipeline creator. Returns the proposal id, or problems to fix.",
        inputSchema: {
          type: "object",
          properties: {
            subject_type: { type: "string", enum: ["lead", "creator"] },
            subject_id: { type: "string" },
            channel: { type: "string", enum: [...PITCH_CHANNELS] },
            recipient: { type: "string", description: "The creator's published contact for this channel, exactly as shown in get_details" },
            subject: { type: "string", description: "Email subject (email only)" },
            body: { type: "string" },
            evidence_urls: { type: "array", items: { type: "string" }, description: "URLs from get_details that this message relies on" },
            rationale: { type: "string", description: "Why this creator, why now, why this channel - for the reviewer" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["subject_type", "subject_id", "channel", "recipient", "body", "evidence_urls", "rationale", "confidence"],
          additionalProperties: false,
        },
        run: async (i) => {
          if (capReached()) return json({ ok: false, problems: [`proposal limit (${run.maxProposals}) reached - stop and summarise`] })
          if (await hasPending(i.subject_type, i.subject_id, "pitch")) return json({ ok: false, problems: ["already has a pending pitch - skip"] })
          const ctx = await pitchContext(i.subject_type, i.subject_id, i.channel)
          if (!ctx) return json({ ok: false, problems: [`${i.subject_type} not found`] })
          if (!ctx.qualified) return json({ ok: false, problems: ["lead is not qualified - do not pitch it"] })
          const problems = [
            ...validatePitch({ channel: i.channel, recipient: i.recipient, subject: i.subject ?? null, body: i.body, evidenceUrls: i.evidence_urls }, { sender, knownRecipients: ctx.knownRecipients, allowedEvidence: ctx.allowedEvidence, contentRefs: ctx.contentRefs, isFirstMessage: true }),
            ...validateRationale(i.rationale, i.confidence),
          ]
          if (problems.length) return json({ ok: false, problems })
          const id = await store({ kind: "pitch", subjectType: i.subject_type, subjectId: i.subject_id, subjectName: ctx.name, action: i.channel, recipient: i.recipient, subject: i.subject ?? null, body: i.body, rationale: i.rationale, evidenceUrls: json(i.evidence_urls), confidence: i.confidence })
          return json({ ok: true, proposal_id: id, remaining: run.maxProposals - run.made.n })
        },
      }),
    )
  }

  if (run.sources.includes("candidates")) {
    tools.push(
      betaTool({
        name: "propose_candidate_decision",
        description: "Recommend approving a review-queue candidate into the roster, or rejecting it. A person makes the final call.",
        inputSchema: {
          type: "object",
          properties: {
            candidate_id: { type: "string" },
            decision: { type: "string", enum: ["approve", "reject"] },
            rationale: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["candidate_id", "decision", "rationale", "confidence"],
          additionalProperties: false,
        },
        run: async (i) => {
          if (capReached()) return json({ ok: false, problems: [`proposal limit (${run.maxProposals}) reached - stop and summarise`] })
          const c = (await db.select().from(candidates).where(eq(candidates.id, i.candidate_id)))[0]
          if (!c) return json({ ok: false, problems: ["candidate not found"] })
          if (c.status !== "pending") return json({ ok: false, problems: [`candidate is already ${c.status}`] })
          if (await hasPending("candidate", c.id, "candidate_decision")) return json({ ok: false, problems: ["already has a pending proposal - skip"] })
          const problems = validateRationale(i.rationale, i.confidence)
          if (problems.length) return json({ ok: false, problems })
          const id = await store({ kind: "candidate_decision", subjectType: "candidate", subjectId: c.id, subjectName: c.fullName || c.handle, action: i.decision, rationale: i.rationale, confidence: i.confidence })
          return json({ ok: true, proposal_id: id, remaining: run.maxProposals - run.made.n })
        },
      }),
    )
  }

  if (run.sources.includes("pipeline")) {
    tools.push(
      betaTool({
        name: "propose_next_step",
        description: "Suggest the next step for a pipeline creator: a follow-up email (draft it), a stage move, or marking them cold. A person approves it.",
        inputSchema: {
          type: "object",
          properties: {
            creator_id: { type: "string" },
            action: { type: "string", enum: [...NEXT_STEP_ACTIONS] },
            to_stage: { type: "string", enum: [...STAGES], description: "Required for move_stage" },
            subject: { type: "string", description: "Follow-up email subject" },
            body: { type: "string", description: "Follow-up email body" },
            evidence_urls: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["creator_id", "action", "rationale", "confidence"],
          additionalProperties: false,
        },
        run: async (i) => {
          if (capReached()) return json({ ok: false, problems: [`proposal limit (${run.maxProposals}) reached - stop and summarise`] })
          const c = (await db.select().from(creators).where(eq(creators.id, i.creator_id)))[0]
          if (!c) return json({ ok: false, problems: ["creator not found"] })
          if (await hasPending("creator", c.id, "next_step")) return json({ ok: false, problems: ["already has a pending next step - skip"] })
          const problems = validateRationale(i.rationale, i.confidence)
          if (i.action === "move_stage" && !i.to_stage) problems.push("move_stage needs to_stage")
          if (i.action === "move_stage" && i.to_stage === c.stage) problems.push(`creator is already in ${c.stage}`)
          if (i.action === "follow_up") {
            const ctx = await pitchContext("creator", c.id, "email")
            problems.push(...validatePitch({ channel: "email", recipient: c.email, subject: i.subject ?? null, body: i.body ?? "", evidenceUrls: i.evidence_urls ?? [] }, { sender, knownRecipients: ctx?.knownRecipients ?? [], allowedEvidence: ctx?.allowedEvidence ?? [], contentRefs: [], isFirstMessage: false }))
          }
          if (problems.length) return json({ ok: false, problems })
          const id = await store({
            kind: "next_step", subjectType: "creator", subjectId: c.id, subjectName: c.name, action: i.action,
            toStage: i.action === "mark_cold" ? "Cold" : i.to_stage ?? null,
            recipient: i.action === "follow_up" ? c.email : null, subject: i.subject ?? null, body: i.body ?? null,
            rationale: i.rationale, evidenceUrls: i.evidence_urls ? json(i.evidence_urls) : null, confidence: i.confidence,
          })
          return json({ ok: true, proposal_id: id, remaining: run.maxProposals - run.made.n })
        },
      }),
    )
  }
  return tools
}

// ── Run ─────────────────────────────────────────────────────────────────────
export async function runAgent(opts: RunOptions = {}): Promise<RunResult> {
  const sources = (opts.sources?.length ? opts.sources : [...AGENT_SOURCES]).filter((s) => (AGENT_SOURCES as readonly string[]).includes(s))
  const maxProposals = Math.max(1, Math.min(AGENT_LIMITS.maxProposalsCap, Math.floor(opts.maxProposals ?? Number(process.env.AGENT_MAX_PROPOSALS ?? AGENT_LIMITS.maxProposalsDefault))))
  const model = agentModel()
  const runId = newId("agentrun")
  const started = Date.now()
  await db.insert(agentRuns).values({ id: runId, trigger: opts.trigger ?? "manual", sources: json(sources), instructions: opts.instructions ?? null, status: "running", model, startedAt: nowIso() })

  const made = { n: 0 }
  let inputTokens = 0
  let outputTokens = 0
  let iterations = 0
  let summary: string | null = null
  let error: string | null = null

  const provider = agentProvider()
  const tools = buildTools({ id: runId, sources, includeFixtures: !!opts.includeFixtures, maxProposals, made })
  const task = buildTask(sources, maxProposals, opts.instructions)

  if (provider === "free") {
    try {
      // Hosted providers only: the local model can't drive the tool loop at a usable speed.
      const router = new LlmRouter(providersFromEnv().filter((p) => p.kind === "openai"))
      const r = await runRouterLoop({ router, system: AGENT_SYSTEM_PROMPT, task, tools, maxIterations: AGENT_LIMITS.maxIterations, runId })
      ;({ iterations, summary } = r)
      if (r.providers.length > 1) summary = `${summary ?? ""}

(Providers used: ${r.providers.join(", ")})`.trim()
    } catch (e) {
      error = (e as Error).message
    }
  } else if (provider === "ollama") {
    try {
      const r = await runOllamaLoop({ baseUrl: ollamaUrl(), model, system: AGENT_SYSTEM_PROMPT, task, tools, maxIterations: AGENT_LIMITS.maxIterations })
      ;({ iterations, inputTokens, outputTokens, summary } = r)
    } catch (e) {
      error = (e as Error).message
    }
  } else try {
    const client = new Anthropic()
    const params = {
      model,
      max_tokens: 16000,
      max_iterations: AGENT_LIMITS.maxIterations,
      output_config: { effort: "medium" as const },
      system: [{ type: "text" as const, text: AGENT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
      tools,
      messages: [{ role: "user" as const, content: task }],
      // Server-side refusal fallback: on a policy decline the API reruns the turn on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as unknown as BetaToolRunnerParams & { stream?: false }
    const runner = client.beta.messages.toolRunner(params)
    let last: Anthropic.Beta.BetaMessage | null = null
    for await (const message of runner) {
      iterations++
      inputTokens += (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0)
      outputTokens += message.usage.output_tokens ?? 0
      last = message
      if (message.stop_reason === "refusal") break
    }
    if (last?.stop_reason === "refusal") throw new Error("the model declined this request (refusal)")
    summary = last?.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim() || null
  } catch (e) {
    error = e instanceof Anthropic.AuthenticationError
      ? "Anthropic credentials missing or invalid - set ANTHROPIC_API_KEY in .env.local"
      : e instanceof Anthropic.RateLimitError
      ? "Rate limited by the Anthropic API - try again shortly"
      : e instanceof Anthropic.APIError
      ? `Anthropic API error ${e.status}: ${e.message}`
      : (e as Error).message
    if (/apiKey|authToken|credentials/i.test(error)) error = "Anthropic credentials missing - set ANTHROPIC_API_KEY in .env.local"
  }

  const durationMs = Date.now() - started
  const cost = costUsd(model, inputTokens, outputTokens)
  const status = error ? "failed" : "succeeded"
  await db.update(agentRuns).set({ status, finishedAt: nowIso(), durationMs, iterations, inputTokens, outputTokens, costUsd: cost, proposals: made.n, summary, error }).where(eq(agentRuns.id, runId))
  return { runId, status, proposals: made.n, summary, error, costUsd: cost, durationMs }
}
