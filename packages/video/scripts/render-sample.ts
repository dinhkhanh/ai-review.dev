import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildTimeline,
  DEFAULT_THEME,
  VIDEO_FPS,
  type CaptionWord,
  type VideoInputProps,
  type VideoKind,
} from "../src/index";
import { renderThumbnails, renderVideo, startAssetServer } from "../src/render";

/**
 * Renders a ~6 s sample (no TTS, synthetic tone + screenshot) to check the toolchain:
 *   pnpm --filter @repo/video render-sample -- <outDir> [short|long]
 */
const outDir = resolve(process.argv[2] ?? "out");
const kind = (process.argv[3] ?? "long") as VideoKind;
await mkdir(outDir, { recursive: true });

function toneWav(seconds: number, hz = 220): Buffer {
  const rate = 22_050;
  const n = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 3000), 44 + i * 2);
  return buf;
}

const screenshot = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#f6f7f9"/><rect width="1600" height="90" fill="#4f46e5"/><text x="60" y="60" font-size="40" fill="#fff" font-family="sans-serif">Example app</text><rect x="60" y="160" width="700" height="300" rx="20" fill="#e3e6eb"/><rect x="840" y="160" width="700" height="300" rx="20" fill="#e3e6eb"/><text x="80" y="600" font-size="56" fill="#0f1720" font-family="sans-serif">Pricing · Features · Docs</text></svg>`,
);

const server = await startAssetServer();
try {
  const narration = [
    "Example is a note taking app for small teams.",
    "Here is the dashboard we captured.",
    "We score it eight point two out of ten.",
    "Plans start free and Pro costs twelve dollars.",
    "It is fast but has few integrations.",
    "Against its rivals it holds up well.",
    "Our verdict: a solid pick.",
    "Read the full review at ai-review.dev.",
  ];
  const words: CaptionWord[] = [];
  let t = 0;
  for (const word of narration.join(" ").split(" ")) {
    words.push({ word, startMs: t, endMs: t + 180 });
    t += 200;
  }
  const visuals = ["title", "screenshot", "score", "pricing", "pros_cons", "comparison", "verdict", "outro"] as const;
  const timeline = buildTimeline(
    narration.map((n, i) => ({
      id: `s${i + 1}`,
      visual: visuals[i]!,
      narration: n,
      onScreenText: [
        "Example review",
        "The dashboard",
        "Great value",
        "Pricing",
        "Pros and cons",
        "How it compares",
        "Verdict",
        "Full review",
      ][i]!,
      imageUrl: visuals[i] === "screenshot" ? server.add("shot.svg", screenshot, "image/svg+xml") : null,
    })),
    words,
    { fps: VIDEO_FPS, tailMs: 800 },
  );
  const props: VideoInputProps = {
    kind,
    theme: DEFAULT_THEME,
    product: { name: "Example", logoUrl: null, category: "Productivity" },
    title: "Example review",
    score: 8.2,
    verdict: { summary: "A solid pick for small teams.", bestFor: ["Small teams"] },
    pricing: [
      { name: "Free", price: 0, currency: "USD", period: "month" },
      { name: "Pro", price: 12, currency: "USD", period: "month" },
      { name: "Enterprise", price: null, currency: "USD", period: "custom" },
    ],
    pros: ["Fast keyboard-first editor", "Generous free plan"],
    cons: ["Few integrations", "No offline mode"],
    comparison: {
      products: ["Example", "Notion", "Coda"],
      rows: [
        { label: "Free plan", values: ["Yes", "Yes", "Yes"] },
        { label: "Paid from", values: ["$12/mo", "$10/mo", "$12/mo"] },
        { label: "Offline", values: ["No", "Partial", "No"] },
      ],
    },
    goUrl: "https://ai-review.dev/reviews/example",
    disclosure: "We may earn a commission if you buy through our links.",
    scenes: timeline.scenes,
    captions: words,
    audioUrl: server.add("voice.wav", toneWav(t / 1000), "audio/wav"),
    musicUrl: null,
    fontUrls: null,
    durationInFrames: timeline.durationInFrames,
  };
  const started = Date.now();
  const video = await renderVideo({ props, outPath: join(outDir, `sample-${kind}.mp4`) });
  const thumbs = await renderThumbnails({ props, outDir });
  console.log(JSON.stringify({ ...video, thumbs, seconds: (Date.now() - started) / 1000 }));
} finally {
  await server.close();
}
