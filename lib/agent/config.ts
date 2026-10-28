// Agent settings. The agent proposes; a person approves. Nothing here sends.
export const AGENT_SOURCES = ["leads", "candidates", "pipeline"] as const
export type AgentSource = (typeof AGENT_SOURCES)[number]

export const PITCH_CHANNELS = ["email", "linkedin", "instagram"] as const
export type PitchChannel = (typeof PITCH_CHANNELS)[number]

export const NEXT_STEP_ACTIONS = ["follow_up", "move_stage", "mark_cold"] as const
export type NextStepAction = (typeof NEXT_STEP_ACTIONS)[number]

// "anthropic" (Claude API, paid) or "ollama" (local model in Docker, free).
export const AGENT_PROVIDERS = ["anthropic", "ollama"] as const
export type AgentProvider = (typeof AGENT_PROVIDERS)[number]

type Env = Record<string, string | undefined>

export function agentProvider(env: Env = process.env): AgentProvider {
  return env.AGENT_PROVIDER?.toLowerCase() === "ollama" ? "ollama" : "anthropic"
}

export function agentModel(env: Env = process.env): string {
  if (agentProvider(env) === "ollama") return env.OLLAMA_MODEL || "qwen3:4b"
  return env.AGENT_MODEL || "claude-opus-5-5"
}

export function ollamaUrl(env: Env = process.env): string {
  return (env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "")
}

export const AGENT_LIMITS = {
  maxProposalsDefault: 10,
  maxProposalsCap: 50,
  maxIterations: 30, // tool-runner turns per run
  listLimitCap: 50, // rows a list tool may return
}

// USD per million tokens (input, output). Unknown models report cost 0 rather than a guess.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model]
  if (!p) return 0
  return +((inputTokens * p.input + outputTokens * p.output) / 1_000_000).toFixed(6)
}
