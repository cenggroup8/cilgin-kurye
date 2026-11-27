const VOLUME = 0.36;

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
  private sampleUrl: string | null = null;
  private muted = false;
  private time = 0;

  get isMuted(): boolean {
    return this.muted;
  }

  get usingSample(): boolean {
    return this.sample !== null;
  }

  useSample(url: string): void {
    this.sampleUrl = url;
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
    if (this.sampleUrl) void this.loadSample();
  }

  private async loadSample(): Promise<void> {
    if (!this.ctx || !this.sampleUrl || this.sample) return;
    try {
      const res = await fetch(this.sampleUrl);
      if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio")) return;
      const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.master);
      source.start();
      this.sample = { source, gain };
      this.body.gain.cancelScheduledValues(this.ctx.currentTime);
      this.body.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    } catch {
      this.sample = null;
    }
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
