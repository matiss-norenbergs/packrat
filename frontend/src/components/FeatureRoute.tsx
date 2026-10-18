import { Link, Outlet } from "react-router-dom"
import type { FeatureKey } from "@/hooks/useFeature"
import { useSettings } from "@/hooks/useSettings"

// Route guard for an optional feature (Settings → Features). Renders the page
// while the feature is on; when it's off, shows the same "disabled" notice
// AI Enhancement does instead of a page whose API calls would all be rejected.
// Waits for settings first, so a disabled page never mounts and fires requests.
export function FeatureRoute({ feature, name }: { feature: FeatureKey; name: string }) {
  const { data: settings, isLoading } = useSettings()
  if (isLoading) return null
  if (settings?.[feature] === false) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-semibold">{name}</h1>
        <p className="text-sm text-muted-foreground">
          This feature is turned off. Turn it on in{" "}
          <Link to="/settings?tab=features" className="underline underline-offset-2 hover:text-foreground">
            Settings → Features
          </Link>{" "}
          to use it.
        </p>
      </div>
    )
  }
  return <Outlet />
}
