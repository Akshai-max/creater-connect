"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createTask, completeTask, uncompleteTask } from "./actions"
import { Button } from "@/components/ui/button"
import { CheckCircle2, Circle, Plus } from "lucide-react"
import { relativeDate } from "@/lib/utils"

export function NewTaskForm({ creatorId }: { creatorId: string }) {
  const [title, setTitle] = useState("")
  const [days, setDays] = useState(3)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <div className="flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New task…"
        className="min-w-0 flex-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-sm shadow-sm placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) {
            startTransition(async () => {
              await createTask(creatorId, title, days)
              setTitle("")
              router.refresh()
            })
          }
        }}
      />
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        className="shrink-0 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 text-xs"
      >
        <option value={0}>today</option>
        <option value={1}>tomorrow</option>
        <option value={3}>3 days</option>
        <option value={7}>1 week</option>
        <option value={14}>2 weeks</option>
        <option value={30}>1 month</option>
      </select>
      <Button
        size="sm"
        className="shrink-0"
        disabled={pending || !title.trim()}
        onClick={() => startTransition(async () => {
          await createTask(creatorId, title, days)
          setTitle("")
          router.refresh()
        })}
      >
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  )
}

export function TaskItem({ task }: { task: { id: string; title: string; body: string | null; dueDate: string | null; completed: boolean | null; source: string | null } }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const isOverdue = !task.completed && task.dueDate && new Date(task.dueDate) < new Date()

  return (
    <div className={`flex items-start gap-3 rounded-md p-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${task.completed ? "opacity-50" : ""}`}>
      <button
        disabled={pending}
        onClick={() => startTransition(async () => {
          if (task.completed) await uncompleteTask(task.id)
          else await completeTask(task.id)
          router.refresh()
        })}
        className="mt-0.5 shrink-0 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
      >
        {task.completed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${task.completed ? "line-through" : ""}`}>{task.title}</div>
        {task.body && <div className="text-xs text-zinc-500 mt-0.5">{task.body}</div>}
        <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400">
          {task.dueDate && (
            <span className={isOverdue ? "text-red-600 font-medium" : ""}>
              {isOverdue && "⚠ "}due {relativeDate(task.dueDate)}
            </span>
          )}
          {task.source === "auto_stage_transition" && <span className="text-zinc-400">· auto</span>}
        </div>
      </div>
    </div>
  )
}
