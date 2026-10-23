import { REGEXP_ONLY_DIGITS } from "input-otp"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"

const TOTP_LENGTH = 6

// The 6-digit authenticator code as separated digit boxes. Digits only, paste of the whole code
// works, and the browser/OS can offer one-time-code autofill. `onComplete` fires when the last
// digit is filled (typed or pasted).
export function TotpCodeInput({
  id,
  value,
  onChange,
  onComplete,
  onEnter,
  autoFocus = true,
  disabled,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  onEnter?: () => void
  autoFocus?: boolean
  disabled?: boolean
}) {
  return (
    <InputOTP
      id={id}
      maxLength={TOTP_LENGTH}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      containerClassName="w-full"
      disabled={disabled}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
    >
      <InputOTPGroup className="w-full">
        {Array.from({ length: TOTP_LENGTH }, (_, i) => (
          <InputOTPSlot key={i} index={i} className="h-11 flex-1 text-lg" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  )
}
