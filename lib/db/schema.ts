import { pgTable, text, integer, doublePrecision, boolean, index, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const creators = pgTable("creators", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  handle: text("handle"),
  platform: text("platform"),
  profileUrl: text("profile_url"),
  followers: integer("followers"),
  engagementRate: doublePrecision("engagement_rate"),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  source: text("source"),
  persona: text("persona"),
  niche: text("niche"),
  audience: text("audience"),
  ageBracket: text("age_bracket"),
  languages: text("languages"),
  contentStyle: text("content_style"),
  rateCeiling: integer("rate_ceiling"),
  ratePaid: integer("rate_paid"),
  usageRights: text("usage_rights"),
  exclusivity: text("exclusivity"),
  campaignsActive: integer("campaigns_active").default(0),
  campaignsCompleted: integer("campaigns_completed").default(0),
  avgGrade: text("avg_grade"),
  repurposeEligible: boolean("repurpose_eligible"),
  flagNotes: text("flag_notes"),
  lastContactDate: text("last_contact_date"),
  lifecycleStatus: text("lifecycle_status").default("Lead"),
  stage: text("stage").default("Lead"),
  stageChangedAt: text("stage_changed_at"),
  status: text("status").default("active"),
  bio: text("bio"),
  externalUrl: text("external_url"),
  avatarUrl: text("avatar_url"),
  enrichedAt: text("enriched_at"), // last Apify enrichment timestamp
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  owner: text("owner").default("You"),
})

export const candidates = pgTable("candidates", {
  id: text("id").primaryKey(),
  handle: text("handle").notNull(),
  platform: text("platform"),
  fullName: text("full_name"),
  followers: integer("followers"),
  engagementRate: doublePrecision("engagement_rate"),
  email: text("email"),
  location: text("location"),
  bio: text("bio"),
  externalUrl: text("external_url"),
  avatarUrl: text("avatar_url"),
  source: text("source"),
  sourceDetail: text("source_detail"),
  nicheRelevant: boolean("niche_relevant"),
  isUS: boolean("is_us"),
  rateBand: text("rate_band"),
  fitScore: doublePrecision("fit_score"),
  fitReasoning: text("fit_reasoning"),
  // AI-scoring extras (populated when ANTHROPIC_API_KEY is set)
  personaMatch: text("persona_match"),
  nicheGuess: text("niche_guess"),
  redFlags: text("red_flags"), // newline-separated
  outreachAngle: text("outreach_angle"),
  aiScored: boolean("ai_scored").default(false),
  status: text("status").default("pending"),
  reviewedAt: text("reviewed_at"),
  discoveredAt: text("discovered_at").default(sql`CURRENT_TIMESTAMP`),
})

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  product: text("product"),
  brief: text("brief"),
  budget: integer("budget"),
  personaTarget: text("persona_target"),
  status: text("status").default("draft"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
})

export const outreach = pgTable("outreach", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  campaignId: text("campaign_id"),
  toEmail: text("to_email"),
  fromEmail: text("from_email"),
  subject: text("subject"),
  body: text("body"),
  status: text("status").default("draft"),
  channel: text("channel").default("email"),
  messageId: text("message_id"),
  threadId: text("thread_id"),
  sentAt: text("sent_at"),
  openedAt: text("opened_at"),
  repliedAt: text("replied_at"),
  failedAt: text("failed_at"),
  failedReason: text("failed_reason"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  owner: text("owner").default("You"),
})

export const activities = pgTable("activities", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  metadata: text("metadata"),
  actor: text("actor").default("You"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
})

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id"),
  title: text("title").notNull(),
  body: text("body"),
  dueDate: text("due_date"),
  completed: boolean("completed").default(false),
  completedAt: text("completed_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  source: text("source").default("manual"),
  owner: text("owner").default("You"),
})

export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
})

// ─────────────────────────────────────────────────────────────────────────────
// Lead-generation engine (evidence-based qualification). See lib/leads/.
// ─────────────────────────────────────────────────────────────────────────────

