/**
 * Speech to text on this machine: Whisper through ONNX Runtime, in the main process.
 * The model downloads once on first use and audio never leaves the computer. Calls
 * run one at a time, because a meeting sends clips faster than they may finish and
 * two model runs at once would just compete for the same CPU.
 */
import { pathToFileURL } from 'node:url';
import { MAX_TRANSCRIBE_SAMPLES } from '../shared/stapler';

export const LOCAL_MODELS = {
  standard: 'onnx-community/whisper-base',
  larger: 'onnx-community/whisper-small'
} as const;
export type LocalModel = keyof typeof LOCAL_MODELS;

type Recognizer = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>;

let loaded: { model: LocalModel; run: Recognizer } | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function recognizer(model: LocalModel, cacheDir: string): Promise<Recognizer> {
  if (loaded?.model === model) return loaded.run;
  // A native import, not a bundled one: this package is ESM with native binaries.
  const entry = require.resolve('@huggingface/transformers');
  const { pipeline, env } = await import(/* @vite-ignore */ pathToFileURL(entry).href);
  env.cacheDir = cacheDir;
  const run = await pipeline('automatic-speech-recognition', LOCAL_MODELS[model], { dtype: 'q8', device: 'cpu' }) as unknown as Recognizer;
  loaded = { model, run };
  return run;
}

export function transcribeLocally(audio: Float32Array, model: LocalModel, cacheDir: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const job = queue.then(async () => {
    if (audio.length === 0) return { ok: true as const, text: '' };
    if (audio.length > MAX_TRANSCRIBE_SAMPLES) return { ok: false as const, error: 'clip too long' };
    try {
      const run = await recognizer(model, cacheDir);
      const out = await run(audio, { chunk_length_s: 30, stride_length_s: 5 });
      const text = Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : out.text ?? '';
      return { ok: true as const, text: text.trim() };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
  queue = job.catch(() => undefined);
  return job;
}
