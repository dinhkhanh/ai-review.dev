"use client";

import { Button } from "@repo/ui/button";
import { Input, Label } from "@repo/ui/input";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard, FormError } from "../../components/auth-card";
import { authClient } from "../../lib/auth-client";

export default function TwoFactorPage() {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const code = String(form.get("code")).replace(/\s+/g, "");
    const trustDevice = form.get("trust") === "on";
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setPending(false);
    if (error) {
      setError(error.message ?? "Invalid code");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <AuthCard
      title="Two-factor authentication"
      subtitle={useBackup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app."}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="code">{useBackup ? "Backup code" : "Authentication code"}</Label>
          <Input
            id="code"
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={useBackup ? "text" : "numeric"}
            pattern={useBackup ? undefined : "[0-9 ]{6,7}"}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="trust" /> Trust this device for 30 days
        </label>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Verifying…" : "Verify"}
        </Button>
        <button
          type="button"
          className="w-full text-center text-sm text-brand underline"
          onClick={() => setUseBackup((v) => !v)}
        >
          {useBackup ? "Use authenticator code instead" : "Use a backup code"}
        </button>
        <FormError message={error} />
      </form>
    </AuthCard>
  );
}
