"use client"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { STAGES } from "@/lib/stages"
import { moveStage } from "./actions"
import { ChevronDown } from "lucide-react"

export function StageMover({ creatorId, currentStage, compact = false }: { creatorId: string; currentStage: string; compact?: boolean }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <div className="relative inline-block">
      <select
        value={currentStage}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value
          if (next === currentStage) return
          startTransition(async () => {
            await moveStage(creatorId, next)
            router.refresh()
          })
        }}
        className={`appearance-none rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 ${compact ? "text-[10px] py-0.5 pl-2 pr-5" : "text-xs py-1 pl-2 pr-6"} font-medium cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50`}
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <ChevronDown className={`absolute right-1 top-1/2 -translate-y-1/2 ${compact ? "h-2.5 w-2.5" : "h-3 w-3"} text-zinc-400 pointer-events-none`} />
    </div>
  )
}
