export class AudioManager {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private padOscillators: OscillatorNode[] = [];
  private enabled = false;
  private volume = 0.6;
  private sampleCache = new Map<SampleKey, AudioBuffer>();
  private samplePaths: Record<SampleKey, string> = {
    move: "/audio/move.wav",
    capture: "/audio/capture.wav",
    check: "/audio/check.wav"
  };

  async enable() {
    if (!this.audioContext) {
      this.initContext();
    }
    if (!this.audioContext) return;
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
    await this.loadSamples();
    this.enabled = true;
    if (this.masterGain) this.masterGain.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + 0.2);
    this.startAmbient();
  }

  async disable() {
    if (!this.audioContext || !this.masterGain) return;
    this.enabled = false;
    this.stopAmbient();
    this.masterGain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.2);
  }

  isEnabled() {
    return this.enabled;
  }

  setVolume(value: number) {
    this.volume = value;
    if (this.masterGain && this.audioContext && this.enabled) {
      this.masterGain.gain.linearRampToValueAtTime(value, this.audioContext.currentTime + 0.05);
    }
  }

  playMove(position?: SpatialPosition) {
    const ctx = this.audioContext;
    if (!this.ensureReady()) return;
    const sample = this.sampleCache.get("move");
    if (sample) {
      this.triggerSample(sample, 0.9, position);
      return;
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(392, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(523.25, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.01);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
    const destination = this.buildDestination(position);
    osc.connect(gain).connect(destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  }

  playCapture(position?: SpatialPosition) {
    const ctx = this.audioContext;
    if (!this.ensureReady()) return;
    const sample = this.sampleCache.get("capture");
    if (sample) {
      this.triggerSample(sample, 1.1, position);
      return;
    }
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const decay = Math.pow(1 - t, 2.8);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(0.95 + Math.random() * 0.1, ctx.currentTime);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(160, ctx.currentTime);
    filter.Q.setValueAtTime(1.6, ctx.currentTime);

    const destination = this.buildDestination(position);
    source.connect(filter).connect(gain).connect(destination);
    source.start();
  }

  playCheck(position?: SpatialPosition) {
    const ctx = this.audioContext;
    if (!this.ensureReady()) return;
    const sample = this.sampleCache.get("check");
    if (sample) {
      this.triggerSample(sample, 1.0, position);
      return;
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 0.02);
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.25);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    const destination = this.buildDestination(position);
    osc.connect(gain).connect(destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  }

  private initContext() {
    if (typeof window === "undefined") {
      return;
    }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) {
      console.warn("Web Audio API not supported in this browser.");
      return;
    }
    this.audioContext = new Ctx();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.audioContext.destination);
    this.ambientGain = this.audioContext.createGain();
    this.ambientGain.gain.value = 0.25;
    this.ambientGain.connect(this.masterGain);
  }

  private ensureReady() {
    if (!this.audioContext) {
      this.initContext();
    }
    if (!this.audioContext || !this.masterGain) return false;
    if (!this.enabled) return false;
    return true;
  }

  private async loadSamples() {
    if (!this.audioContext) return;
    const pending: Promise<void>[] = [];
    (Object.keys(this.samplePaths) as SampleKey[]).forEach((key) => {
      if (this.sampleCache.has(key)) return;
      const url = this.samplePaths[key];
      pending.push(
        fetch(url)
          .then((response) => {
            if (!response.ok) throw new Error(`Failed to load audio sample: ${url}`);
            return response.arrayBuffer();
          })
          .then((arrayBuffer) => this.audioContext!.decodeAudioData(arrayBuffer))
          .then((buffer) => {
            this.sampleCache.set(key, buffer);
          })
          .catch((error) => {
            console.warn(error);
          })
      );
    });
    if (pending.length > 0) {
      await Promise.all(pending);
    }
  }

  private triggerSample(buffer: AudioBuffer, gainScalar: number, position?: SpatialPosition) {
    if (!this.audioContext || !this.masterGain) return;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.96 + Math.random() * 0.08;
    const gain = this.audioContext.createGain();
    gain.gain.value = gainScalar;
    const destination = this.buildDestination(position);
    source.connect(gain).connect(destination);
    source.start();
  }

  private startAmbient() {
    if (!this.audioContext || !this.ambientGain) return;
    this.stopAmbient();
    const baseFreqs = [98, 147];
    const now = this.audioContext.currentTime;
    this.padOscillators = baseFreqs.map((freq, i) => {
      const osc = this.audioContext!.createOscillator();
      osc.type = "sine";
      const gain = this.audioContext!.createGain();
      gain.gain.value = 0.25 - i * 0.05;

      const lfo = this.audioContext!.createOscillator();
      const lfoGain = this.audioContext!.createGain();
      lfo.frequency.value = 0.08 + i * 0.03;
      lfoGain.gain.value = 5 + i * 2;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(now + i * 0.1);

      osc.frequency.setValueAtTime(freq, now);
      osc.connect(gain).connect(this.ambientGain!);
      osc.start(now + i * 0.1);
      return osc;
    });
    this.ambientGain.gain.linearRampToValueAtTime(0.22, now + 1.5);
  }

  private stopAmbient() {
    if (!this.audioContext || !this.ambientGain) return;
    const now = this.audioContext.currentTime;
    this.ambientGain.gain.linearRampToValueAtTime(0, now + 0.5);
    this.padOscillators.forEach((osc) => osc.stop(now + 0.55));
    this.padOscillators = [];
  }

  private buildDestination(position?: SpatialPosition) {
    if (!this.audioContext || !this.masterGain) return this.masterGain!;
    if (!position) return this.masterGain!;
    const panner = this.audioContext.createStereoPanner();
    const pan = Math.max(-1, Math.min(1, position.x / 6));
    panner.pan.value = pan;

    const distanceGain = this.audioContext.createGain();
    const distance = Math.min(1.5, Math.hypot(position.x / 6, position.z / 6));
    distanceGain.gain.value = 1 - 0.45 * distance;

    panner.connect(distanceGain).connect(this.masterGain);
    return panner;
  }
}

type SampleKey = "move" | "capture" | "check";

export type SpatialPosition = {
  x: number;
  z: number;
};
