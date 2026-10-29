// Tool loop for the AI agent on the free hosted models (AGENT_PROVIDER=free). Same tools
// and guardrails as the Claude and Ollama loops; each turn goes through the LLM router,
// so when Groq's quota runs out mid-run the next turn continues on Gemini.
import { checkArgs, type LoopResult, type LoopTool } from "../agent/ollama"
import { type ChatMessage, type LlmRouter, type OpenAiTool } from "./router"

export async function runRouterLoop(opts: { router: LlmRouter; system: string; task: string; tools: LoopTool[]; maxIterations: number; runId: string }): Promise<LoopResult & { providers: string[] }> {
  const messages: ChatMessage[] = [{ role: "system", content: opts.system }, { role: "user", content: opts.task }]
  const tools: OpenAiTool[] = opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema ?? { type: "object", properties: {} } } }))
  const byName = new Map(opts.tools.map((t) => [t.name, t]))
  const used = new Set<string>()
  let iterations = 0
  let toolCallsMade = 0
  let nudged = false
  let summary: string | null = null

  while (iterations < opts.maxIterations) {
    iterations++
    const r = await opts.router.call({ purpose: "agent", subjectRef: opts.runId, messages, tools, maxTokens: 2048, parse: (m) => m })
    used.add(`${r.provider}/${r.model}`)
    const calls = r.message.tool_calls ?? []
    messages.push({ role: "assistant", content: r.message.content ?? "", ...(calls.length ? { tool_calls: calls } : {}) })
    if (!calls.length) {
      if (!toolCallsMade && !nudged) {
        nudged = true
        messages.push({ role: "user", content: "Use the tools: start by calling a list_* tool, then get_details, then file proposals." })
        continue
      }
      summary = (r.message.content ?? "").trim() || null
      break
    }
    for (const [i, call] of calls.entries()) {
      toolCallsMade++
      const tool = byName.get(call.function?.name)
      let out: string
      if (!tool) out = JSON.stringify({ ok: false, problems: [`unknown tool ${call.function?.name}; available: ${[...byName.keys()].join(", ")}`] })
      else {
        const { args, problems } = checkArgs(tool.input_schema ?? {}, call.function.arguments)
        if (problems.length) out = JSON.stringify({ ok: false, problems })
        else {
          try {
            const v = await tool.run(args as never)
            out = typeof v === "string" ? v : JSON.stringify(v)
          } catch (e) {
            out = JSON.stringify({ ok: false, problems: [(e as Error).message] })
          }
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id || `call_${iterations}_${i}`, content: out })
    }
  }
  // Token counts per call live in llm_calls; the run row keeps the turn count.
  return { iterations, inputTokens: 0, outputTokens: 0, summary, providers: [...used] }
}
