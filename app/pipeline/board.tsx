"use client"
// Jira-style pipeline board: drag cards between stage columns (optimistic, with
// undo), search + quick filters, collapsible columns. Dragging uses pointer
// events (mouse/pen): a preview follows the cursor, the board auto-scrolls at
// its edges, Esc cancels. Every card also has a "Move to" select so the board
// works with a keyboard and on touch screens.
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowRightLeft, ChevronsLeftRight, ListChecks, Mail, Minimize2, Search, X } from "lucide-react"
import { Avatar } from "@/components/avatar"
import { CLOSED_STAGES, STAGES, STAGE_ACCENT, type Stage } from "@/lib/stages"
import { cn, formatNumber } from "@/lib/utils"
import { moveStage } from "./actions"

export type BoardCard = {
  id: string
  name: string
  handle: string | null
  platform: string | null
  followers: number | null
  avatarUrl: string | null
  niche: string | null
  owner: string | null
  hasEmail: boolean
  stage: Stage
  stageChangedAt: string | null
  openTasks: number
  overdueTasks: number
}

const STUCK_DAYS = 14
const NEVER_STUCK: readonly Stage[] = ["Lead", "Paid", ...CLOSED_STAGES]
const PREFS_KEY = "pipeline-board-prefs"

const daysIn = (c: BoardCard) => (c.stageChangedAt ? Math.max(0, Math.floor((Date.now() - new Date(c.stageChangedAt).getTime()) / 86_400_000)) : null)
const isStuck = (c: BoardCard) => !NEVER_STUCK.includes(c.stage) && (daysIn(c) ?? 0) >= STUCK_DAYS

// compactEmpty: empty stages shrink to thin drop strips so the board fits the screen.
type Prefs = { collapsed: Stage[]; stuckOnly: boolean; platforms: string[]; compactEmpty: boolean }
const DEFAULT_PREFS: Prefs = { collapsed: [...CLOSED_STAGES], stuckOnly: false, platforms: [], compactEmpty: true }

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

type DragState = { id: string; x: number; y: number; dx: number; dy: number; width: number }
type Toast = { id: number; text: string; undo?: { cardId: string; stage: Stage }; error?: boolean }

