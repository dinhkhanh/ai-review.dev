import { notFound } from "next/navigation";

/** Unmatched URLs render the locale's not-found page inside its layout (header, footer, language). */
export default function CatchAll() {
  notFound();
}
