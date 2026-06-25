"use client"
import { useState, useTransition } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { LogIn, AlertCircle } from "lucide-react"
import { login } from "./actions"

export function LoginForm({ next, error: initialError }: { next?: string; error?: string }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(initialError === "wrong" ? "Incorrect password" : null)
  const [pending, startTransition] = useTransition()

  return (
    <Card>
      <CardContent className="p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            startTransition(async () => {
              const r = await login(password, next)
              if (r?.error) setError(r.error)
            })
          }}
          className="space-y-4"
        >
          <div>
            <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">Password</label>
            <Input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </div>
          )}
          <Button type="submit" disabled={pending || !password} className="w-full">
            <LogIn className="h-4 w-4" /> {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
