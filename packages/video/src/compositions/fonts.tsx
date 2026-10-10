/** @jsxRuntime automatic */
import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";

export interface FontUrls {
  regular: string;
  bold: string;
}

/** Loads Inter into the page before the first frame renders (Linux render hosts have few fonts). */
export function useBrandFont(fonts: FontUrls | null): string | null {
  const [handle] = useState(() => (fonts ? delayRender("Loading brand font") : null));
  useEffect(() => {
    if (!fonts || handle === null) return;
    const faces = [
      new FontFace("BrandInter", `url(${fonts.regular})`, { weight: "400" }),
      new FontFace("BrandInter", `url(${fonts.bold})`, { weight: "700" }),
    ];
    Promise.all(faces.map((f) => f.load()))
      .then((list) => list.forEach((f) => document.fonts.add(f)))
      .catch((error) => console.warn("Brand font failed to load", error))
      .finally(() => continueRender(handle));
  }, [fonts, handle]);
  return fonts ? "BrandInter" : null;
}
