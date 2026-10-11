import type { Locator, Page } from "@playwright/test";

/**
 * Waits until React has hydrated `target` (it attaches `__reactProps$…` to every host node it owns).
 * Client forms clicked before that fall back to their native submit (CMS sign-in: a GET with the
 * credentials in the URL; the helpful vote: a full-page POST), which is not the flow under test.
 */
export async function hydrated(page: Page, target: Locator | string = "form") {
  const locator = typeof target === "string" ? page.locator(target).first() : target;
  await locator.waitFor();
  await locator.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const ready = () => Object.keys(el).some((k) => k.startsWith("__reactProps"));
        if (ready()) return resolve();
        const timer = setInterval(() => {
          if (ready()) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
      }),
  );
}
