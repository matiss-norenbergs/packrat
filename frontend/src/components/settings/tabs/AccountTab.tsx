import { SessionsCard } from "@/components/settings/SessionsCard"
import { TwoFactorCard } from "@/components/settings/TwoFactorCard"
import { PasswordCard } from "@/components/settings/PasswordCard"

export function AccountTab() {
  return (
    <div className="max-w-3xl space-y-6">
      <SessionsCard />
      <TwoFactorCard />
      <PasswordCard />
    </div>
  )
}