// One row per unique creator identity (platform + stable platform id).
// lead_id is derived deterministically from the identity so reruns upsert.
export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  identityKey: text("identity_key").notNull(),
  canonicalProfileUrl: text("canonical_profile_url").notNull(),
  creatorName: text("creator_name").notNull(),
  segment: text("segment"),
  entityType: text("entity_type"),
  countryIso2: text("country_iso2"),
  countryEvidenceUrl: text("country_evidence_url"),
  primaryLanguage: text("primary_language"),
  primaryPlatform: text("primary_platform"),
  profileUrl: text("profile_url"),
  stableCreatorId: text("stable_creator_id"),
  followers: integer("followers"),
  lastContentDate: text("last_content_date"),
  recentContentUrl: text("recent_content_url"),
  recentContentTitle: text("recent_content_title"),
  contentCount30d: integer("content_count_30d"),
  longformCount60d: integer("longform_count_60d"),
  monetizationSignal: text("monetization_signal"),
  monetizationEvidenceUrl: text("monetization_evidence_url"),
  need: text("need"),
  needEvidenceUrl: text("need_evidence_url"),
  bestChannel: text("best_channel"),
  channelHandleOrUrl: text("channel_handle_or_url"),
  channelEvidenceUrl: text("channel_evidence_url"),
  backupChannel: text("backup_channel"),
  channelRecommendation: text("channel_recommendation"), // JSON: ChannelRecommendation
  personalizationHook: text("personalization_hook"),
  firstMessage: text("first_message"),
  checkedDate: text("checked_date"),
  priority: text("priority"),
  leadScore: doublePrecision("lead_score"),
  scoreFactors: text("score_factors"), // JSON: ScoreFactor[]
  candidateStatus: text("candidate_status").notNull().default("unverified"), // qualified | unverified | rejected
  rejectionReason: text("rejection_reason"),
  qualificationChecks: text("qualification_checks"), // JSON: QualificationCheck[]
  duplicateCheck: text("duplicate_check"),
  completenessCheck: text("completeness_check"),
  inputHash: text("input_hash"),
  inputJson: text("input_json"), // normalized LeadInput, kept so reruns can re-rank/re-draft
  source: text("source"),
  sourceRef: text("source_ref"),
  isFixture: boolean("is_fixture").default(false),
  candidateId: text("candidate_id"),
  creatorId: text("creator_id"),
  lastRunId: text("last_run_id"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at"),
}, (t) => [
  uniqueIndex("leads_identity_key_uq").on(t.identityKey),
  uniqueIndex("leads_canonical_profile_url_uq").on(t.canonicalProfileUrl),
  index("leads_status_idx").on(t.candidateStatus),
  index("leads_priority_idx").on(t.priority),
])

// Evidence items backing a lead: content items, monetization, need, contacts.
export const leadEvidence = pgTable("lead_evidence", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // content | monetization | need | contact | country | profile | entity
  url: text("url"),
  label: text("label"),
  publishedAt: text("published_at"),
  isLongform: boolean("is_longform"),
  channel: text("channel"),
  value: text("value"),
  lastActiveAt: text("last_active_at"),
  source: text("source"),
  checkedAt: text("checked_at"),
}, (t) => [index("lead_evidence_lead_idx").on(t.leadId)])

// Multi-channel outreach sequences (email / linkedin / instagram × 3 steps).
export const outreachMessages = pgTable("outreach_messages", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  sequence: integer("sequence").notNull(), // 1 = initial, 2-3 = follow-ups
  subject: text("subject"),
  body: text("body"),
  status: text("status").notNull().default("draft"), // draft | approved | unavailable | test_sent
  unavailableReason: text("unavailable_reason"),
  evidenceRefs: text("evidence_refs"), // JSON: string[] of evidence URLs used
  edited: boolean("edited").default(false),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at"),
}, (t) => [
  uniqueIndex("outreach_messages_lead_channel_seq_uq").on(t.leadId, t.channel, t.sequence),
  index("outreach_messages_lead_idx").on(t.leadId),
])

// One row per engine run (or seed test run): timings, counts, cost, errors.
export const engineRuns = pgTable("engine_runs", {
  id: text("id").primaryKey(),
  provider: text("provider"),
  inputRef: text("input_ref"),
  status: text("status").notNull().default("running"), // running | succeeded | failed
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  durationMs: integer("duration_ms"),
  totalInput: integer("total_input").default(0),
  inserted: integer("inserted").default(0),
  updated: integer("updated").default(0),
  unchanged: integer("unchanged").default(0),
  qualified: integer("qualified").default(0),
  unverified: integer("unverified").default(0),
  rejected: integer("rejected").default(0),
  duplicates: integer("duplicates").default(0),
  failed: integer("failed").default(0),
  costUsd: doublePrecision("cost_usd").default(0),
  apiUnits: integer("api_units").default(0),
  errors: text("errors"), // JSON: { ref, message }[]
  metrics: text("metrics"), // JSON: extra metrics (distribution, priority counts, export path)
})

export const seedTests = pgTable("seed_tests", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("running"), // running | passed | incomplete
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
})