export function PipelineBoard({ initialCards }: { initialCards: BoardCard[] }) {
  const router = useRouter()
  const [cards, setCards] = useState(initialCards)
  const [, startTransition] = useTransition()
  const [query, setQuery] = useState("")
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [overStage, setOverStage] = useState<Stage | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const pending = useRef(0)
  const boardRef = useRef<HTMLDivElement>(null)
  const press = useRef<{ id: string; x: number; y: number; rect: DOMRect } | null>(null)
  const justDragged = useRef(false)
  const dragId = drag?.id ?? null

  // Server data wins once no move is in flight (revalidatePath sends fresh props).
  useEffect(() => {
    if (pending.current === 0) setCards(initialCards)
  }, [initialCards])
  useEffect(() => setPrefs(loadPrefs()), [])
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch {}
  }, [prefs])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const platforms = useMemo(() => [...new Set(initialCards.map((c) => c.platform).filter(Boolean) as string[])].sort(), [initialCards])
  const q = query.trim().toLowerCase()
  const visible = cards.filter(
    (c) =>
      (!q || [c.name, c.handle, c.niche].some((v) => v?.toLowerCase().includes(q))) &&
      (!prefs.platforms.length || (c.platform && prefs.platforms.includes(c.platform))) &&
      (!prefs.stuckOnly || isStuck(c)),
  )
  const byStage = new Map<Stage, BoardCard[]>(STAGES.map((s) => [s, []]))
  for (const c of visible) byStage.get(c.stage)!.push(c)
  for (const list of byStage.values()) list.sort((a, b) => (daysIn(b) ?? -1) - (daysIn(a) ?? -1) || a.name.localeCompare(b.name))
  const stuckCount = cards.filter(isStuck).length
  // Empty stages share one slim rail (in pipeline order) so the board fits the screen.
  const railStages = prefs.compactEmpty ? STAGES.filter((s) => byStage.get(s)!.length === 0) : []
  const filtering = !!q || prefs.platforms.length > 0 || prefs.stuckOnly

  // Pointer drag lifecycle: press, then (moved > 5px) drag, then drop on the column under the pointer.
  useEffect(() => {
    const stageAt = (x: number, y: number) =>
      ((document.elementFromPoint(x, y) as HTMLElement | null)?.closest("[data-stage]") as HTMLElement | null)?.dataset.stage as Stage | undefined
    const onMove = (e: PointerEvent) => {
      const p = press.current
      if (!p) return
      if (!drag) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return
        setDrag({ id: p.id, x: e.clientX, y: e.clientY, dx: p.x - p.rect.left, dy: p.y - p.rect.top, width: p.rect.width })
        return
      }
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
      setOverStage(stageAt(e.clientX, e.clientY) ?? null)
    }
    const finish = (e: PointerEvent | null) => {
      const p = press.current
      press.current = null
      if (!drag || !p) return
      const target = e ? stageAt(e.clientX, e.clientY) : undefined
      justDragged.current = true
      setTimeout(() => (justDragged.current = false), 0)
      setDrag(null)
      setOverStage(null)
      if (target) move(p.id, target)
    }
    const onUp = (e: PointerEvent) => finish(e)
    const onCancel = () => finish(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
      window.removeEventListener("keydown", onKey)
    }
  })

  // Auto-scroll the board while dragging near its left/right edge.
  useEffect(() => {
    if (!drag) return
    const t = setInterval(() => {
      const el = boardRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (drag.x > r.right - 80) el.scrollLeft += 14
      else if (drag.x < r.left + 80) el.scrollLeft -= 14
    }, 16)
    return () => clearInterval(t)
  }, [drag])

  function move(cardId: string, to: Stage, opts: { undoable?: boolean } = { undoable: true }) {
    const card = cards.find((c) => c.id === cardId)
    if (!card || card.stage === to) return
    const from = card.stage
    const prevChangedAt = card.stageChangedAt
    setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, stage: to, stageChangedAt: new Date().toISOString() } : c)))
    pending.current++
    startTransition(async () => {
      try {
        await moveStage(cardId, to)
        setToast({ id: Date.now(), text: `Moved ${card.name} to ${to}`, undo: opts.undoable ? { cardId, stage: from } : undefined })
      } catch (e) {
        setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, stage: from, stageChangedAt: prevChangedAt } : c)))
        setToast({ id: Date.now(), text: `Couldn't move ${card.name}: ${(e as Error).message}`, error: true })
      } finally {
        pending.current--
        router.refresh()
      }
    })
  }

  const toggleCollapsed = (s: Stage) =>
    setPrefs((p) => ({ ...p, collapsed: p.collapsed.includes(s) ? p.collapsed.filter((x) => x !== s) : [...p.collapsed, s] }))
  const togglePlatform = (pl: string) =>
    setPrefs((p) => ({ ...p, platforms: p.platforms.includes(pl) ? p.platforms.filter((x) => x !== pl) : [...p.platforms, pl] }))

  return (
    <div className="flex h-screen flex-col px-6 pt-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {cards.length} creators · {stuckCount} stuck &gt;{STUCK_DAYS}d · drag a card to change its stage
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search creators"
            aria-label="Search creators"
            className="h-8 w-56 rounded-md border border-zinc-200 bg-white pl-8 pr-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600"
          />
        </label>
        {platforms.map((pl) => (
          <Chip key={pl} active={prefs.platforms.includes(pl)} onClick={() => togglePlatform(pl)}>
            {pl}
          </Chip>
        ))}
        <Chip active={prefs.stuckOnly} onClick={() => setPrefs((p) => ({ ...p, stuckOnly: !p.stuckOnly }))}>
          <AlertTriangle className="h-3 w-3" /> Stuck only
        </Chip>
        <Chip active={prefs.compactEmpty} onClick={() => setPrefs((p) => ({ ...p, compactEmpty: !p.compactEmpty }))}>
          <Minimize2 className="h-3 w-3" /> Compact empty
        </Chip>
        {filtering && (
          <button
            onClick={() => { setQuery(""); setPrefs((p) => ({ ...p, platforms: [], stuckOnly: false })) }}
            className="h-8 rounded-md px-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-zinc-500">{filtering ? `${visible.length} of ${cards.length} shown` : ""}</span>
      </div>

      {/* Board */}
      <div ref={boardRef} className={cn("board-scroll flex min-h-0 flex-1 gap-2 overflow-x-auto pb-3", drag && "cursor-grabbing select-none")}>
        {STAGES.map((stage) => {
          const items = byStage.get(stage)!
          if (railStages.includes(stage)) return null // shown in the empty-stages rail
          const manual = prefs.collapsed.includes(stage)
          const isOver = overStage === stage && dragId != null && cards.find((c) => c.id === dragId)?.stage !== stage
          if (manual) {
            return (
              <div
                key={stage}
                data-stage={stage}
                className={cn(
                  "flex shrink-0 flex-col items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-100/60 py-3 transition-all duration-150 dark:border-zinc-800 dark:bg-zinc-900/40",
                  "cursor-pointer hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60",
                  dragId ? "w-14 border-dashed" : "w-10",
                  isOver && "w-44 border-zinc-400 bg-zinc-200/70 dark:border-zinc-500 dark:bg-zinc-800",
                )}
                onClick={() => toggleCollapsed(stage)}
                title={`Expand ${stage}`}
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", STAGE_ACCENT[stage])} />
                <span className="rounded-full bg-zinc-200 px-1.5 text-[11px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{items.length}</span>
                {isOver ? (
                  <span className="px-2 text-center text-xs font-medium text-zinc-700 dark:text-zinc-200">Drop in {stage}</span>
                ) : (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 [writing-mode:vertical-rl] dark:text-zinc-400">{stage}</span>
                )}
              </div>
            )
          }

          return (
            <section
              key={stage}
              aria-label={`${stage} column`}
              data-stage={stage}
              className={cn(
                "flex min-w-60 max-w-sm flex-1 basis-0 flex-col rounded-lg border border-zinc-200 bg-zinc-100/60 transition-colors dark:border-zinc-800 dark:bg-zinc-900/60",
                isOver && "border-zinc-400 bg-zinc-200/70 dark:border-zinc-500 dark:bg-zinc-800/80",
              )}
            >
              <header className="group flex items-center gap-2 px-3 pb-2 pt-3">
                <span className={cn("h-2 w-2 rounded-full", STAGE_ACCENT[stage])} />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">{stage}</h2>
                <span className="rounded-full bg-zinc-200 px-1.5 text-[11px] font-medium tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{items.length}</span>
                <button
                  onClick={() => toggleCollapsed(stage)}
                  aria-label={`Collapse ${stage}`}
                  title="Collapse column"
                  className="ml-auto rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-200 hover:text-zinc-700 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <ChevronsLeftRight className="h-3.5 w-3.5" />
                </button>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {items.map((c) => (
                  <Card
                    key={c.id}
                    card={c}
                    dragging={dragId === c.id}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || e.pointerType === "touch") return
                      if ((e.target as HTMLElement).closest("a,button,select")) return
                      e.preventDefault() // no text selection while pressing a card
                      press.current = { id: c.id, x: e.clientX, y: e.clientY, rect: e.currentTarget.getBoundingClientRect() }
                    }}
                    onMove={(to) => move(c.id, to)}
                    onOpen={() => { if (!justDragged.current) router.push(`/creators/${c.id}`) }}
                  />
                ))}
                {items.length === 0 && (
                  <div
                    className={cn(
                      "flex flex-1 items-start justify-center rounded-md border border-dashed border-transparent px-3 py-6 text-center text-xs text-zinc-400 dark:text-zinc-600",
                      dragId && "border-zinc-300 dark:border-zinc-700",
                    )}
                  >
                    {dragId ? "Drop here" : filtering ? "No matches" : "No creators"}
                  </div>
                )}
                {dragId && items.length > 0 && isOver && (
                  <div className="rounded-md border border-dashed border-zinc-400 py-3 text-center text-xs text-zinc-500 dark:border-zinc-600">Drop here</div>
                )}
              </div>
            </section>
          )
        })}

        {railStages.length > 0 && (
          <aside
            aria-label="Empty stages"
            className={cn(
              "flex shrink-0 flex-col gap-1 rounded-lg border border-zinc-200 bg-zinc-100/40 p-1 transition-all duration-150 dark:border-zinc-800 dark:bg-zinc-900/40",
              dragId ? "w-44 border-dashed" : "w-11",
            )}
          >
            {railStages.map((stage) => {
              const isOver = overStage === stage && dragId != null
              return (
                <div
                  key={stage}
                  data-stage={stage}
                  title={`${stage}: no creators${dragId ? "" : ". Drag a card here to move it."}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-2 text-xs transition-colors",
                    dragId ? "min-h-10 border border-dashed border-zinc-300 dark:border-zinc-700" : "justify-center",
                    isOver && "border-zinc-500 bg-zinc-200 dark:border-zinc-500 dark:bg-zinc-800",
                  )}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", STAGE_ACCENT[stage])} />
                  {dragId && <span className="truncate font-medium text-zinc-600 dark:text-zinc-300">{isOver ? `Drop in ${stage}` : stage}</span>}
                </div>
              )
            })}
            {!dragId && (
              <span className="mt-1 text-center text-[10px] uppercase tracking-wide text-zinc-400 [writing-mode:vertical-rl] self-center">Empty stages</span>
            )}
          </aside>
        )}
      </div>

      {/* Drag preview */}
      {drag && (() => {
        const c = cards.find((x) => x.id === drag.id)
        return c ? (
          <div
            className="pointer-events-none fixed z-50 rotate-2 opacity-95 shadow-2xl"
            style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }}
          >
            <CardBody card={c} />
          </div>
        ) : null
      })()}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg",
            toast.error
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              : "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
          )}
        >
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
              onClick={() => { const u = toast.undo!; setToast(null); move(u.cardId, u.stage, { undoable: false }) }}
            >
              Undo
            </button>
          )}
          <button aria-label="Dismiss" onClick={() => setToast(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium capitalize transition-colors",
        active
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
      )}
    >
      {children}
    </button>
  )
}

function Card({
  card: c, dragging, onPointerDown, onMove, onOpen,
}: {
  card: BoardCard
  dragging: boolean
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onMove: (to: Stage) => void
  onOpen: () => void
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,select")) return
        onOpen()
      }}
      className={cn("cursor-grab select-none", dragging && "opacity-30 [&>article]:border-dashed")}
    >
      <CardBody card={c} onMove={onMove} />
    </div>
  )
}

function CardBody({ card: c, onMove }: { card: BoardCard; onMove?: (to: Stage) => void }) {
  const days = daysIn(c)
  const stuck = isStuck(c)
  return (
    <article
      className={cn(
        "group rounded-md border border-zinc-200 bg-white p-3 shadow-sm transition hover:border-zinc-300 hover:shadow dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700",
        stuck && "border-l-2 border-l-amber-500 dark:border-l-amber-500",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Avatar name={c.name} url={c.avatarUrl} creatorId={c.id} size="sm" />
        <div className="min-w-0 flex-1">
          <Link href={`/creators/${c.id}`} draggable={false} className="block truncate text-sm font-medium hover:underline">
            {c.name}
          </Link>
          <div className="truncate text-xs text-zinc-500">{c.handle ?? "—"}</div>
        </div>
      </div>

      {c.niche && <div className="mt-2 truncate text-xs text-zinc-500 dark:text-zinc-400">{c.niche}</div>}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        {c.platform && <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{c.platform}</span>}
        <span className="text-zinc-500">{formatNumber(c.followers)}</span>
        {c.hasEmail && <span title="Has email"><Mail className="h-3 w-3 text-zinc-400" /></span>}
        {c.openTasks > 0 && (
          <span title={`${c.openTasks} open task(s)${c.overdueTasks ? `, ${c.overdueTasks} overdue` : ""}`}
            className={cn("inline-flex items-center gap-0.5", c.overdueTasks ? "text-red-600 dark:text-red-400" : "text-zinc-500")}>
            <ListChecks className="h-3 w-3" />{c.openTasks}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
        <span
          className={cn("inline-flex items-center gap-1 text-[11px]", stuck ? "font-medium text-amber-600 dark:text-amber-400" : "text-zinc-400")}
          title={stuck ? `In this stage over ${STUCK_DAYS} days` : undefined}
        >
          {stuck && <AlertTriangle className="h-3 w-3" />}
          {days == null ? "—" : days === 0 ? "Moved today" : `${days}d in stage`}
        </span>
        <label className="relative inline-flex items-center opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <span className="sr-only">Move {c.name} to stage</span>
          <ArrowRightLeft className="pointer-events-none absolute left-1.5 h-3 w-3 text-zinc-400" />
          <select
            value={c.stage}
            onChange={(e) => onMove?.(e.target.value as Stage)}
            className="h-6 cursor-pointer appearance-none rounded border border-zinc-200 bg-white pl-5 pr-1.5 text-[11px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
    </article>
  )
}
