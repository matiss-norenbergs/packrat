import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { markLoggedOut } from "@/hooks/useAuth"
import { fetchSessions, revokeOtherSessions, revokeSession } from "@/lib/api"
import type { ActiveSession } from "@/types/api"

// Not under "auth": logout drops every non-"auth" query, so the next login on this browser can't
// flash the previous account's device list.
export const sessionsQueryKey = ["sessions"] as const

export function useSessions() {
  return useQuery({ queryKey: sessionsQueryKey, queryFn: fetchSessions })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (session: ActiveSession) => revokeSession(session.id, session.current),
    onSuccess: (_data, session) => {
      // Signing out the device you are on is a logout.
      if (session.current) markLoggedOut(queryClient)
      else queryClient.invalidateQueries({ queryKey: sessionsQueryKey })
    },
    // The row may already be gone (revoked elsewhere): refresh either way.
    onError: (err: Error) => {
      toast.error(err.message)
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey })
    },
  })
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: (count) => {
      toast.success(count === 1 ? "Signed out 1 other device" : `Signed out ${count} other devices`)
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
