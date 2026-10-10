import { createServer } from "node:http";

/**
 * One-time helper for FR-VID-4: gets the YouTube upload refresh token for the channel.
 *   1. Google Cloud console → APIs & Services: enable "YouTube Data API v3"; create an OAuth client
 *      of type "Desktop app"; put its id/secret in .env as YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET.
 *   2. pnpm --filter worker youtube-auth   → open the printed URL, sign in as the channel owner.
 *   3. Copy the printed YOUTUBE_REFRESH_TOKEN into .env.production.local (never commit it).
 * The token is printed once to your terminal only.
 */
const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}/callback`;
const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
consent.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/youtube.upload",
  access_type: "offline",
  prompt: "consent",
}).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  if (url.pathname !== "/callback") return void res.writeHead(404).end();
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end(`Authorisation failed: ${url.searchParams.get("error") ?? "no code"}`);
    return;
  }
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  }).then((r) => r.json() as Promise<{ refresh_token?: string; error?: string }>);
  res.writeHead(200, { "Content-Type": "text/plain" }).end("Done. You can close this tab and return to the terminal.");
  server.close();
  if (!token.refresh_token) {
    console.error(`No refresh token returned (${token.error ?? "unknown error"}). Revoke the app's access and retry.`);
    process.exit(1);
  }
  console.log(`\nYOUTUBE_REFRESH_TOKEN=${token.refresh_token}\n`);
  process.exit(0);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Open this URL and sign in as the YouTube channel owner:\n\n${consent.toString()}\n`);
});
