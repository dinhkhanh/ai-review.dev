import { localePath } from "@repo/content";
import Link from "next/link";
import { getMessages } from "../../lib/i18n";

export default async function NotFound() {
  const t = await getMessages();
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 className="text-3xl font-bold">{t.notFound.title}</h1>
      <p className="mt-3 text-muted">{t.notFound.body}</p>
      <Link href={localePath(t.locale, "/")} className="mt-6 inline-block text-brand underline">
        {t.notFound.back}
      </Link>
    </div>
  );
}
