/**
 * audio.js — Engine Sounds, Collision Sounds, Ambient
 *
 * Uses the Web Audio API directly (no Three.js PositionalAudio dependency).
 * Engine sound is a synthesised tone whose pitch and volume scale with speed.
 * Ambient wind increases at high speeds.
 * All audio is created lazily on first user interaction to satisfy browser
 * autoplay policies.
 */

export class AudioManager {
  constructor(camera) {
    this.camera = camera;
    this.ctx = null;
    this.masterGain = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.windGain = null;
    this.ambientSource = null;

    this.started = false;
    this.muted = false;

    // Listen for first user interaction to unlock AudioContext
    const unlock = () => {
      if (!this.ctx) this._init();
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
    document.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('click', unlock, { once: true });
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  _init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      console.warn('[Audio] Web Audio API not supported');
      return;
    }

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.4;
    this.masterGain.connect(this.ctx.destination);

    this._buildEngine();
    this._buildWind();
    this._buildAmbient();
  }

  _buildEngine() {
    if (!this.ctx) return;

    // Two detuned oscillators for a richer engine sound
    this.engineOsc = [];
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.masterGain);

    const distortion = this.ctx.createWaveShaper();
    distortion.curve = makeDistortionCurve(80);
    distortion.oversample = '4x';
    this.engineGain.connect(distortion);
    distortion.connect(this.masterGain);

    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 60 + i * 3; // slightly detuned
      osc.connect(this.engineGain);
      osc.start();
      this.engineOsc.push(osc);
    }
  }

  _buildWind() {
    if (!this.ctx) return;

    // White noise for wind
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 0.5;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;

    source.connect(filter);
    filter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    source.start();
  }

  _buildAmbient() {
    if (!this.ctx) return;

    // Subtle drone for atmosphere
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 55;

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 0.04;

    osc.connect(gainNode);
    gainNode.connect(this.masterGain);
    osc.start();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start() {
    if (!this.ctx) this._init();
    this.started = true;
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /**
   * Called every frame from the game loop.
   * @param {number} speedKmh - Current vehicle speed in km/h
   * @param {number} delta    - Seconds since last frame
   */
  update(speedKmh, delta) {
    if (!this.ctx || !this.started || this.muted) return;

    const t = this.ctx.currentTime;
    const speed01 = Math.min(speedKmh / 180, 1); // normalise to 0..1

    // Engine pitch: 60–220 Hz
    const targetFreq = 60 + speed01 * 160;
    if (this.engineOsc) {
      for (let i = 0; i < this.engineOsc.length; i++) {
        this.engineOsc[i].frequency.setTargetAtTime(targetFreq + i * 3, t, 0.05);
      }
    }

    // Engine volume: quiet idle, loud at speed
    const engineVol = 0.05 + speed01 * 0.35;
    if (this.engineGain) {
      this.engineGain.gain.setTargetAtTime(engineVol, t, 0.1);
    }

    // Wind volume: only above ~60 km/h
    const windVol = Math.max(0, (speed01 - 0.33) * 0.3);
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(windVol, t, 0.15);
    }
  }

  /** Play a short collision thud. */
  playCollision(intensity = 1.0) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 80 * intensity;
    gain.gain.setValueAtTime(0.5 * Math.min(intensity, 1), this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  /** Toggle master mute. */
  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : 0.4;
    }
    return this.muted;
  }

  setVolume(v) {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(1, v)) * 0.4;
  }

  dispose() {
    try { this.ctx?.close(); } catch (_) {}
  }
}

// ── Wave shaper distortion curve ──────────────────────────────────────────────

function makeDistortionCurve(amount) {
  const samples = 256;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
