// Applying a reviewer's decision on an agent proposal. Shared by the /agent
// page (server actions) and the n8n API. Approval runs the app's existing
// actions, so test-mode allowlisting, activity logging and auto-tasks all apply.
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { agentProposals, creators, leadEvidence, leads, type AgentProposal } from "@/lib/db/schema"
import { senderFromEnv } from "@/lib/leads/config"
import { validatePitch } from "@/lib/agent/guardrails"
import type { PitchChannel } from "@/lib/agent/config"
import { isStage } from "@/lib/stages"
import { sendOutreach } from "@/app/outreach/actions"
import { approveCandidate, rejectCandidate } from "@/app/candidates/actions"
import { moveStage } from "@/app/creators/[id]/actions"
import { addLeadToPipeline } from "@/app/leads/actions"

export type Decision = { decision: "approve" | "reject"; subject?: string | null; body?: string | null; note?: string | null; reviewer?: string | null }
export type DecisionResult = { ok: boolean; status: string; result: string }

async function finish(p: AgentProposal, status: string, result: string, d: Decision, edits: { subject?: string | null; body?: string | null } = {}) {
  await db.update(agentProposals).set({
    status, result, decidedAt: new Date().toISOString(),
    reviewNote: [d.reviewer && `by ${d.reviewer}`, d.note].filter(Boolean).join(": ") || null,
    ...(edits.subject !== undefined ? { subject: edits.subject } : {}),
    ...(edits.body !== undefined ? { body: edits.body } : {}),
  }).where(eq(agentProposals.id, p.id))
  revalidatePath("/agent")
  return { ok: status !== "failed", status, result }
}

// Re-check an (possibly edited) message with the same guardrails the agent faced.
async function recheck(p: AgentProposal, channel: PitchChannel, subject: string | null, body: string): Promise<string[]> {
  let knownRecipients: string[] = []
  let allowedEvidence: string[] = []
  if (p.subjectType === "lead") {
    const ev = await db.select().from(leadEvidence).where(eq(leadEvidence.leadId, p.subjectId))
    knownRecipients = ev.filter((e) => e.kind === "contact" && e.channel === channel && e.value).map((e) => e.value!)
    allowedEvidence = ev.map((e) => e.url).filter(Boolean) as string[]
  } else {
    const c = (await db.select().from(creators).where(eq(creators.id, p.subjectId)))[0]
    knownRecipients = c?.email ? [c.email] : []
    allowedEvidence = [c?.profileUrl, c?.externalUrl].filter(Boolean) as string[]
    const l = (await db.select().from(leads).where(eq(leads.creatorId, p.subjectId)))[0]
    if (l) allowedEvidence.push(...((await db.select().from(leadEvidence).where(eq(leadEvidence.leadId, l.id))).map((e) => e.url).filter(Boolean) as string[]))
  }
  const evidenceUrls = p.evidenceUrls ? (JSON.parse(p.evidenceUrls) as string[]) : allowedEvidence.slice(0, 1)
  return validatePitch({ channel, recipient: p.recipient, subject, body, evidenceUrls }, { sender: senderFromEnv(), knownRecipients, allowedEvidence, contentRefs: [], isFirstMessage: false })
}

async function sendEmail(p: AgentProposal, subject: string, body: string): Promise<DecisionResult & { creatorId: string }> {
  const creatorId = p.subjectType === "lead" ? await addLeadToPipeline(p.subjectId) : p.subjectId
  const r = await sendOutreach({ creatorId, subject, body, toEmail: p.recipient ?? undefined })
  return r.sent
    ? { ok: true, status: "sent", result: `Email sent to ${p.recipient}`, creatorId }
    : { ok: true, status: "approved", result: `Saved as a draft, not sent: ${r.error ?? "no RESEND_API_KEY / test mode"}`, creatorId }
}

export async function decideProposal(id: string, d: Decision): Promise<DecisionResult> {
  const p = (await db.select().from(agentProposals).where(eq(agentProposals.id, id)))[0]
  if (!p) return { ok: false, status: "missing", result: "Proposal not found" }
  if (p.status !== "pending") return { ok: false, status: p.status, result: `Already ${p.status}` }
  if (d.decision === "reject") return finish(p, "rejected", "Rejected by reviewer", d)

  const subject = d.subject !== undefined && d.subject !== null ? d.subject : p.subject
  const body = d.body !== undefined && d.body !== null ? d.body : p.body
  const edits = { subject: subject !== p.subject ? subject : undefined, body: body !== p.body ? body : undefined }

  try {
    if (p.kind === "pitch") {
      const channel = p.action as PitchChannel
      const problems = await recheck(p, channel, subject ?? null, body ?? "")
      if (problems.length) return { ok: false, status: "pending", result: `Fix before approving: ${problems.join("; ")}` }
      if (channel === "email") {
        const r = await sendEmail(p, subject ?? "", body ?? "")
        return finish(p, r.status, r.result, d, edits)
      }
      if (p.subjectType === "lead") await addLeadToPipeline(p.subjectId)
      return finish(p, "approved", `Approved. ${channel === "linkedin" ? "LinkedIn" : "Instagram"} can't be sent automatically: copy the message and send it from your own account to ${p.recipient}.`, d, edits)
    }

    if (p.kind === "candidate_decision") {
      if (p.action === "approve") {
        await approveCandidate(p.subjectId)
        return finish(p, "approved", "Candidate approved into the roster", d)
      }
      await rejectCandidate(p.subjectId)
      return finish(p, "approved", "Candidate rejected on the review queue", d)
    }

    // next_step
    if (p.action === "follow_up") {
      const problems = await recheck(p, "email", subject ?? null, body ?? "")
      if (problems.length) return { ok: false, status: "pending", result: `Fix before approving: ${problems.join("; ")}` }
      const r = await sendEmail(p, subject ?? "", body ?? "")
      return finish(p, r.status, r.result, d, edits)
    }
    const to = p.action === "mark_cold" ? "Cold" : p.toStage
    if (!isStage(to)) return finish(p, "failed", `Invalid stage ${to}`, d)
    await moveStage(p.subjectId, to)
    return finish(p, "approved", `Moved to ${to}`, d)
  } catch (e) {
    return finish(p, "failed", `Failed: ${(e as Error).message}`, d)
  }
}
