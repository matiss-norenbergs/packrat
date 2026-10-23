// "Just now", "5 min ago", "3 h ago", "2 d ago"; anything older than a month falls back to the date.
export function formatTimeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (Number.isNaN(seconds) || seconds < 60) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} d ago`
  return then.toLocaleDateString()
}
