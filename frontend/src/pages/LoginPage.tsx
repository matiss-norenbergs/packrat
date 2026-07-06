import { useState } from "react"
import { Navigate } from "react-router-dom"
import { Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuthStatus, useLogin, useSetupAccount } from "@/hooks/useAuth"

export function LoginPage() {
  const { data: status, isLoading } = useAuthStatus()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const setupAccount = useSetupAccount()
  const login = useLogin()

  if (isLoading || !status) return null
  // Also handles the post-login/post-setup redirect: both mutations write
  // {authenticated: true} into this same cached query synchronously
  // (queryClient.setQueryData, not just invalidate), so this check re-fires
  // and redirects on the very next render — no separate imperative
  // navigate() needed (and one must NOT be added here too: an explicit
  // navigate() racing against this reactive redirect is what caused a
  // stuck-on-/login bug during development).
  if (status.authenticated) return <Navigate to="/" replace />

  const isSetup = status.setupRequired
  const pending = setupAccount.isPending || login.isPending
  const passwordsMismatch = isSetup && password.length > 0 && password !== confirmPassword

  const handleSubmit = () => {
    if (!username.trim() || !password) return
    if (isSetup) {
      if (passwordsMismatch) return
      setupAccount.mutate({ username: username.trim(), password })
    } else {
      login.mutate({ username: username.trim(), password })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit()
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Package className="h-5 w-5" />
            <span className="text-base font-semibold">Packrat</span>
          </div>
          <CardTitle>{isSetup ? "Create admin account" : "Log in"}</CardTitle>
          <CardDescription>
            {isSetup
              ? "This is a one-time setup — this account is the only login for this instance."
              : "Enter your username and password to continue."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          {isSetup && (
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              {passwordsMismatch && <p className="text-xs text-destructive">Passwords don't match</p>}
            </div>
          )}
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={pending || !username.trim() || !password || passwordsMismatch}
          >
            {pending ? "Please wait…" : isSetup ? "Create account" : "Log in"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
