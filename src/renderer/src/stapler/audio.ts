import { STAPLER_SAMPLE_RATE } from '@shared/stapler';

/** A browser recording decoded to the mono 16 kHz samples Whisper expects. */
export async function decodeToSamples(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const probe = new AudioContext();
  try {
    const decoded = await probe.decodeAudioData(bytes);
    const frames = Math.ceil(decoded.duration * STAPLER_SAMPLE_RATE);
    if (frames === 0) return new Float32Array(0);
    const offline = new OfflineAudioContext(1, frames, STAPLER_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    void probe.close();
  }
}

/** Below this peak the clip is silence, so the model isn't asked to imagine words. */
export const hasSound = (samples: Float32Array): boolean => samples.some((v) => Math.abs(v) > 0.01);

/**
 * Records one stream as a run of complete clips. Each MediaRecorder chunk after the
 * first isn't decodable alone, so the recorder restarts for every clip.
 */
export class ClipRecorder {
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private clipStart = 0;
  private lastClip: Promise<void> = Promise.resolve();

  constructor(
    private readonly stream: MediaStream,
    private readonly clipMs: number,
    private readonly onClip: (blob: Blob, startedAt: number) => Promise<void> | void
  ) {}

  start(): void { this.next(); }

  private next(): void {
    if (this.stopped) return;
    const parts: Blob[] = [];
    const recorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
    this.recorder = recorder;
    this.clipStart = Date.now();
    const startedAt = this.clipStart;
    const finished = new Promise<void>((resolve) => {
      recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      recorder.onstop = () => {
        if (parts.length) void Promise.resolve(this.onClip(new Blob(parts, { type: 'audio/webm' }), startedAt)).finally(resolve);
        else resolve();
      };
    });
    this.lastClip = this.lastClip.then(() => finished);
    recorder.start();
    this.timer = setTimeout(() => { recorder.stop(); this.next(); }, this.clipMs);
  }

  /** Ends recording and waits for every clip to be handled. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    await this.lastClip;
    this.stream.getTracks().forEach((t) => t.stop());
  }
}
