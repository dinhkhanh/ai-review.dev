/** Header search (FR-WEB-7): a plain GET form, so it works without JavaScript. */
export function SearchBox({ action, label, placeholder }: { action: string; label: string; placeholder: string }) {
  return (
    <form action={action} method="get" role="search" className="hidden sm:block">
      <label htmlFor="site-search" className="sr-only">
        {label}
      </label>
      <input
        id="site-search"
        name="q"
        type="search"
        placeholder={placeholder}
        maxLength={200}
        className="h-9 w-44 rounded-md border border-border bg-bg px-3 text-sm lg:w-56"
      />
    </form>
  );
}
