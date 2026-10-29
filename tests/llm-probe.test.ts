import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { probeOllama } from "../lib/llm/probe"

const serve = (models: string[]) => new Promise<{ url: string; close: () => void }>((resolve) => {
  const srv = createServer((req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(req.url === "/api/tags" ? { models: models.map((name) => ({ name })) } : {}))
  })
  srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => srv.close() }))
})

test("the AI usage page's Ollama check tells up, model missing and unreachable apart", async () => {
  const up = await serve(["qwen3:4b", "llama3:latest"])
  assert.deepEqual(await probeOllama(up.url, "qwen3:4b"), { state: "up" })
  assert.deepEqual(await probeOllama(up.url, "llama3"), { state: "up" })
  const missing = await probeOllama(up.url, "gemma3:1b")
  assert.equal(missing.state, "no_model")
  up.close()

  // Nothing listening: a closed port on this machine.
  const gone = await serve([])
  const url = gone.url
  gone.close()
  await new Promise((r) => setTimeout(r, 50))
  const down = await probeOllama(url, "qwen3:4b")
  assert.equal(down.state, "down")
  assert.match(down.state === "down" ? down.detail : "", /docker compose up -d ollama/)
})
