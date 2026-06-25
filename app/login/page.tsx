import { LoginForm } from "./login-form"

export const dynamic = "force-dynamic"

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Creator CRM</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Sign in to continue</p>
        </div>
        <LoginForm next={params.next} error={params.error} />
      </div>
    </div>
  )
}
