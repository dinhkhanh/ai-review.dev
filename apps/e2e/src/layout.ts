import { expect, type Page } from "@playwright/test";

/**
 * Elements that reach past the viewport's right or left edge without a scrolling or clipping
 * ancestor to contain them — anything listed makes the whole page scroll sideways on a phone.
 */
export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const contained = (el: Element) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || (box.right <= vw + 1 && box.left >= -1) || contained(el)) continue;
      const cls = typeof el.className === "string" ? el.className.slice(0, 60) : "";
      offenders.push(`<${el.tagName.toLowerCase()} class="${cls}"> ${Math.round(box.left)}–${Math.round(box.right)}px`);
    }
    return offenders.slice(0, 3);
  });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  // Soft, so one run lists every screen that overflows rather than stopping at the first.
  expect.soft(await horizontalOverflow(page), `${page.url()} overflows a ${width}px viewport`).toEqual([]);
}
