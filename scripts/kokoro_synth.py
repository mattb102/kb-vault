#!/usr/bin/env python3
"""
Kokoro TTS synthesis helper.
Reads text from stdin, writes WAV bytes to stdout.
Chunks on sentence boundaries so the model never sees more than ~500 chars
in a single call (avoids instability with very long inputs).

Required env vars:
  KOKORO_MODEL_PATH   -- path to kokoro-v1.0.onnx
  KOKORO_VOICES_PATH  -- path to voices-v1.0.bin (defaults to same dir as model)

Optional env vars:
  KOKORO_VOICE  -- voice name (default: af_heart)
  KOKORO_SPEED  -- playback speed (default: 1.0)
"""
import sys
import os
import re
import io
import wave
import numpy as np

MODEL_PATH  = os.environ.get("KOKORO_MODEL_PATH", "")
VOICES_PATH = os.environ.get("KOKORO_VOICES_PATH", "")
VOICE       = os.environ.get("KOKORO_VOICE", "af_heart")
SPEED       = float(os.environ.get("KOKORO_SPEED", "1.0"))
MAX_CHUNK   = 500

if not MODEL_PATH:
    sys.stderr.write("kokoro_synth: KOKORO_MODEL_PATH env var is required\n")
    sys.exit(1)

if not VOICES_PATH:
    # Default: voices file in the same directory as the model
    VOICES_PATH = os.path.join(os.path.dirname(MODEL_PATH), "voices-v1.0.bin")


def chunk_text(text: str) -> list:
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks, cur = [], ""
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if cur and len(cur) + 1 + len(s) > MAX_CHUNK:
            chunks.append(cur)
            cur = s
        else:
            cur = (cur + " " + s).strip() if cur else s
    if cur:
        chunks.append(cur)
    return chunks or [text]


def main():
    text = sys.stdin.read().strip()
    if not text:
        sys.stderr.write("kokoro_synth: empty input\n")
        sys.exit(1)

    from kokoro_onnx import Kokoro
    kokoro = Kokoro(MODEL_PATH, VOICES_PATH)

    chunks = chunk_text(text)
    sys.stderr.write(f"kokoro_synth: {len(chunks)} chunk(s) for {len(text)} chars\n")
    sys.stderr.flush()

    all_samples = []
    sample_rate = 24000
    for i, chunk in enumerate(chunks):
        samples, sr = kokoro.create(chunk, voice=VOICE, speed=SPEED, lang="en-us")
        sample_rate = sr
        all_samples.append(samples)
        sys.stderr.write(f"  chunk {i+1}/{len(chunks)}: {len(chunk)} chars -> {len(samples)/sr:.2f}s audio\n")
        sys.stderr.flush()

    combined = np.concatenate(all_samples) if all_samples else np.array([], dtype=np.float32)

    buf = io.BytesIO()
    with wave.open(buf, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        pcm = (combined * 32767).clip(-32768, 32767).astype(np.int16)
        wf.writeframes(pcm.tobytes())

    sys.stdout.buffer.write(buf.getvalue())


if __name__ == "__main__":
    main()
