import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { changePassword, fetchAuthStatus, login, login2fa, logout, setupAccount } from "@/lib/api"
import type { AuthStatus, ChangePasswordRequest, Login2FARequest, LoginRequest, SetupRequest } from "@/types/api"

export const authStatusQueryKey = ["auth", "status"] as const

export function useAuthStatus() {
  return useQuery({
    queryKey: authStatusQueryKey,
    queryFn: fetchAuthStatus,
  })
}

export function useSetupAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: SetupRequest) => setupAccount(payload),
    onSuccess: () => {
      // Set the cache synchronously rather than only invalidating —
      // invalidateQueries just kicks off a background refetch, so an
      // immediate navigate("/") right after would otherwise race it:
      // AppLayout's gate reads the still-stale cached status and bounces
      // straight back to /login before the refetch resolves.
      queryClient.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: true })
    },
    onError: (err: Error) => toast.error(`Setup failed: ${err.message}`),
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: LoginRequest) => login(payload),
    onSuccess: (result) => {
      // An account with 2FA is not signed in yet: the caller shows the code step instead.
      if (result.twoFactorRequired) return
      queryClient.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: true })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// Second login step for an account with 2FA: a TOTP code or a recovery code.
export function useLogin2fa() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Login2FARequest) => login2fa(payload),
    onSuccess: () => {
      queryClient.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: true })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// Local state after the session is gone (logout, or revoking the device you are on).
export function markLoggedOut(queryClient: QueryClient) {
  queryClient.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: false })
  // Drop every OTHER cached protected-page query (not just invalidate —
  // a stale library/downloads list must never flash for whoever logs in
  // next on this browser). Excludes the auth key itself: clearing it
  // too (e.g. via queryClient.clear()) removes the very entry the
  // setQueryData call above just wrote, which left AppLayout's gate
  // reading stale cached data instead of picking up the fresh
  // {authenticated: false} — the redirect silently never fired.
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => logout(),
    onSuccess: () => markLoggedOut(queryClient),
    onError: (err: Error) => toast.error(`Logout failed: ${err.message}`),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: ChangePasswordRequest) => changePassword(payload),
    onSuccess: () => toast.success("Password changed"),
    onError: (err: Error) => toast.error(err.message),
  })
}
