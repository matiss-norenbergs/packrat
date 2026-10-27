import { useTheme } from "next-themes"
import { Palette } from "lucide-react"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAccentColor, type AccentColor } from "@/hooks/useAccentColor"

const ACCENT_COLOR_OPTIONS: { value: AccentColor; label: string; swatch: string }[] = [
  { value: "default", label: "Default", swatch: "oklch(0.534 0.288 293)" },
  { value: "blue", label: "Blue", swatch: "oklch(0.55 0.2 260)" },
  { value: "red", label: "Red", swatch: "oklch(0.55 0.22 10)" },
  { value: "green", label: "Green", swatch: "oklch(0.55 0.17 145)" },
  { value: "yellow", label: "Yellow", swatch: "oklch(0.58 0.15 82)" },
  // Swatch tracks --foreground (not a fixed color) — this accent has no
  // single hue: it's black in light mode, white in dark mode, so the dot
  // itself flips with the current theme same as the real accent would.
  { value: "mono", label: "Monochrome", swatch: "var(--foreground)" },
]

export function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  const { accent, setAccent } = useAccentColor()

  return (
    <div className="max-w-3xl space-y-6">
      <SettingsCard icon={Palette} title="Appearance" description="A personal preference stored on this device only.">
        <div className="max-w-lg space-y-6">
            <div className="space-y-2">
              <Label>Theme</Label>
              <Select value={theme ?? "system"} onValueChange={setTheme}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Primary color</Label>
              <Select value={accent} onValueChange={(v) => setAccent(v as AccentColor)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCENT_COLOR_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: opt.swatch }}
                        />
                        {opt.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
        </div>
      </SettingsCard>
    </div>
  )
}
