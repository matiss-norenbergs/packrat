import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Downloads</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            See the <a href="/downloads" className="underline">Downloads</a> page for active and queued downloads.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Library</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            See the <a href="/library" className="underline">Library</a> page for completed downloads.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Statistics, storage usage, and recent activity are not implemented yet in this working
            skeleton.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
