import { NewDownloadDialog } from "@/components/downloads/NewDownloadDialog"
import { BulkDownloadDialog } from "@/components/downloads/BulkDownloadDialog"
import { DownloadQueueList } from "@/components/downloads/DownloadQueueList"

export function DownloadsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Downloads</h1>
        <div className="flex flex-wrap gap-2">
          <BulkDownloadDialog />
          <NewDownloadDialog />
        </div>
      </div>
      <DownloadQueueList />
    </div>
  )
}
