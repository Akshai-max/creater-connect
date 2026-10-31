"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { reviewEntity } from "./actions"

const NOT_INDIVIDUAL = [
  ["brand", "Brand / company"],
  ["agency", "Agency"],
  ["management", "Management / network"],
  ["publication", "Media / publication"],
  ["fan_account", "Fan / re-upload"],
] as const

export function ReviewButtons({ leadId }: { leadId: string }) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const decide = (decision: string) => start(async () => {
    setError(null)
    try {
      const r = await reviewEntity(leadId, decision)
      setResult(decision === "individual"
        ? (r.status === "qualified" ? `Qualified${r.priority === "A" ? " · Priority A" : ""}` : `Saved · still ${r.status}`)
        : "Saved as not an individual")
      router.refresh()
    } catch (e) { setError((e as Error).message) }
  })

  if (result) return <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" /> {result}</div>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="success" disabled={pending} onClick={() => decide("individual")}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} One person runs it
      </Button>
      <span className="text-xs text-zinc-400">or not an individual:</span>
      {NOT_INDIVIDUAL.map(([d, label]) => (
        <Button key={d} size="sm" variant="outline" disabled={pending} onClick={() => decide(d)}>{label}</Button>
      ))}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
