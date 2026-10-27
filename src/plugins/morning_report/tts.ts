/**
 * TTS provider abstraction for the morning report.
 *
 * Default provider: openai (requires OPENAI_API_KEY).
 * Optional provider: kokoro (local ONNX model, no API cost).
 *   Set TTS_PROVIDER=kokoro to use it.
 *   Requires: Python 3 with kokoro-onnx installed, and
 *     KOKORO_MODEL_PATH  -- path to kokoro-v1.0.onnx
 *     KOKORO_VOICES_PATH -- path to voices-v1.0.bin (defaults to same dir as model)
 *   Optional:
 *     KOKORO_PYTHON -- python executable to use (default: python3)
 *     KOKORO_VOICE  -- voice name (default: af_heart)
 */
import OpenAI from "openai";
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TTSProvider {
  readonly name: string;
  synthesize(text: string): Promise<Buffer>;
}

// OpenAI TTS caps input at 4096 chars per request. Split the script into chunks
// under that limit, preferring paragraph boundaries so seams fall on natural pauses.
const MAX_TTS_CHARS = 3800;

export function chunkForTTS(text: string, max = MAX_TTS_CHARS): string[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  const units: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= max) {
      units.push(p);
      continue;
    }
    for (const s of p.split(/(?<=[.!?])\s+/)) {
      if (s.length <= max) {
        units.push(s);
      } else {
        for (let i = 0; i < s.length; i += max) units.push(s.slice(i, i + max));
      }
    }
  }
  const chunks: string[] = [];
  let cur = "";
  for (const u of units) {
    if (cur && cur.length + 2 + u.length > max) {
      chunks.push(cur);
      cur = u;
    } else {
      cur = cur ? `${cur}\n\n${u}` : u;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

class OpenAITTS implements TTSProvider {
  readonly name = "openai";
  private client: OpenAI;
  private voice: string;
  private model: string;

  constructor() {
    this.client = new OpenAI(); // reads OPENAI_API_KEY
    this.voice = process.env.OPENAI_TTS_VOICE || "onyx";
    this.model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  }

  async synthesize(text: string): Promise<Buffer> {
    const chunks = chunkForTTS(text);
    const buffers: Buffer[] = [];
    for (const chunk of chunks) {
      const res = await this.client.audio.speech.create({
        model: this.model,
        voice: this.voice as any,
        input: chunk,
        response_format: "mp3",
        speed: 1.0,
      });
      buffers.push(Buffer.from(await res.arrayBuffer()));
    }
    return Buffer.concat(buffers);
  }
}

// Pipe WAV bytes through ffmpeg -> mono MP3 at 64kbps.
function wavToMp3(wav: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-f", "wav", "-i", "pipe:0",
      "-ac", "1",
      "-b:a", "64k",
      "-f", "mp3", "pipe:1",
      "-loglevel", "error",
    ]);
    const chunks: Buffer[] = [];
    ff.stdout.on("data", (d: Buffer) => chunks.push(d));
    ff.stderr.on("data", (d: Buffer) => process.stderr.write(d));
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}`));
      resolve(Buffer.concat(chunks));
    });
    ff.stdin.write(wav);
    ff.stdin.end();
  });
}

// Kokoro TTS -- local ONNX model, no API cost. Uses kokoro_synth.py in scripts/.
// kokoro_synth.py handles sentence-boundary chunking, so the full text is sent in one call.
class KokoroTTS implements TTSProvider {
  readonly name = "kokoro";
  private readonly python: string;
  private readonly script: string;
  private readonly voice: string;

  constructor() {
    this.python = process.env.KOKORO_PYTHON || "python3";
    // Script lives two levels up from this file (src/plugins/morning_report/ -> scripts/)
    this.script = process.env.KOKORO_SYNTH_SCRIPT || join(__dirname, "../../../../scripts/kokoro_synth.py");
    this.voice = process.env.KOKORO_VOICE || "af_heart";
  }

  async synthesize(text: string): Promise<Buffer> {
    const wav = await this.runSynth(text);
    return wavToMp3(wav);
  }

  private runSynth(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.python, [this.script], {
        env: { ...process.env, KOKORO_VOICE: this.voice },
      });
      const chunks: Buffer[] = [];
      proc.stdout.on("data", (d: Buffer) => chunks.push(d));
      proc.stderr.on("data", (d: Buffer) => process.stderr.write(d));
      proc.on("close", (code) => {
        if (code !== 0) return reject(new Error(`kokoro_synth.py exited ${code}`));
        resolve(Buffer.concat(chunks));
      });
      proc.stdin.write(text, "utf8");
      proc.stdin.end();
    });
  }
}

/**
 * Return the TTS provider configured by TTS_PROVIDER env var.
 * Default: "openai" (requires OPENAI_API_KEY).
 * Opt-in: "kokoro" (requires local Python + kokoro-onnx + model file).
 */
export function getTTSProvider(): TTSProvider {
  const provider = process.env.TTS_PROVIDER || "openai";
  switch (provider) {
    case "openai":
      return new OpenAITTS();
    case "kokoro":
      return new KokoroTTS();
    default:
      throw new Error(`Unknown TTS_PROVIDER: "${provider}" (supported: openai, kokoro)`);
  }
}
