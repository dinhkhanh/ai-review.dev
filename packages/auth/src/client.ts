"use client";

import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser auth client for the CMS. Same-origin, so no baseURL is needed. */
export function createCmsAuthClient(opts: { onTwoFactorRedirect?: () => void } = {}) {
  return createAuthClient({
    plugins: [twoFactorClient({ onTwoFactorRedirect: opts.onTwoFactorRedirect }), adminClient()],
  });
}

export type CmsAuthClient = ReturnType<typeof createCmsAuthClient>;
