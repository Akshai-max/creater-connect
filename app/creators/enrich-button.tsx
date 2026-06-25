"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Sparkles, CheckCircle2, AlertCircle } from "lucide-react"
import { enrichRosterBatch } from "./enrich-actions"

type Result = {
  scanned: number
  enriched: number
  skipped: number
  errors: number
  remaining: number
  details: { handle: string; status: string; reason?: string }[]
}

export function EnrichButton() {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<Result | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()

  const run = () => {
    setResult(null)
    setErr(null)
    startTransition(async () => {
      try {
        const r = await enrichRosterBatch(50)
        setResult(r)
        router.refresh()
      } catch (e: any) {
        setErr(e?.message ?? String(e))
      }
    })
  }

  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={pending} variant="secondary" size="sm">
        <Sparkles className={`h-3.5 w-3.5 ${pending ? "animate-pulse" : ""}`} />
        {pending ? "Enriching…" : "Enrich roster"}
      </Button>

      {err && (
        <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 max-w-md">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {result && (
        <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-xs max-w-md">
          <div className="flex items-center gap-2 font-medium text-emerald-900 dark:text-emerald-100 mb-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {result.enriched} enriched · {result.skipped} skipped · {result.errors} errors
          </div>
          <div className="text-emerald-800 dark:text-emerald-200">
            {result.remaining > 0
              ? `${result.remaining} more candidates pending — click again to continue.`
              : "All eligible creators enriched."}
          </div>
        </div>
      )}
    </div>
  )
}
