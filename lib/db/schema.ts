import { pgTable, text, integer, doublePrecision, boolean } from "drizzle-orm/pg-core"
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

export type Creator = typeof creators.$inferSelect
export type Candidate = typeof candidates.$inferSelect
export type Campaign = typeof campaigns.$inferSelect
export type Outreach = typeof outreach.$inferSelect
export type Activity = typeof activities.$inferSelect
export type Task = typeof tasks.$inferSelect
export type Tag = typeof tags.$inferSelect
