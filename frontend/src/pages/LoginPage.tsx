import { useState } from "react"
import { Navigate } from "react-router-dom"
import { PackratLogo } from "@/components/PackratLogo"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Toaster } from "@/components/ui/sonner"
import { TotpCodeInput } from "@/components/TotpCodeInput"
import { useAuthStatus, useLogin, useLogin2fa, useSetupAccount } from "@/hooks/useAuth"
import { ApiError } from "@/lib/api"
import { getServerUrl, isDesktop, resetServer } from "@/lib/server"

export function LoginPage() {
  const { data: status, isLoading } = useAuthStatus()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  // Second login step, only for an account with two-factor auth on: the challenge the password
  // step returned, and the code (or recovery code) being typed for it.
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [useRecovery, setUseRecovery] = useState(false)
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null)

  const setupAccount = useSetupAccount()
  const login = useLogin()
  const login2fa = useLogin2fa()

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
  const passwordTooShort = isSetup && password.length > 0 && password.length < 8

  const handleSubmit = () => {
    if (!username.trim() || !password) return
    if (isSetup) {
      if (passwordsMismatch || passwordTooShort) return
      setupAccount.mutate({ username: username.trim(), password })
    } else {
      setExpiredMessage(null)
      login.mutate(
        { username: username.trim(), password },
        {
          onSuccess: (result) => {
            if (!result.twoFactorRequired) return
            setChallenge(result.challengeToken)
            setCode("")
            setUseRecovery(false)
          },
        },
      )
    }
  }

  const backToPassword = () => {
    setChallenge(null)
    setCode("")
    setPassword("")
  }

  const codeReady = useRecovery ? code.trim().length >= 8 : code.length === 6

  // `filled` is passed by the OTP field's onComplete, since state hasn't caught up with the last digit yet.
  const handleCodeSubmit = (filled?: string) => {
    if (!challenge || login2fa.isPending) return
    if (!useRecovery && (filled ?? code).length !== 6) return
    if (useRecovery && !codeReady) return
    const payload = useRecovery
      ? { challengeToken: challenge, recoveryCode: code.trim() }
      : { challengeToken: challenge, code: filled ?? code }
    login2fa.mutate(payload, {
      onError: (err) => {
        if (err instanceof ApiError && err.challengeExpired) {
          // Expired, used up or too many wrong codes: the password has to be entered again.
          backToPassword()
          setExpiredMessage(err.message)
        } else {
          setCode("")
        }
      },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit()
  }

  if (challenge) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Toaster />
        <Card className="w-full max-w-sm">
          <CardHeader>
            <div className="mb-2 flex items-center gap-2">
              <PackratLogo className="h-5 w-5 shrink-0" />
              <span className="text-base font-semibold">Packrat</span>
            </div>
            <CardTitle>Two-factor authentication</CardTitle>
            <CardDescription>
              {useRecovery
                ? "Enter one of your recovery codes. Each can be used once."
                : "Enter the 6-digit code from your authenticator app."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="two-factor-code">{useRecovery ? "Recovery code" : "Authentication code"}</Label>
              {useRecovery ? (
                <Input
                  id="two-factor-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCodeSubmit()}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="XXXX-XXXX"
                  className="font-mono"
                  autoFocus
                />
              ) : (
                <TotpCodeInput
                  id="two-factor-code"
                  value={code}
                  onChange={setCode}
                  onComplete={handleCodeSubmit}
                  onEnter={() => handleCodeSubmit()}
                  disabled={login2fa.isPending}
                />
              )}
            </div>
            <Button className="w-full" onClick={() => handleCodeSubmit()} disabled={login2fa.isPending || !codeReady}>
              {login2fa.isPending ? "Please wait…" : "Verify"}
            </Button>
            <div className="flex items-center justify-between text-xs">
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={backToPassword}>
                Back
              </Button>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => {
                  setUseRecovery((v) => !v)
                  setCode("")
                }}
              >
                {useRecovery ? "Use an authenticator code" : "Use a recovery code"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
        <Toaster />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <PackratLogo className="h-5 w-5 shrink-0" />
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
          {expiredMessage && (
            <p role="alert" className="text-sm text-destructive">
              {expiredMessage}
            </p>
          )}
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
            {isSetup && (
              <p className={`text-xs ${passwordTooShort ? "text-destructive" : "text-muted-foreground"}`}>
                Must be at least 8 characters
              </p>
            )}
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
          {isSetup && (
            <p className="text-xs text-muted-foreground">
              Only download content you have the right to download.
            </p>
          )}
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={pending || !username.trim() || !password || passwordsMismatch || passwordTooShort}
          >
            {pending ? "Please wait…" : isSetup ? "Create account" : "Log in"}
          </Button>
          {isDesktop() && (
            <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span className="min-w-0 truncate" title={getServerUrl() ?? undefined}>
                {getServerUrl()}
              </span>
              <Button
                variant="link"
                size="sm"
                className="h-auto shrink-0 p-0 text-xs"
                onClick={() => {
                  resetServer()
                  window.location.reload()
                }}
              >
                Change server
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
