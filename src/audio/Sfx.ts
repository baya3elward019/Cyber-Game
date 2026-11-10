/** All sounds are synthesized with the Web Audio API (no downloads). Starts only after a user gesture. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private vol = { master: 0.8, sfx: 0.8, ambience: 0.5, muted: false };

  /** Call from a user gesture (click/keydown). Safe to call repeatedly. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.ambBus = this.ctx.createGain();
    this.sfxBus.connect(this.master); this.ambBus.connect(this.master); this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.apply();
    this.startAmbience();
  }

  setVolumes(v: { master: number; sfx: number; ambience: number; muted: boolean }) { this.vol = { ...v }; this.apply(); }

  private apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.muted ? 0 : this.vol.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.ambience * 0.5, t, 0.05);
  }

  private startAmbience() {
    const c = this.ctx!;
    // server-room hum: low tones + filtered noise
    for (const [f, g] of [[50, 0.05], [100, 0.03], [150, 0.012]] as const) {
      const o = c.createOscillator(); o.frequency.value = f;
      const gn = c.createGain(); gn.gain.value = g;
      o.connect(gn).connect(this.ambBus); o.start();
    }
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const gn = c.createGain(); gn.gain.value = 0.06;
    n.connect(lp).connect(gn).connect(this.ambBus); n.start();
  }

  private noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.02);
  }

  step(sprint: boolean) { this.noise(0.09, sprint ? 900 : 700, 1.2, 0.35); }
  key() { this.noise(0.03, 3200, 3, 0.12); }
  door() { this.noise(0.7, 300, 0.7, 0.25, 'lowpass'); this.tone(180, 0.25, 0.05, 'sine'); }
  ui() { this.tone(880, 0.06, 0.06, 'triangle'); }
  objective() { this.tone(660, 0.12, 0.12, 'triangle'); this.tone(990, 0.2, 0.12, 'triangle', 0.1); }
  error() { this.tone(160, 0.22, 0.12, 'square'); }
  complete() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 0.12, 'triangle', i * 0.11)); }
  robot() { [880, 1320, 990].forEach((f, i) => this.tone(f, 0.07, 0.05, 'sine', i * 0.07)); }
  alarm() { this.tone(740, 0.35, 0.09, 'sawtooth'); this.tone(554, 0.35, 0.09, 'sawtooth', 0.38); }
  denied() { this.tone(220, 0.12, 0.08, 'square'); this.tone(180, 0.18, 0.08, 'square', 0.12); }
}
