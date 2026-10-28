"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Home, Users, Sparkles, Mail, Kanban, LogOut, BadgeCheck, Activity, Bot } from "lucide-react"
import { logout } from "@/app/login/actions"

const nav = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/candidates", label: "Review queue", icon: Sparkles },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/creators", label: "Roster", icon: Users },
  { href: "/outreach", label: "Outreach", icon: Mail },
  { href: "/leads", label: "Leads", icon: BadgeCheck },
  { href: "/engine", label: "Engine", icon: Activity },
  { href: "/agent", label: "AI agent", icon: Bot },
]

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="hidden md:flex w-60 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="px-6 py-5 border-b border-zinc-200 dark:border-zinc-800">
        <Link href="/" className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Creator <span className="text-zinc-500 dark:text-zinc-400">CRM</span>
        </Link>
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Discovery & roster</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="px-3 py-3 border-t border-zinc-200 dark:border-zinc-800">
        <form action={logout}>
          <button type="submit" className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 transition-colors">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </form>
        <div className="px-3 pt-2 text-xs text-zinc-400 dark:text-zinc-500">Creator CRM · v0.1</div>
      </div>
    </aside>
  )
}
