"use client";

import { createCmsAuthClient } from "@repo/auth/client";

/** Pages handle the 2FA redirect themselves (see app/login/page.tsx). */
export const authClient = createCmsAuthClient();
