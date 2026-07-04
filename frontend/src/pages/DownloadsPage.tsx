import { NewDownloadDialog } from "@/components/downloads/NewDownloadDialog"
import { BulkDownloadDialog } from "@/components/downloads/BulkDownloadDialog"
import { DownloadQueueList } from "@/components/downloads/DownloadQueueList"

export function DownloadsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Downloads</h1>
        <div className="flex gap-2">
          <BulkDownloadDialog />
          <NewDownloadDialog />
        </div>
      </div>
      <DownloadQueueList />
    </div>
  )
}
