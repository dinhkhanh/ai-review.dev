"use client";

import { Button, type ButtonProps } from "@repo/ui/button";
import { useFormStatus } from "react-dom";

/** Submit button that disables itself while its form's server action runs. */
export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}
