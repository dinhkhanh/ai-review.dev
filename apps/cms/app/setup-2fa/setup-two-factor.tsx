"use client";

import { Button } from "@repo/ui/button";
import { Input, Label } from "@repo/ui/input";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import QRCode from "react-qr-code";
import { FormError } from "../../components/auth-card";
import { authClient } from "../../lib/auth-client";

type Stage = { step: "password" } | { step: "verify"; totpURI: string; backupCodes: string[] };

export function SetupTwoFactor() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ step: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const password = String(new FormData(e.currentTarget).get("password"));
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || data.method !== "totp") {
      setError(error?.message ?? "Could not start 2FA setup");
      return;
    }
    setStage({ step: "verify", totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s+/g, "");
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) {
      setError(error.message ?? "Invalid code");
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (stage.step === "password") {
    return (
      <form onSubmit={onPassword} className="space-y-4">
        <div>
          <Label htmlFor="password">Confirm your password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Preparing…" : "Continue"}
        </Button>
        <FormError message={error} />
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
        <li>Scan this QR code with an authenticator app (1Password, Authy, Google Authenticator).</li>
        <li>Store the backup codes somewhere safe. Each works once.</li>
        <li>Enter the 6-digit code to finish.</li>
      </ol>
      <div className="flex justify-center rounded-md bg-white p-4">
        <QRCode value={stage.totpURI} size={176} />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Can't scan? Show setup key</summary>
        <code className="mt-2 block break-all rounded bg-surface p-2 text-xs">
          {new URL(stage.totpURI).searchParams.get("secret")}
        </code>
      </details>
      <div>
        <p className="text-sm font-medium">Backup codes</p>
        <ul className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-surface p-3 font-mono text-xs">
          {stage.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <form onSubmit={onVerify} className="space-y-4">
        <div>
          <Label htmlFor="code">Authentication code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Verifying…" : "Enable two-factor"}
        </Button>
        <FormError message={error} />
      </form>
    </div>
  );
}
