import type { CostHandler } from "../cost-event";

/** One spoken word with its position in the audio (FR-VID-2), used for captions and scene timing. */
export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SpeechResult {
  /** MP3 bytes (44.1 kHz, 128 kbps CBR). */
  audio: Buffer;
  mimeType: "audio/mpeg";
  words: WordTiming[];
  durationMs: number;
  voiceId: string;
  characters: number;
}

/** TTS adapter (SRS §4.2). Word timings are required: captions and scene cuts depend on them. */
export interface Tts {
  provider: string;
  synthesize(text: string, opts?: { voiceId?: string | null }): Promise<SpeechResult>;
}

export interface ElevenLabsOptions {
  apiKey?: string;
  /** Default voice ("Adam", a neutral narrator in the ElevenLabs library). */
  voiceId?: string;
  model?: string;
  onCost?: CostHandler;
  fetchImpl?: typeof fetch;
  /** Request size limit; longer text is split at sentence boundaries and the audio concatenated. */
  maxCharsPerRequest?: number;
  /** Cost meta copied onto every ledger row (e.g. { videoId, articleId }). */
  meta?: Record<string, unknown>;
}

export const ELEVENLABS_DEFAULT_VOICE = "pNInz6obpgDQGcFmaJgB";
export const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";
/** USD per character (Creator plan: 100k characters for $22, 2026-10). */
export const ELEVENLABS_USD_PER_CHAR = 0.00022;
/** mp3_44100_128 is constant bitrate, so byte length gives the exact duration of a chunk. */
const MP3_BITS_PER_SECOND = 128_000;
const OUTPUT_FORMAT = "mp3_44100_128";

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Groups character-level alignment into words (whitespace-separated), offset by `offsetMs`. */
export function wordsFromAlignment(alignment: Alignment, offsetMs = 0): WordTiming[] {
  const words: WordTiming[] = [];
  let current: WordTiming | null = null;
  alignment.characters.forEach((ch, i) => {
    const start = Math.round((alignment.character_start_times_seconds[i] ?? 0) * 1000) + offsetMs;
    const end = Math.round((alignment.character_end_times_seconds[i] ?? 0) * 1000) + offsetMs;
    if (/\s/.test(ch)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    if (!current) current = { word: ch, startMs: start, endMs: end };
    else {
      current.word += ch;
      current.endMs = end;
    }
  });
  if (current) words.push(current);
  return words;
}

/** Splits text into chunks of at most `max` characters, preferring sentence then word boundaries. */
export function splitForTts(text: string, max: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [clean];
  const chunks: string[] = [];
  let buf = "";
  const push = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = "";
  };
  for (const sentence of sentences) {
    if ((buf + sentence).length <= max) {
      buf += sentence;
      continue;
    }
    push();
    if (sentence.length <= max) {
      buf = sentence;
      continue;
    }
    for (const word of sentence.split(" ")) {
      if ((buf + " " + word).trim().length > max) push();
      buf = buf ? `${buf} ${word}` : word;
    }
  }
  push();
  return chunks;
}

/**
 * ElevenLabs `with-timestamps` TTS. The whole narration is synthesised as one text (split only
 * when it exceeds the request limit, passing neighbouring text for continuous prosody), so the
 * voice sounds like one take and scene boundaries come from word timings rather than per-scene
 * clips with audible resets. Returns null when no API key is configured.
 */
export function createElevenLabsTts(options: ElevenLabsOptions = {}): Tts | null {
  const apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? ELEVENLABS_DEFAULT_MODEL;
  const maxChars = options.maxCharsPerRequest ?? 4500;

  return {
    provider: "elevenlabs",
    async synthesize(text, opts = {}) {
      const voiceId = opts.voiceId || options.voiceId || ELEVENLABS_DEFAULT_VOICE;
      const chunks = splitForTts(text, maxChars);
      if (chunks.length === 0) throw new Error("Nothing to synthesise");
      const audio: Buffer[] = [];
      const words: WordTiming[] = [];
      let offsetMs = 0;
      for (let i = 0; i < chunks.length; i++) {
        const res = await fetchImpl(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
          {
            method: "POST",
            headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              text: chunks[i],
              model_id: model,
              ...(i > 0 ? { previous_text: chunks[i - 1] } : {}),
              ...(i < chunks.length - 1 ? { next_text: chunks[i + 1] } : {}),
            }),
            signal: AbortSignal.timeout(180_000),
          },
        );
        if (!res.ok) throw new Error(`ElevenLabs TTS failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
        const body = (await res.json()) as { audio_base64: string; alignment: Alignment | null };
        const bytes = Buffer.from(body.audio_base64, "base64");
        if (body.alignment) words.push(...wordsFromAlignment(body.alignment, offsetMs));
        audio.push(bytes);
        offsetMs += Math.round((bytes.length * 8 * 1000) / MP3_BITS_PER_SECOND);
        await options.onCost?.({
          provider: "elevenlabs",
          model,
          operation: "tts",
          units: chunks[i]!.length,
          unitType: "characters",
          costUsd: chunks[i]!.length * ELEVENLABS_USD_PER_CHAR,
          meta: { voiceId, chunk: i, ...options.meta },
        });
      }
      return {
        audio: Buffer.concat(audio),
        mimeType: "audio/mpeg",
        words,
        durationMs: offsetMs,
        voiceId,
        characters: chunks.reduce((n, c) => n + c.length, 0),
      };
    },
  };
}
