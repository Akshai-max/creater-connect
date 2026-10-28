"use server"
import { revalidatePath } from "next/cache"
import { runAgent } from "@/lib/agent/agent"
import { AGENT_SOURCES, type AgentSource } from "@/lib/agent/config"
import { decideProposal, type Decision } from "./decide"

export async function startAgentRun(input: { sources: string[]; instructions?: string; maxProposals?: number; includeFixtures?: boolean }) {
  const sources = input.sources.filter((s): s is AgentSource => (AGENT_SOURCES as readonly string[]).includes(s))
  const r = await runAgent({ sources, instructions: input.instructions || null, maxProposals: input.maxProposals, includeFixtures: input.includeFixtures, trigger: "manual" })
  revalidatePath("/agent")
  return r
}

export async function decide(id: string, d: Decision) {
  return decideProposal(id, { ...d, reviewer: d.reviewer ?? "You" })
}
