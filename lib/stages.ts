export const STAGES = [
  "Lead",
  "Outreached",
  "Replied",
  "Negotiating",
  "Briefed",
  "Content In",
  "Live",
  "Paid",
  "Past Hire",
  "Cold",
] as const

export type Stage = (typeof STAGES)[number]

export const STAGE_COLORS: Record<Stage, string> = {
  "Lead":         "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200 border-blue-200 dark:border-blue-800",
  "Outreached":   "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-200 border-indigo-200 dark:border-indigo-800",
  "Replied":      "bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-200 border-purple-200 dark:border-purple-800",
  "Negotiating":  "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 border-amber-200 dark:border-amber-800",
  "Briefed":      "bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200 border-orange-200 dark:border-orange-800",
  "Content In":   "bg-teal-100 text-teal-900 dark:bg-teal-900/30 dark:text-teal-200 border-teal-200 dark:border-teal-800",
  "Live":         "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200 border-green-200 dark:border-green-800",
  "Paid":         "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800",
  "Past Hire":    "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700",
  "Cold":         "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200 border-red-200 dark:border-red-800",
}

export function isStage(s: string | null | undefined): s is Stage {
  return !!s && (STAGES as readonly string[]).includes(s)
}
