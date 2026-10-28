// Tool loop for a local model served by Ollama (docker compose up -d). It runs the
// same tools as the Claude runner, so every proposal still goes through the
// guardrails in the tools themselves. Small local models are sloppier with tool
// arguments, so arguments are coerced and checked against each tool's schema first.

import http from "node:http"
import https from "node:https"

type Schema = {
  type?: string
  enum?: readonly unknown[]
  properties?: Record<string, Schema>
  required?: readonly string[]
  items?: Schema
  minimum?: number
  maximum?: number
}

export type LoopTool = {
  name: string
  description?: string
  input_schema?: unknown
  run: (args: never) => unknown
}

type ToolCall = { function: { name: string; arguments: unknown } }
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_name: string }

export type LoopResult = { iterations: number; inputTokens: number; outputTokens: number; summary: string | null }

function coerce(v: unknown, s: Schema): unknown {
  if (v == null) return v
  if ((s.type === "integer" || s.type === "number") && typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v)
  if (s.type === "array" && typeof v === "string") {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) return parsed
    } catch {
      return v.trim() ? [v.trim()] : []
    }
  }
  if (s.type === "string" && (typeof v === "number" || typeof v === "boolean")) return String(v)
  return v
}

function typeOk(v: unknown, s: Schema): boolean {
  switch (s.type) {
    case "string": return typeof v === "string"
    case "integer": return Number.isInteger(v)
    case "number": return typeof v === "number" && Number.isFinite(v)
    case "boolean": return typeof v === "boolean"
    case "array": return Array.isArray(v) && (!s.items || v.every((x) => typeOk(x, s.items!)))
    case "object": return typeof v === "object" && !Array.isArray(v)
    default: return true
  }
}

/** Coerce and validate tool arguments against an object schema. Unknown keys and empty optionals are dropped. */
export function checkArgs(schema: unknown, raw: unknown): { args: Record<string, unknown>; problems: string[] } {
  const s = schema as Schema
  let input = raw
  if (typeof input === "string") {
    try { input = JSON.parse(input) } catch { return { args: {}, problems: ["arguments are not valid JSON"] } }
  }
  if (input == null || typeof input !== "object" || Array.isArray(input)) return { args: {}, problems: ["arguments must be an object"] }
  const props = s.properties ?? {}
  const args: Record<string, unknown> = {}
  const problems: string[] = []
  for (const [k, ps] of Object.entries(props)) {
    let v = coerce((input as Record<string, unknown>)[k], ps)
    if (v === "" && !s.required?.includes(k)) v = undefined
    if (v === undefined || v === null) continue
    if (!typeOk(v, ps)) { problems.push(`${k} must be ${ps.type}`); continue }
    if (ps.enum && !ps.enum.includes(v)) { problems.push(`${k} must be one of ${ps.enum.join(", ")}`); continue }
    if (typeof v === "number" && ((ps.minimum != null && v < ps.minimum) || (ps.maximum != null && v > ps.maximum))) {
      problems.push(`${k} must be between ${ps.minimum ?? "-∞"} and ${ps.maximum ?? "∞"}`)
      continue
    }
    args[k] = v
  }
  for (const r of s.required ?? []) if (!(r in args) && !problems.some((p) => p.startsWith(`${r} `))) problems.push(`${r} is required`)
  return { args, problems }
}

const STEP_TIMEOUT_MIN = 15