export const seedTestEvents = pgTable("seed_test_events", {
  id: text("id").primaryKey(),
  seedTestId: text("seed_test_id").notNull().references(() => seedTests.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  recipient: text("recipient").notNull(),
  eventType: text("event_type").notNull(), // scheduled | sent | click | reply
  trackingToken: text("tracking_token"),
  targetUrl: text("target_url"),
  messageId: text("message_id"),
  occurredAt: text("occurred_at").notNull(),
  metadata: text("metadata"),
}, (t) => [
  index("seed_test_events_test_idx").on(t.seedTestId),
  index("seed_test_events_token_idx").on(t.trackingToken),
])

// ── AI agent: proposes, never sends. Every proposal waits for human review. ──
export const agentRuns = pgTable("agent_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger").notNull(), // manual | api (n8n / cron)
  sources: text("sources").notNull(), // JSON: ("leads" | "candidates" | "pipeline")[]
  instructions: text("instructions"),
  status: text("status").notNull().default("running"), // running | succeeded | failed
  model: text("model").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  durationMs: integer("duration_ms"),
  iterations: integer("iterations").default(0),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  costUsd: doublePrecision("cost_usd").default(0),
  proposals: integer("proposals").default(0),
  summary: text("summary"),
  error: text("error"),
})

export const agentProposals = pgTable("agent_proposals", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // pitch | candidate_decision | next_step
  subjectType: text("subject_type").notNull(), // lead | candidate | creator
  subjectId: text("subject_id").notNull(),
  subjectName: text("subject_name").notNull(),
  action: text("action"), // pitch: channel · candidate: approve|reject · next_step: follow_up|move_stage|mark_cold
  toStage: text("to_stage"),
  recipient: text("recipient"), // email / profile URL / handle for pitches
  subject: text("subject"),
  body: text("body"),
  rationale: text("rationale").notNull(),
  evidenceUrls: text("evidence_urls"), // JSON string[] — all taken from stored evidence
  confidence: doublePrecision("confidence"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | sent | failed
  reviewNote: text("review_note"),
  result: text("result"), // what happened on approval
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
}, (t) => [
  index("agent_proposals_status_idx").on(t.status),
  index("agent_proposals_subject_idx").on(t.subjectType, t.subjectId),
])

export type AgentRun = typeof agentRuns.$inferSelect
export type AgentProposal = typeof agentProposals.$inferSelect

// Audit of every LLM call (Groq, Gemini, Ollama): which provider answered, how long it
// took, tokens, and why a provider was skipped (rate limit, quota, error). A row with
// cooldown_until marks that provider as resting until then; the router reads the latest
// one per provider to decide where the next call goes.
export const llmCalls = pgTable("llm_calls", {
  id: text("id").primaryKey(),
  at: text("at").notNull(),
  purpose: text("purpose").notNull(), // entity_check | agent | llm_check
  subjectRef: text("subject_ref"), // e.g. the channel id being checked
  provider: text("provider").notNull(), // groq | gemini | ollama
  model: text("model").notNull(),
  status: text("status").notNull(), // ok | rate_limited | quota_exhausted | error | invalid_output
  httpStatus: integer("http_status"),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  error: text("error"),
  cooldownUntil: text("cooldown_until"),
  fallbackFrom: text("fallback_from"), // provider(s) skipped or failed before this one
}, (t) => [
  index("llm_calls_at_idx").on(t.at),
  index("llm_calls_provider_idx").on(t.provider, t.at),
])

export type LlmCall = typeof llmCalls.$inferSelect

// A person's decision on who runs a channel (the /leads/review screen). The lead file is rebuilt
// every cycle, so decisions live here and the engine applies them to the rows before scoring.
export const entityReviews = pgTable("entity_reviews", {
  stableCreatorId: text("stable_creator_id").primaryKey(), // the YouTube channel id
  decision: text("decision").notNull(), // individual | agency | management | brand | publication | directory | fan_account
  evidenceUrl: text("evidence_url"), // the page the reviewer looked at
  note: text("note"),
  reviewedAt: text("reviewed_at").notNull(),
})

export type EntityReview = typeof entityReviews.$inferSelect

export type Lead = typeof leads.$inferSelect
export type LeadEvidenceRow = typeof leadEvidence.$inferSelect
export type OutreachMessage = typeof outreachMessages.$inferSelect
export type EngineRun = typeof engineRuns.$inferSelect
export type SeedTest = typeof seedTests.$inferSelect
export type SeedTestEvent = typeof seedTestEvents.$inferSelect

export type Creator = typeof creators.$inferSelect
export type Candidate = typeof candidates.$inferSelect
export type Campaign = typeof campaigns.$inferSelect
export type Outreach = typeof outreach.$inferSelect
export type Activity = typeof activities.$inferSelect
export type Task = typeof tasks.$inferSelect
export type Tag = typeof tags.$inferSelect
