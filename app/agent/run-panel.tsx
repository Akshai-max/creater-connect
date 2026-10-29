"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Bot, Check, Copy, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { startAgentRun } from "./actions"

const SOURCES = [
  { id: "leads", label: "Qualified leads", hint: "Pick who to pitch first and draft the first message", unit: "leads" },
  { id: "candidates", label: "Review queue", hint: "Recommend approving or rejecting each candidate", unit: "waiting" },
  { id: "pipeline", label: "Pipeline", hint: "Suggest follow-ups and stage moves for creators you're talking to", unit: "creators" },
]

type Available = { leads: number; candidates: number; pipeline: number }

export function RunPanel({ ready, notReadyHint, slow, available, fixtureLeads = 0, fixCommand }: {
  ready: boolean; notReadyHint: string; slow?: boolean; available: Available; fixtureLeads?: number; fixCommand?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [sources, setSources] = useState<string[]>(SOURCES.map((s) => s.id))
  const [instructions, setInstructions] = useState("")
  const [maxProposals, setMaxProposals] = useState(10)
  const [includeFixtures, setIncludeFixtures] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const toggle = (id: string) => setSources((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const count = (id: string) => available[id as keyof Available] + (id === "leads" && includeFixtures ? fixtureLeads : 0)
  // A run with nothing to look at used to finish as "succeeded" with 0 proposals after many minutes.
  const nothingToDo = sources.length > 0 && sources.every((id) => count(id) === 0)
  const blocked = !sources.length ? "Select at least one source." : !ready ? null : nothingToDo ? "There's nothing to work on in the selected sources." : null

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-zinc-500">What to look at</legend>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {SOURCES.map((s) => {
            const on = sources.includes(s.id)
            const n = count(s.id)
            return (
              <label key={s.id} className={`relative flex cursor-pointer flex-col rounded-lg border p-3.5 transition-colors ${on ? "border-zinc-900 bg-zinc-50 dark:border-zinc-300 dark:bg-zinc-900" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="sr-only" />
                <span className={`absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded border ${on ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="pr-6 text-sm font-medium">{s.label}</span>
                <span className="mt-1 text-xs leading-5 text-zinc-500">{s.hint}</span>
                <span className="mt-3 flex items-baseline gap-1.5">
                  <span className={`text-xl font-semibold tabular-nums ${n ? "" : "text-zinc-400 dark:text-zinc-600"}`}>{n}</span>
                  <span className="text-xs text-zinc-500">{n ? s.unit : "nothing yet"}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="agent-focus" className="mb-2 block text-xs font-medium text-zinc-500">Focus <span className="font-normal text-zinc-400">(optional)</span></label>
        <textarea
          id="agent-focus"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="For example: prioritise UK podcasters, or only suggest follow-ups older than a week"
          className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:ring-zinc-700"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
        <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          Up to
          <input type="number" min={1} max={50} value={maxProposals} onChange={(e) => setMaxProposals(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            className="h-8 w-16 rounded-md border border-zinc-200 bg-white px-2 tabular-nums dark:border-zinc-800 dark:bg-zinc-950" />
          proposals
        </label>
        {fixtureLeads > 0 && (
          <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={includeFixtures} onChange={(e) => setIncludeFixtures(e.target.checked)} />
            Include {fixtureLeads} demo leads
          </label>
        )}
        <Button
          className="ml-auto"
          disabled={pending || !!blocked || !ready}
          onClick={() => start(async () => {
            setResult(null)
            const r = await startAgentRun({ sources, instructions, maxProposals, includeFixtures })
            setResult(r.error
              ? { ok: false, text: `The run failed: ${r.error}` }
              : { ok: true, text: `Finished in ${Math.round(r.durationMs / 1000)} s with ${r.proposals} ${r.proposals === 1 ? "proposal" : "proposals"}${r.proposals ? ", waiting for your review below" : ""}.` })
            router.refresh()
          })}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          {pending ? "Working…" : "Run agent"}
        </Button>
      </div>

      {pending && (
        <p className="text-xs text-zinc-500">
          {slow ? "The local model on this computer can take 10 minutes or more. You can leave this page; the run keeps going and appears under Recent runs." : "This usually takes under a minute. You can leave this page; the run appears under Recent runs."}
        </p>
      )}
      {blocked && !pending && <p className="text-xs text-amber-700 dark:text-amber-400">{blocked}{nothingToDo ? " Qualify leads on the Leads page, or select another source." : ""}</p>}
      {!ready && (
        <div className="space-y-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-amber-900 dark:text-amber-200">{notReadyHint}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {fixCommand && (
              <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/60 px-2.5 py-1 font-mono hover:bg-amber-100 dark:border-amber-500/30 dark:hover:bg-amber-500/20"
                onClick={() => { navigator.clipboard?.writeText(fixCommand).then(() => setCopied(true), () => {}) }}>
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? "Copied" : fixCommand}
              </button>
            )}
            <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/60 px-2.5 py-1 hover:bg-amber-100 dark:border-amber-500/30 dark:hover:bg-amber-500/20" onClick={() => router.refresh()}>
              <RefreshCw className="h-3 w-3" /> Check again
            </button>
          </div>
        </div>
      )}
      {result && <p className={`text-sm ${result.ok ? "text-zinc-700 dark:text-zinc-300" : "text-red-700 dark:text-red-300"}`}>{result.text}</p>}
    </div>
  )
}
