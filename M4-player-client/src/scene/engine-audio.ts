const VOLUME = 0.36;
const SEAM_S = 0.015;

export function crossfadeLoop(input: Float32Array, fade: number): Float32Array<ArrayBuffer> {
  const f = Math.min(fade, Math.floor(input.length / 3));
  const out = new Float32Array(input.length - f);
  out.set(input.subarray(0, input.length - f));
  for (let i = 0; i < f; i++) {
    const k = i / f;
    out[i] = input[i] * k + input[input.length - f + i] * (1 - k);
  }
  return out;
}

function seamless(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const fade = Math.floor(buffer.sampleRate * SEAM_S);
  const first = crossfadeLoop(buffer.getChannelData(0), fade);
  const out = ctx.createBuffer(buffer.numberOfChannels, first.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.copyToChannel(ch === 0 ? first : crossfadeLoop(buffer.getChannelData(ch), fade), ch);
  }
  return out;
}

export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private body!: GainNode;
  private filter!: BiquadFilterNode;
  private saw!: OscillatorNode;
  private sub!: OscillatorNode;
  private pulse!: OscillatorNode;
  private pulseDepth!: GainNode;
  private sample: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private sampleUrls: string[] = [];
  private squealUrl: string | null = null;
  private squeal: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private muted = false;
  private time = 0;

  get isMuted(): boolean {
    return this.muted;
  }

  get usingSample(): boolean {
    return this.sample !== null;
  }

  useSample(...urls: string[]): void {
    this.sampleUrls = urls;
    if (this.ctx) void this.loadSample();
  }

  start(): void {
    if (this.ctx) {
      if (this.ctx.state !== "running") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : VOLUME;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.7;
    this.filter.frequency.value = 400;
    this.body = ctx.createGain();
    this.body.gain.value = 0.04;
    this.filter.connect(this.body);
    this.body.connect(this.master);

    const voice = (type: OscillatorType, level: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(this.filter);
      o.start();
      return o;
    };
    this.saw = voice("sawtooth", 0.4);
    this.sub = voice("triangle", 0.9);

    this.pulse = ctx.createOscillator();
    this.pulse.type = "sine";
    this.pulseDepth = ctx.createGain();
    this.pulseDepth.gain.value = 0.015;
    this.pulse.connect(this.pulseDepth);
    this.pulseDepth.connect(this.body.gain);
    this.pulse.start();
    if (this.sampleUrls.length) void this.loadSample();
    if (this.squealUrl) void this.loadSqueal();
  }

  private async loadSample(): Promise<void> {
    if (!this.ctx || this.sample) return;
    for (const url of this.sampleUrls) {
      try {
        const res = await fetch(url);
        if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio")) continue;
        const buffer = seamless(this.ctx, await this.ctx.decodeAudioData(await res.arrayBuffer()));
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(this.master);
        source.start();
        this.sample = { source, gain };
        const now = this.ctx.currentTime;
        this.body.gain.cancelScheduledValues(now);
        this.body.gain.setTargetAtTime(0, now, 0.05);
        this.pulseDepth.gain.cancelScheduledValues(now);
        this.pulseDepth.gain.setValueAtTime(0, now);
        this.pulse.stop(now + 0.1);
        return;
      } catch {
        continue;
      }
    }
  }

  useSqueal(url: string): void {
    this.squealUrl = url;
    if (this.ctx) void this.loadSqueal();
  }

  private async loadSqueal(): Promise<void> {
    if (!this.ctx || !this.squealUrl || this.squeal) return;
    try {
      const res = await fetch(this.squealUrl);
      if (!res.ok) return;
      const buffer = seamless(this.ctx, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.master);
      source.start();
      this.squeal = { source, gain };
    } catch {
      this.squeal = null;
    }
  }

  skid(amount: number, speed: number): void {
    if (!this.ctx || !this.squeal) return;
    const t = this.ctx.currentTime;
    const k = Math.max(0, Math.min(1, amount));
    const level = k * k * 0.54;
    this.squeal.gain.gain.setTargetAtTime(level, t, level > this.squeal.gain.gain.value ? 0.04 : 0.16);
    this.squeal.source.playbackRate.setTargetAtTime(0.88 + Math.min(Math.abs(speed), 20) * 0.008 + k * 0.08, t, 0.08);
  }

  update(rpm: number, load: number, dt: number): void {
    if (!this.ctx) return;
    this.time += dt;
    const t = this.ctx.currentTime;
    const wobble = 1 + Math.sin(this.time * 1.7) * 0.012 + Math.sin(this.time * 0.43) * 0.02;
    if (this.sample) {
      this.sample.source.playbackRate.setTargetAtTime((0.6 + rpm * 1.15) * wobble, t, 0.04);
      this.sample.gain.gain.setTargetAtTime(0.55 + load * 0.45, t, 0.08);
      return;
    }
    const base = (30 + rpm * 105) * wobble;
    this.saw.frequency.setTargetAtTime(base, t, 0.04);
    this.sub.frequency.setTargetAtTime(base / 2, t, 0.04);
    this.pulse.frequency.setTargetAtTime(base / 2, t, 0.04);
    this.filter.frequency.setTargetAtTime(260 + rpm * 900 + load * 300, t, 0.06);
    const level = 0.025 + load * 0.035 + rpm * 0.015;
    this.body.gain.setTargetAtTime(level, t, 0.08);
    this.pulseDepth.gain.setTargetAtTime(level * 0.35, t, 0.08);
  }

  shift(): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(VOLUME * 0.45, t + 0.04);
    g.linearRampToValueAtTime(VOLUME, t + 0.18);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0 : VOLUME, t, 0.05);
  }
}