// node:http rather than fetch: fetch gives up after 300 s without response headers,
// and Ollama sends none until it has read the whole prompt, which on a CPU can take longer.
function post(url: string, payload: string, onLine: (line: string) => void): Promise<void> {
  const u = new URL(url)
  const lib = u.protocol === "https:" ? https : http
  return new Promise((resolve, reject) => {
    const req = lib.request(u, { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (res) => {
      if (res.statusCode !== 200) {
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (d: string) => (text += d))
        res.on("end", () => reject(res.statusCode === 404
          ? new Error(`Ollama model not found - pull it with "docker compose up ollama-pull" (${text.slice(0, 200)})`)
          : new Error(`Ollama error ${res.statusCode}: ${text.slice(0, 300)}`)))
        return
      }
      let buf = ""
      res.setEncoding("utf8")
      res.on("data", (d: string) => {
        buf += d
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        try { lines.forEach(onLine) } catch (e) { req.destroy(e as Error) }
      })
      res.on("end", () => {
        try { onLine(buf); resolve() } catch (e) { reject(e) }
      })
      res.on("error", reject)
    })
    const timer = setTimeout(() => req.destroy(new Error(
      `Ollama took over ${STEP_TIMEOUT_MIN} minutes for one step - the model is too slow on this machine right now. Close CPU-heavy apps (games, builds), use a smaller OLLAMA_MODEL, or a GPU.`,
    )), STEP_TIMEOUT_MIN * 60_000)
    req.on("close", () => clearTimeout(timer))
    req.on("error", (e: NodeJS.ErrnoException) => reject(
      e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" || e.code === "EHOSTUNREACH"
        ? new Error(`Ollama not reachable at ${u.origin} - start it with "docker compose up -d" (${e.code})`)
        : e,
    ))
    req.end(payload)
  })
}

async function chat(baseUrl: string, body: object): Promise<{ message: { content: string; tool_calls?: ToolCall[] }; promptTokens: number; evalTokens: number }> {
  let content = ""
  const toolCalls: ToolCall[] = []
  let promptTokens = 0
  let evalTokens = 0
  await post(`${baseUrl}/api/chat`, JSON.stringify({ ...body, stream: true }), (line) => {
    if (!line.trim()) return
    const chunk = JSON.parse(line)
    if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`)
    if (chunk.message?.content) content += chunk.message.content
    if (chunk.message?.tool_calls) toolCalls.push(...chunk.message.tool_calls)
    if (chunk.done) { promptTokens = chunk.prompt_eval_count ?? 0; evalTokens = chunk.eval_count ?? 0 }
  })
  return { message: { content, tool_calls: toolCalls.length ? toolCalls : undefined }, promptTokens, evalTokens }
}

export async function runOllamaLoop(opts: { baseUrl: string; model: string; system: string; task: string; tools: LoopTool[]; maxIterations: number }): Promise<LoopResult> {
  const messages: ChatMessage[] = [{ role: "system", content: opts.system }, { role: "user", content: opts.task }]
  const tools = opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema ?? { type: "object", properties: {} } } }))
  const byName = new Map(opts.tools.map((t) => [t.name, t]))
  let iterations = 0
  let inputTokens = 0
  let outputTokens = 0
  let toolCallsMade = 0
  let nudged = false
  let summary: string | null = null

  while (iterations < opts.maxIterations) {
    iterations++
    const r = await chat(opts.baseUrl, { model: opts.model, messages, tools, think: false, options: { temperature: 0.2 } })
    inputTokens += r.promptTokens
    outputTokens += r.evalTokens
    const calls = r.message.tool_calls ?? []
    messages.push({ role: "assistant", content: r.message.content, ...(calls.length ? { tool_calls: calls } : {}) })
    if (!calls.length) {
      // Small models sometimes answer in prose before touching the tools: nudge once.
      if (!toolCallsMade && !nudged) {
        nudged = true
        messages.push({ role: "user", content: "Use the tools: start by calling a list_* tool, then get_details, then file proposals." })
        continue
      }
      summary = r.message.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || null
      break
    }
    for (const call of calls) {
      toolCallsMade++
      const name = call.function?.name
      const tool = byName.get(name)
      let out: string
      if (!tool) {
        out = JSON.stringify({ ok: false, problems: [`unknown tool ${name}; available: ${[...byName.keys()].join(", ")}`] })
      } else {
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
      messages.push({ role: "tool", tool_name: name ?? "unknown", content: out })
    }
  }
  return { iterations, inputTokens, outputTokens, summary }
}
