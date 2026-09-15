/**
 * Procedural sound effects.
 *
 * Every sound is synthesised with the Web Audio API at play time — there are no
 * audio files, which keeps the whole app self-contained and offline. The wooden
 * knocks are short filtered-noise bursts mixed with a tuned body resonance;
 * using noise rather than a sine is what makes them read as wood on wood.
 *
 * The context is created lazily on the first user gesture because browsers block
 * audio until the user has interacted with the page.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.65;
    this.noiseBuffer = null;
  }

  /** Must be called from a user gesture (click/keydown) to satisfy autoplay rules. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;

    // A gentle high-shelf cut keeps the clicks from sounding harsh.
    const shelf = this.ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 5200;
    shelf.gain.value = -6;
    this.master.connect(shelf);
    shelf.connect(this.ctx.destination);

    this.noiseBuffer = this.makeNoiseBuffer(0.5);
  }

  makeNoiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.02);
    }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.enabled) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  /** Short noise burst through a bandpass, with an exponential decay. */
  knock({ freq = 320, q = 1.6, gain = 0.5, decay = 0.085, body = 180 } = {}) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1;

    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq;
    band.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);

    src.connect(band);
    band.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + decay + 0.02);

    // Body resonance: a very short sine thump gives the knock some weight.
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(body, t);
    osc.frequency.exponentialRampToValueAtTime(body * 0.62, t + decay * 1.4);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(gain * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + decay * 1.6);
    osc.connect(og);
    og.connect(this.master);
    osc.start(t);
    osc.stop(t + decay * 1.8);
  }

  /** A piece landing on a square. Pitch varies a little so repeats do not drone. */
  playMove() {
    this.knock({ freq: 300 + Math.random() * 90, q: 1.5, gain: 0.42, decay: 0.075, body: 165 + Math.random() * 40 });
  }

  /** A capture: heavier and lower, with a second, later knock for the fall. */
  playCapture() {
    this.knock({ freq: 210 + Math.random() * 60, q: 1.1, gain: 0.6, decay: 0.12, body: 120 });
    setTimeout(() => this.knock({ freq: 150, q: 0.9, gain: 0.35, decay: 0.16, body: 88 }), 55);
  }

  /** Castling: two knocks close together, king then rook. */
  playCastle() {
    this.knock({ freq: 320, q: 1.4, gain: 0.42, decay: 0.07, body: 175 });
    setTimeout(() => this.knock({ freq: 250, q: 1.2, gain: 0.38, decay: 0.09, body: 140 }), 90);
  }

  /** Promotion: a bright rising chime over the placement knock. */
  playPromote() {
    this.knock({ freq: 340, q: 1.5, gain: 0.4, decay: 0.08, body: 190 });
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    [660, 880, 1320].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.10, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t + i * 0.07 + 0.35);
      o.connect(g);
      g.connect(this.master);
      o.start(t + i * 0.07);
      o.stop(t + i * 0.07 + 0.4);
    });
  }

  /** Check: a short, tense two-note stab. */
  playCheck() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 622].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.085, t + i * 0.09 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0005, t + i * 0.09 + 0.30);
      o.connect(g);
      g.connect(this.master);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.34);
    });
  }

  /** Game over: a soft resolving chord for a win, a descending pair for a loss. */
  playGameOver(won) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + 0.08;
    const notes = won ? [523, 659, 784, 1046] : [440, 370, 294];
    notes.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      const start = t + i * 0.13;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.12, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, start + 0.85);
      o.connect(g);
      g.connect(this.master);
      o.start(start);
      o.stop(start + 0.9);
    });
  }

  /** UI tick for buttons and toggles. */
  playUi() {
    this.knock({ freq: 900, q: 3.0, gain: 0.14, decay: 0.035, body: 620 });
  }

  /** Soft rejection buzz for an illegal move attempt. */
  playIllegal() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(96, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.14);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    o.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }
}
