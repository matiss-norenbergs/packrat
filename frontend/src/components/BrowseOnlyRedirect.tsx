import { Navigate } from "react-router-dom"

// What a management-area layout (and the not-found error page) renders instead of its content in
// the Android app's Browse-only mode: a replace-redirect to Browse home, so the admin page never
// mounts and the back gesture doesn't return to it. Callers check isBrowseOnlyApp() first.
export function BrowseOnlyRedirect() {
  return <Navigate to="/browse" replace />
}
