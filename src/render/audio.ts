/**
 * Synthesized SFX. No audio files anywhere in the repo — every sound is built from
 * oscillators and a noise buffer at call time, which keeps the clone tiny and the
 * licensing question closed.
 *
 * The context is created lazily on the first user gesture so autoplay policy
 * never blocks it.
 */

export interface Sfx {
  hit(): void;
  crit(): void;
  block(): void;
  whoosh(): void;
  ko(): void;
  bell(): void;
}

export function createAudio(): Sfx {
  let ctx: AudioContext | null = null;

  function context(): AudioContext {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  function noise(duration: number, cutoff: number, gainValue: number): void {
    const audio = context();
    const frames = Math.floor(audio.sampleRate * duration);
    const buffer = audio.createBuffer(1, frames, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }

    const source = audio.createBufferSource();
    source.buffer = buffer;

    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;

    const gain = audio.createGain();
    gain.gain.value = gainValue;

    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
  }

  function tone(from: number, to: number, duration: number, type: OscillatorType, gainValue: number): void {
    const audio = context();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), audio.currentTime + duration);
    gain.gain.setValueAtTime(gainValue, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration);
  }

  return {
    hit() {
      noise(0.16, 1800, 0.35);
      tone(180, 60, 0.16, 'square', 0.18);
    },
    crit() {
      noise(0.3, 4200, 0.4);
      tone(680, 90, 0.34, 'sawtooth', 0.22);
      tone(340, 45, 0.4, 'square', 0.16);
    },
    block() {
      noise(0.1, 700, 0.28);
      tone(120, 80, 0.1, 'sine', 0.14);
    },
    whoosh() {
      noise(0.22, 900, 0.1);
    },
    ko() {
      tone(420, 40, 1.2, 'sawtooth', 0.28);
      noise(0.7, 2600, 0.25);
    },
    bell() {
      tone(880, 780, 0.5, 'triangle', 0.2);
      tone(1320, 1180, 0.5, 'sine', 0.12);
    }
  };
}
