import { useEffect, useState } from "react"
import { Copy, Download, ShieldCheck } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { TotpCodeInput } from "@/components/TotpCodeInput"
import {
  useDisableTwoFactor,
  useEnableTwoFactor,
  useRegenerateRecoveryCodes,
  useStartTwoFactorSetup,
  useTwoFactorStatus,
} from "@/hooks/useTwoFactor"

// Warn when this few recovery codes are left.
const LOW_RECOVERY_CODES = 2

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error("Couldn't copy — select the text and copy it manually")
  }
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function TwoFactorCard() {
  const { data: status, isLoading, isError } = useTwoFactorStatus()
  const [enableOpen, setEnableOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [regenerateOpen, setRegenerateOpen] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Two-factor authentication
          {status && <Badge variant={status.enabled ? "success" : "secondary"}>{status.enabled ? "Enabled" : "Off"}</Badge>}
        </CardTitle>
        <CardDescription>
          Ask for a code from an authenticator app (Google Authenticator, Aegis, 1Password…) after your password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <Skeleton className="h-9 w-full" />}
        {isError && <p className="text-sm text-destructive">Couldn't load the two-factor status.</p>}
        {status && !status.enabled && (
          <Button onClick={() => setEnableOpen(true)}>
            <ShieldCheck className="h-4 w-4" />
            Enable
          </Button>
        )}
        {status?.enabled && (
          <>
            <p className="text-sm">
              Recovery codes left:{" "}
              <Badge variant={status.recoveryCodesRemaining <= LOW_RECOVERY_CODES ? "warning" : "secondary"}>
                {status.recoveryCodesRemaining}
              </Badge>
            </p>
            {status.recoveryCodesRemaining <= LOW_RECOVERY_CODES && (
              <p className="text-sm text-warning">
                You're running low on recovery codes. Generate a new set before you lose access to your authenticator.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setRegenerateOpen(true)}>
                Regenerate recovery codes
              </Button>
              <Button variant="outline" onClick={() => setDisableOpen(true)}>
                Disable
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <EnableDialog open={enableOpen} onClose={() => setEnableOpen(false)} />
      <DisableDialog open={disableOpen} onClose={() => setDisableOpen(false)} />
      <RegenerateDialog open={regenerateOpen} onClose={() => setRegenerateOpen(false)} />
    </Card>
  )
}

// Shown once after enabling / regenerating: the only time the codes exist in the clear. The dialog
// can't be closed until the user confirms they've saved them.
function RecoveryCodesView({ codes, saved, onSavedChange }: { codes: string[]; saved: boolean; onSavedChange: (v: boolean) => void }) {
  const text = codes.join("\n")
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Keep these somewhere safe. Each code works once, if you lose your authenticator. They won't be shown again.
      </p>
      <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3 font-mono text-sm" data-testid="recovery-codes">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => copyText(text, "Recovery codes")}>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </Button>
        <Button variant="outline" size="sm" onClick={() => downloadText("packrat-recovery-codes.txt", text + "\n")}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="codes-saved" checked={saved} onCheckedChange={(v) => onSavedChange(v === true)} />
        <Label htmlFor="codes-saved">I've saved these codes</Label>
      </div>
    </div>
  )
}

function EnableDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setup = useStartTwoFactorSetup()
  const enable = useEnableTwoFactor()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [code, setCode] = useState("")
  const [codes, setCodes] = useState<string[]>([])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep(1)
    setCode("")
    setCodes([])
    setSaved(false)
    setup.mutate(undefined, { onError: (err) => toast.error(err.message) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per opening
  }, [open])

  const secret = setup.data?.secret ?? ""
  const grouped = secret.match(/.{1,4}/g)?.join(" ") ?? ""

  const confirm = () => {
    if (code.length !== 6) return
    enable.mutate(code, {
      onSuccess: (recovery) => {
        setCodes(recovery)
        setStep(3)
      },
      onError: (err) => {
        toast.error(err.message)
        setCode("")
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && step === 3 && !saved) return
        if (!o) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={step !== 3}>
        <DialogHeader>
          <DialogTitle>Enable two-factor authentication · Step {step} of 3</DialogTitle>
          <DialogDescription>
            {step === 1 && "Scan the QR code with your authenticator app."}
            {step === 2 && "Type the 6-digit code your app shows now to confirm it works."}
            {step === 3 && "Two-factor authentication is on."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            {setup.data ? (
              <>
                {/* Always dark-on-white with a quiet zone, even in dark mode: scanners need the contrast.
                    The literal colors are deliberate — this is not themeable UI. */}
                <div className="mx-auto w-fit rounded-md bg-white p-3" data-testid="qr-tile">
                  <QRCodeSVG value={setup.data.otpauthUrl} size={176} level="M" marginSize={4} bgColor="#ffffff" fgColor="#000000" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Can't scan? Enter this key:</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 font-mono text-sm break-all" data-testid="secret-text">
                      {grouped}
                    </code>
                    <Button variant="outline" size="icon" aria-label="Copy key" onClick={() => copyText(secret, "Key")}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <Skeleton className="mx-auto h-48 w-48" />
            )}
            <DialogFooter>
              <Button onClick={() => setStep(2)} disabled={!setup.data}>
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="enable-code">Authentication code</Label>
              <TotpCodeInput id="enable-code" value={code} onChange={setCode} onEnter={confirm} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={confirm} disabled={code.length !== 6 || enable.isPending}>
                {enable.isPending ? "Checking…" : "Verify and enable"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <RecoveryCodesView codes={codes} saved={saved} onSavedChange={setSaved} />
            <DialogFooter>
              <Button onClick={onClose} disabled={!saved}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DisableDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const disable = useDisableTwoFactor()
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [useRecovery, setUseRecovery] = useState(false)

  useEffect(() => {
    if (open) {
      setPassword("")
      setCode("")
      setUseRecovery(false)
    }
  }, [open])

  const ready = password.length > 0 && (useRecovery ? code.trim().length >= 8 : code.length === 6)

  const submit = () => {
    if (!ready) return
    disable.mutate(useRecovery ? { password, recoveryCode: code.trim() } : { password, code }, {
      onSuccess: () => {
        toast.success("Two-factor authentication disabled")
        onClose()
      },
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disable two-factor authentication</DialogTitle>
          <DialogDescription>Confirm with your password and a current code. Your recovery codes will be deleted.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="disable-password">Password</Label>
            <Input id="disable-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
          <CodeField id="disable-code" useRecovery={useRecovery} code={code} setCode={setCode} onEnter={submit} />
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => {
              setUseRecovery((v) => !v)
              setCode("")
            }}
          >
            {useRecovery ? "Use an authenticator code" : "Use a recovery code"}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={!ready || disable.isPending}>
            {disable.isPending ? "Disabling…" : "Disable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RegenerateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const regenerate = useRegenerateRecoveryCodes()
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [codes, setCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      setPassword("")
      setCode("")
      setCodes(null)
      setSaved(false)
    }
  }, [open])

  const ready = password.length > 0 && code.length === 6

  const submit = () => {
    if (!ready) return
    regenerate.mutate(
      { password, code },
      {
        onSuccess: (fresh) => setCodes(fresh),
        onError: (err) => {
          toast.error(err.message)
          setCode("")
        },
      },
    )
  }

  const showingCodes = codes !== null
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && showingCodes && !saved) return
        if (!o) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!showingCodes}>
        <DialogHeader>
          <DialogTitle>Regenerate recovery codes</DialogTitle>
          <DialogDescription>
            {showingCodes ? "Your old recovery codes no longer work." : "This replaces all your current recovery codes."}
          </DialogDescription>
        </DialogHeader>
        {showingCodes ? (
          <>
            <RecoveryCodesView codes={codes} saved={saved} onSavedChange={setSaved} />
            <DialogFooter>
              <Button onClick={onClose} disabled={!saved}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="regen-password">Password</Label>
                <Input id="regen-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              </div>
              <CodeField id="regen-code" useRecovery={false} code={code} setCode={setCode} onEnter={submit} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!ready || regenerate.isPending}>
                {regenerate.isPending ? "Working…" : "Generate new codes"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CodeField({
  id,
  useRecovery,
  code,
  setCode,
  onEnter,
}: {
  id: string
  useRecovery: boolean
  code: string
  setCode: (v: string) => void
  onEnter: () => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{useRecovery ? "Recovery code" : "Authentication code"}</Label>
      {useRecovery ? (
        <Input
          id={id}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter()}
          autoComplete="off"
          placeholder="XXXX-XXXX"
          className="font-mono"
        />
      ) : (
        <TotpCodeInput id={id} value={code} onChange={setCode} onEnter={onEnter} autoFocus={false} />
      )}
    </div>
  )
}
