"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Bot, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { startAgentRun } from "./actions"

const SOURCES = [
  { id: "leads", label: "Qualified leads", hint: "pick and draft first pitches" },
  { id: "candidates", label: "Review queue", hint: "recommend approve / reject" },
  { id: "pipeline", label: "Pipeline", hint: "suggest follow-ups and stage moves" },
]

export function RunPanel({ ready, notReadyHint, slow }: { ready: boolean; notReadyHint: string; slow?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [sources, setSources] = useState<string[]>(SOURCES.map((s) => s.id))
  const [instructions, setInstructions] = useState("")
  const [maxProposals, setMaxProposals] = useState(10)
  const [includeFixtures, setIncludeFixtures] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const toggle = (id: string) => setSources((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {SOURCES.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <input type="checkbox" checked={sources.includes(s.id)} onChange={() => toggle(s.id)} className="mt-0.5" />
            <span><span className="font-medium">{s.label}</span><span className="block text-xs text-zinc-500">{s.hint}</span></span>
          </label>
        ))}
      </div>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder="Optional focus, e.g. “Prioritise UK podcasters” or “Only suggest follow-ups older than a week”"
        className="w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      />
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Max proposals
          <input type="number" min={1} max={50} value={maxProposals} onChange={(e) => setMaxProposals(Number(e.target.value))}
            className="h-8 w-16 rounded-md border border-zinc-200 bg-white px-2 dark:border-zinc-800 dark:bg-zinc-900" />
        </label>
        <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={includeFixtures} onChange={(e) => setIncludeFixtures(e.target.checked)} />
          Include demo (fixture) leads
        </label>
        <Button
          className="ml-auto"
          disabled={pending || !sources.length || !ready}
          onClick={() => start(async () => {
            setResult(null)
            const r = await startAgentRun({ sources, instructions, maxProposals, includeFixtures })
            setResult(r.error ? `Run failed: ${r.error}` : `Done: ${r.proposals} proposal(s) in ${(r.durationMs / 1000).toFixed(0)}s, $${r.costUsd.toFixed(4)}.`)
            router.refresh()
          })}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          {pending ? (slow ? "Working… (local model on CPU: can take 10+ minutes)" : "Working… (can take a few minutes)") : "Run agent"}
        </Button>
      </div>
      {!ready && <p className="text-xs text-amber-600 dark:text-amber-400">{notReadyHint}</p>}
      {result && <p className="text-sm text-zinc-600 dark:text-zinc-300">{result}</p>}
    </div>
  )
}
