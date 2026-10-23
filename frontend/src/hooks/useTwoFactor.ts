import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ackSecurityNotice,
  disableTwoFactor,
  enableTwoFactor,
  fetchSecurityNotice,
  fetchTwoFactorStatus,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
} from "@/lib/api"
import type { TwoFactorDisableRequest, TwoFactorRegenerateRequest } from "@/types/api"

export const twoFactorQueryKey = ["two-factor"] as const
// Deliberately not under "auth": logout drops every non-"auth" query, so the next login on this
// browser can't flash the previous session's notice (see useLogout).
export const securityNoticeQueryKey = ["security-notice"] as const

export function useTwoFactorStatus() {
  return useQuery({ queryKey: twoFactorQueryKey, queryFn: fetchTwoFactorStatus })
}

export function useStartTwoFactorSetup() {
  return useMutation({ mutationFn: startTwoFactorSetup })
}

export function useEnableTwoFactor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => enableTwoFactor(code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: twoFactorQueryKey }),
  })
}

export function useDisableTwoFactor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: TwoFactorDisableRequest) => disableTwoFactor(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: twoFactorQueryKey }),
  })
}

export function useRegenerateRecoveryCodes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: TwoFactorRegenerateRequest) => regenerateRecoveryCodes(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: twoFactorQueryKey }),
  })
}

// Failed login attempts since the owner last dismissed the notice. Only meaningful while signed in.
export function useSecurityNotice(enabled: boolean) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: securityNoticeQueryKey,
    queryFn: fetchSecurityNotice,
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const ack = useMutation({
    mutationFn: ackSecurityNotice,
    onMutate: () => {
      queryClient.setQueryData(securityNoticeQueryKey, { failedAttempts: 0, since: "", lastAttemptAt: null })
    },
  })
  return {
    notice: query.data && query.data.failedAttempts > 0 ? query.data : null,
    dismiss: () => ack.mutate(),
  }
}
