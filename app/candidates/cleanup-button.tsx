"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Sparkles, AlertCircle, CheckCircle2 } from "lucide-react"
import { cleanupCandidates, type CleanupResult } from "./cleanup-actions"

export function CleanupButton() {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<CleanupResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setResult(null); setErr(null)
          startTransition(async () => {
            try {
              const r = await cleanupCandidates()
              setResult(r)
              router.refresh()
            } catch (e: any) {
              setErr(e?.message ?? String(e))
            }
          })
        }}
      >
        <Sparkles className={`h-3.5 w-3.5 ${pending ? "animate-pulse" : ""}`} />
        {pending ? "Cleaning…" : "Auto-clean queue"}
      </Button>
      {err && (
        <div className="flex items-start gap-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {err}
        </div>
      )}
      {result && (
        <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-xs max-w-2xl">
          <div className="font-medium text-emerald-900 dark:text-emerald-100 mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {result.totalBefore} → {result.remaining} pending
            <span className="text-emerald-700 dark:text-emerald-300">
              ({result.rejected} rejected, {result.duplicates} dupes removed)
            </span>
          </div>
          {result.rejectionReasons.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300 mb-1">Reasons</div>
              <ul className="space-y-0.5 text-emerald-900 dark:text-emerald-100">
                {result.rejectionReasons.map((r) => (
                  <li key={r.reason}>· {r.reason} <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">×{r.count}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
