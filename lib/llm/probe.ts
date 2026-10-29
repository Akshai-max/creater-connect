// Ollama is local, so the page can check it live for free (/api/tags lists pulled models).
// A refused connection only rests it for 30 s, so the audit alone would soon say "available".
// Groq and Gemini are not probed: every probe would spend free quota.
export type Probe = { state: "up" } | { state: "down" | "no_model"; detail: string }
export async function probeOllama(baseUrl: string, model: string): Promise<Probe> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return { state: "down", detail: `HTTP ${res.status} from ${baseUrl}` }
    const tags = (await res.json()) as { models?: { name: string }[] }
    const names = (tags.models ?? []).map((m) => m.name)
    const has = names.some((n) => n === model || n === `${model}:latest` || n.split(":")[0] === model)
    return has ? { state: "up" } : { state: "no_model", detail: `${model} isn't pulled. Run: docker compose exec ollama ollama pull ${model}` }
  } catch {
    return { state: "down", detail: `Not reachable at ${baseUrl}. Start it with: docker compose up -d ollama` }
  }
}
