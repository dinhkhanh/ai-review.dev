import type { InputHTMLAttributes, LabelHTMLAttributes } from "react";
import { cn } from "../cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-text placeholder:text-muted focus-visible:outline-2 focus-visible:outline-brand",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium", className)} {...props} />;
}
