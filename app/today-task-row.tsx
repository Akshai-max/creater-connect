"use client"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { completeTask } from "./creators/[id]/actions"
import { CheckCircle2, Circle } from "lucide-react"
import Link from "next/link"
import { relativeDate } from "@/lib/utils"

export function TodayTaskRow({ task }: { task: { id: string; title: string; dueDate: string | null; creatorId: string | null; creatorName: string | null; source: string | null } }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date()

  return (
    <div className="flex items-start gap-3 rounded-md p-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
      <button
        disabled={pending}
        onClick={() => startTransition(async () => {
          await completeTask(task.id)
          router.refresh()
        })}
        className="mt-0.5 shrink-0 text-zinc-400 hover:text-emerald-600 transition-colors"
      >
        <Circle className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm">{task.title}</div>
        <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
          {task.creatorId && task.creatorName && (
            <Link href={`/creators/${task.creatorId}`} className="hover:underline truncate">
              {task.creatorName}
            </Link>
          )}
          <span className={isOverdue ? "text-red-600 font-medium" : ""}>
            {isOverdue && "⚠ "}due {relativeDate(task.dueDate)}
          </span>
          {task.source === "auto_stage_transition" && <span className="text-zinc-400">· auto</span>}
        </div>
      </div>
    </div>
  )
}
