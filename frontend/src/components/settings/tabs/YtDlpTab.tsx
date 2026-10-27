import { Cookie, Globe, Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldLabel } from "@/components/ui/info-popover"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useUpdateSettings, useUpdateYtDlp, useYtDlpVersion } from "@/hooks/useSettings"
import type { Settings, UpdateSettingsRequest } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"
import { SettingsTabLoader } from "@/components/settings/SettingsTabLoader"
import { useSettingsDraft } from "@/hooks/useSettingsDraft"

// Radix Select disallows an empty-string item value, so "none" is used as
// the sentinel for "no cookies browser configured" and translated back to
// "" on save — same trick used by FilenameTemplateBuilderDialog's NO_MODIFIER.
const NO_COOKIES_BROWSER = "none"
const YTDLP_COOKIE_BROWSERS = ["brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale"] as const

function toForm(s: Settings) {
  return {
    cookiesBrowser: s.ytdlpCookiesBrowser || NO_COOKIES_BROWSER,
    cookiesProfile: s.ytdlpCookiesProfile,
    cookiesFile: s.ytdlpCookiesFile,
    proxy: s.ytdlpProxy,
    rateLimit: s.ytdlpRateLimit,
    retries: s.ytdlpRetries > 0 ? String(s.ytdlpRetries) : "",
  }
}

export function YtDlpTab() {
  return (
    <SettingsTabLoader skeletonClassName="h-40 w-full max-w-lg">
      {(settings) => <YtDlpTabBody settings={settings} />}
    </SettingsTabLoader>
  )
}

function YtDlpTabBody({ settings }: { settings: Settings }) {
  const updateSettings = useUpdateSettings()
  const { data, isLoading } = useYtDlpVersion()
  const update = useUpdateYtDlp()
  const { field, afterSave } = useSettingsDraft(settings, toForm)
  const [cookiesBrowser, setCookiesBrowser] = field("cookiesBrowser")
  const [cookiesProfile, setCookiesProfile] = field("cookiesProfile")
  const [cookiesFile, setCookiesFile] = field("cookiesFile")
  const [proxy, setProxy] = field("proxy")
  const [rateLimit, setRateLimit] = field("rateLimit")
  const [retries, setRetries] = field("retries")

  const payload: UpdateSettingsRequest = {}
  const browserValue = cookiesBrowser === NO_COOKIES_BROWSER ? "" : cookiesBrowser
  if (browserValue !== settings.ytdlpCookiesBrowser) payload.ytdlpCookiesBrowser = browserValue
  if (cookiesProfile !== settings.ytdlpCookiesProfile) payload.ytdlpCookiesProfile = cookiesProfile
  if (cookiesFile !== settings.ytdlpCookiesFile) payload.ytdlpCookiesFile = cookiesFile
  if (proxy !== settings.ytdlpProxy) payload.ytdlpProxy = proxy
  if (rateLimit !== settings.ytdlpRateLimit) payload.ytdlpRateLimit = rateLimit
  const retriesValue = retries.trim() === "" ? 0 : Number(retries)
  if (!Number.isNaN(retriesValue) && retriesValue !== settings.ytdlpRetries) payload.ytdlpRetries = retriesValue
  const dirty = Object.keys(payload).length > 0

  return (
    <div className="flex min-h-full flex-col">
      <div className="max-w-3xl space-y-6 pb-6">
        <SettingsCard icon={Package} title="yt-dlp version">
          <div className="max-w-lg space-y-4">
            {isLoading || !data ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <div className="space-y-1 text-sm">
                  <p>
                    Current version: <span className="font-mono">{data.currentVersion}</span>
                  </p>
                  {data.updateAvailable ? (
                    <p className="text-warning">
                      Update available: <span className="font-mono">{data.latestVersion}</span>
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      Up to date{data.latestVersion ? "" : " (couldn't check latest)"}.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={() => update.mutate()} disabled={update.isPending}>
                    {update.isPending ? "Updating…" : "Update yt-dlp"}
                  </Button>
                  <span className="text-xs text-muted-foreground">Runs immediately; not part of Save.</span>
                </div>
              </>
            )}
          </div>
        </SettingsCard>

        <SettingsCard icon={Cookie} title="Cookies">
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="ytdlp-cookies-file"
                info="Paste or upload a Netscape-format cookies.txt (exported from your browser with an extension like 'Get cookies.txt'). Unlike Cookies browser below, this works in Docker — yt-dlp reads the file directly instead of needing a real browser profile on the same machine. Takes priority over Cookies browser when both are set."
              >
                Cookies file
              </FieldLabel>
              <Textarea
                id="ytdlp-cookies-file"
                placeholder="# Netscape HTTP Cookie File&#10;.youtube.com	TRUE	/	TRUE	...	..."
                className="h-28 font-mono text-xs"
                value={cookiesFile}
                onChange={(e) => setCookiesFile(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept=".txt,text/plain"
                  className="h-8 max-w-64"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setCookiesFile(await file.text())
                    e.target.value = ""
                  }}
                />
                {cookiesFile && (
                  <Button variant="ghost" size="sm" onClick={() => setCookiesFile("")}>
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <FieldLabel
                htmlFor="ytdlp-cookies-browser"
                info={
                  cookiesFile
                    ? "Ignored while a cookies file is set above. Reads cookies directly from an installed browser's profile — only works when yt-dlp runs on the same machine as that browser, not in Docker."
                    : "Reads cookies directly from an installed browser's profile — only works when yt-dlp runs on the same machine as that browser (not in Docker). Prefer Cookies file above for a container deployment."
                }
              >
                Cookies browser
              </FieldLabel>
              <Select value={cookiesBrowser} onValueChange={setCookiesBrowser} disabled={!!cookiesFile}>
                <SelectTrigger id="ytdlp-cookies-browser" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COOKIES_BROWSER}>None</SelectItem>
                  {YTDLP_COOKIE_BROWSERS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b[0].toUpperCase() + b.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ytdlp-cookies-profile">Profile (optional)</Label>
              <Input
                id="ytdlp-cookies-profile"
                placeholder="e.g. Default"
                value={cookiesProfile}
                onChange={(e) => setCookiesProfile(e.target.value)}
                disabled={cookiesBrowser === NO_COOKIES_BROWSER || !!cookiesFile}
              />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard icon={Globe} title="Network">
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ytdlp-proxy">Proxy</Label>
              <Input
                id="ytdlp-proxy"
                placeholder="e.g. socks5://127.0.0.1:1080"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ytdlp-rate-limit">Rate limit</Label>
                <Input
                  id="ytdlp-rate-limit"
                  placeholder="e.g. 500K"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ytdlp-retries">Retries</Label>
                <Input
                  id="ytdlp-retries"
                  type="number"
                  min="0"
                  placeholder="10 (yt-dlp default)"
                  value={retries}
                  onChange={(e) => setRetries(e.target.value)}
                />
              </div>
            </div>
          </div>
        </SettingsCard>
      </div>
      <SaveRow
        dirty={dirty}
        isPending={updateSettings.isPending}
        isSuccess={updateSettings.isSuccess}
        onSave={() => updateSettings.mutate(payload, { onSuccess: afterSave })}
      />
    </div>
  )
}
