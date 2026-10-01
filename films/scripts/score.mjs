// Background music for the guard.xsom.fr films, synthesised here so every note is ours: no
// library track, no licence to track. Ported from the xSOM site's tools/film-score.mjs (same
// instruments, same mix) with one change: a chord lasts as long as its act, not a fixed
// six-second shot, because these films cut on their titles. Deterministic: the same cue
// always renders the same file.
//
// Layers: a warm pad (three detuned saws per note, low-passed, slowly breathing), a bass,
// felt-piano plucks arpeggiating the chord at 80 bpm through a dotted-eighth echo, a
// heartbeat pulse in the full acts, an impact on every cut, and a shared reverb.
import fs from 'node:fs';

const RATE = 48000;
const BEAT = 60 / 80;
// Level of the delivered cue, as plain RMS. -23 dBFS RMS measures about -21 LUFS on these
// cues, where the xSOM site's films put their music.
const TARGET_RMS_DB = -23;

// Chords as MIDI notes, `at` in seconds: `bass` alone, `pad` voiced open.
const CUES = {
  // Homepage, 15 s, D minor: calm (Dm9), the threat (Em7b5), the control taking over
  // (A7sus4), the office sealed (Fmaj9, the relative major).
  home: { seconds: 15, chords: [
    { at: 0, bass: 38, pad: [50, 57, 64, 65, 69] },
    { at: 3.05, bass: 40, pad: [52, 58, 62, 67, 70] },
    { at: 6.8, bass: 33, pad: [57, 62, 64, 67, 69] },
    { at: 10.9, bass: 41, pad: [53, 57, 60, 64, 67, 72] },
  ] },
  // Products, 15 s, A minor: the laptop (Am9), the servers (Fmaj7), the range (Cmaj9).
  products: { seconds: 15, chords: [
    { at: 0, bass: 33, pad: [52, 57, 60, 67, 71] },
    { at: 4, bass: 41, pad: [57, 60, 64, 69, 72] },
    { at: 9.4, bass: 36, pad: [55, 59, 62, 64, 71] },
  ] },
};
export const cues = Object.keys(CUES);

const hz = note => 440 * 2 ** ((note - 69) / 12);
const pan = (value, p) => [value * Math.cos((p + 1) * Math.PI / 4), value * Math.sin((p + 1) * Math.PI / 4)];
const smooth = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Renders the cue for `name` to a 48 kHz stereo 32-bit float WAV. */
export function score(name, file) {
  const cue = CUES[name];
  if (!cue) throw new Error(`No music cue for ${name}`);
  const { seconds, chords } = cue;
  const ends = chords.map((chord, index) => chords[index + 1]?.at ?? seconds);
  const length = seconds * RATE;
  const left = new Float32Array(length), right = new Float32Array(length);
  const sendL = new Float32Array(length), sendR = new Float32Array(length);
  const plucksL = new Float32Array(length), plucksR = new Float32Array(length);
  const last = chords.length - 1;
  // How busy each shot is: sparse opening, full middle, the last shot settles.
  const energy = index => (index === 0 ? 0.55 : index === last ? 0.7 : 1);

  chords.forEach((chord, index) => {
    const span = ends[index] - chord.at;
    const start = Math.max(0, chord.at - 0.7);
    const attack = index === 0 ? Math.min(2.6, span * 0.8) : 1.4;
    const end = index === last ? seconds : ends[index] + 0.7;
    const release = index === last ? 0 : 1.6;
    const envelope = t => smooth((t - start) / attack) * (1 - smooth((t - (end - release)) / (release || 1)));
    const from = Math.floor(start * RATE), to = Math.min(length, Math.ceil(end * RATE));

    // Pad: three detuned band-limited saws per note, low-passed per channel.
    const voices = chord.pad.flatMap((note, n) => [-7, 0, 7].map((cents, v) => ({
      step: hz(note) * 2 ** (cents / 1200) / RATE,
      phase: ((n * 3 + v) * 0.137) % 1,
      pan: (v - 1) * 0.55 + (n / (chord.pad.length - 1) - 0.5) * 0.3,
      gain: 0.045 / Math.sqrt(chord.pad.length / 5),
    })));
    const svf = [{ low: 0, band: 0 }, { low: 0, band: 0 }];
    for (let i = from; i < to; i++) {
      const t = i / RATE;
      const level = envelope(t);
      let l = 0, r = 0;
      for (const voice of voices) {
        voice.phase += voice.step;
        if (voice.phase >= 1) voice.phase -= 1;
        const [a, b] = pan((2 * voice.phase - 1 - polyBlep(voice.phase, voice.step)) * voice.gain, voice.pan);
        l += a; r += b;
      }
      // The pad breathes: its cutoff drifts slowly and opens with the shot's energy.
      const cutoff = 650 + 900 * energy(index) * (0.55 + 0.45 * Math.sin(2 * Math.PI * t / 9 + index));
      const f = 2 * Math.sin(Math.PI * cutoff / RATE);
      const out = [l, r].map((x, c) => {
        const s = svf[c];
        s.low += f * s.band;
        s.band += f * (x - s.low - 1.3 * s.band);
        return s.low * level;
      });
      left[i] += out[0]; right[i] += out[1];
      sendL[i] += out[0] * 0.55; sendR[i] += out[1] * 0.55;
      // Bass: a sine with a touch of its octave, under the pad.
      const w = 2 * Math.PI * hz(chord.bass) * t;
      const bass = (Math.sin(w) + 0.22 * Math.sin(2 * w)) * 0.11 * smooth((t - start) / 0.9) * (1 - smooth((t - (end - release)) / (release || 1)));
      left[i] += bass; right[i] += bass;
    }

    // Plucks: the chord's tones an octave up, one per eighth note, in a turning pattern.
    const tones = chord.pad.slice(1).map(note => note + 12);
    const pattern = [0, 2, 1, 3, 2, 4, 1, 3];
    const eighths = Math.round(span / (BEAT / 2));
    for (let k = 0; k < eighths; k++) {
      if (index === 0 && k < eighths / 2) continue; // the opening breathes before the pulse
      if (index === last && k >= eighths * 0.75) continue; // and the end lets the pad ring
      if (energy(index) < 1 && k % 2) continue;
      const at = chord.at + k * BEAT / 2;
      const accent = k % 4 === 0 ? 1 : 0.62;
      addPluck(hz(tones[pattern[k % pattern.length] % tones.length]), at, 0.17 * accent * energy(index), k % 2 ? 0.35 : -0.35);
    }

    // Heartbeat in the full shots, an impact on every cut.
    if (energy(index) === 1) for (let beat = index ? 2 : 0; beat < span / BEAT; beat += 2) addBoom(chord.at + beat * BEAT, 0.14);
    if (index > 0) { addSwell(chord.at, 1.6); addBoom(chord.at, 0.3); }
  });

  function addPluck(freq, at, gain, p) {
    const from = Math.round(at * RATE), to = Math.min(length, from + 3 * RATE);
    for (let i = from; i < to; i++) {
      const t = (i - from) / RATE;
      const w = 2 * Math.PI * freq * t;
      const v = (Math.sin(w) * Math.exp(-t / 0.8) + 0.3 * Math.sin(2 * w) * Math.exp(-t / 0.22) + 0.1 * Math.sin(3 * w) * Math.exp(-t / 0.1)) * Math.min(1, t / 0.004) * gain;
      const [a, b] = pan(v, p);
      plucksL[i] += a; plucksR[i] += b;
    }
  }
  function addBoom(at, gain) {
    const from = Math.round(at * RATE), to = Math.min(length, from + RATE);
    let phase = 0;
    for (let i = from; i < to; i++) {
      const t = (i - from) / RATE;
      phase += 2 * Math.PI * (38 + 34 * Math.exp(-t / 0.06)) / RATE;
      const v = Math.sin(phase) * Math.exp(-t / 0.32) * Math.min(1, t / 0.003) * gain;
      left[i] += v; right[i] += v;
      sendL[i] += v * 0.15; sendR[i] += v * 0.15;
    }
  }
  function addSwell(at, duration) {
    let seed = Math.round(at * 1000) + 1, low = 0;
    const to = Math.round(at * RATE), from = Math.max(0, to - Math.round(duration * RATE));
    for (let i = from; i < to; i++) {
      const x = (i - from) / (to - from);
      seed = (seed * 1664525 + 1013904223) >>> 0;
      low += (2 * Math.PI * (250 + 2600 * x * x) / RATE) * ((seed / 2 ** 32) * 2 - 1 - low);
      const v = low * x * x * 0.035;
      sendL[i] += v; sendR[i] += v;
      left[i] += v * 0.4; right[i] += v * 0.4;
    }
  }

  // Plucks through a ping-pong dotted-eighth echo, then into the mix and the reverb send.
  const echo = Math.round(BEAT * 0.75 * RATE);
  const lineL = new Float32Array(echo), lineR = new Float32Array(echo);
  let dampL = 0, dampR = 0;
  for (let i = 0; i < length; i++) {
    const j = i % echo;
    const outL = lineL[j], outR = lineR[j];
    dampL += 0.35 * (outR - dampL); dampR += 0.35 * (outL - dampR);
    lineL[j] = plucksL[i] + dampL * 0.38;
    lineR[j] = plucksR[i] + dampR * 0.38;
    const l = plucksL[i] + outL * 0.3, r = plucksR[i] + outR * 0.3;
    left[i] += l; right[i] += r;
    sendL[i] += l * 0.6; sendR[i] += r * 0.6;
  }

  // Shared reverb (Freeverb), 35 % wet.
  const [wetL, wetR] = freeverb(sendL, sendR, 0.86, 0.45);
  let peak = 0, power = 0;
  for (let i = 0; i < length; i++) {
    const t = i / RATE;
    const fade = smooth(t / 0.4) * (1 - smooth((t - (seconds - 2.6)) / 2.6));
    left[i] = Math.tanh((left[i] + wetL[i] * 0.35) * 1.1) * fade;
    right[i] = Math.tanh((right[i] + wetR[i] * 0.35) * 1.1) * fade;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    power += (left[i] ** 2 + right[i] ** 2) / 2;
  }
  // To the target level, never past -1 dBFS peak.
  const scale = Math.min(0.89 / peak, 10 ** (TARGET_RMS_DB / 20) / Math.sqrt(power / length));
  writeWav(file, left.map(v => v * scale), right.map(v => v * scale));
  return file;
}

function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

function freeverb(inL, inR, room, damping) {
  const tune = n => Math.round(n * RATE / 44100);
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allpasses = [556, 441, 341, 225];
  const feedback = room * 0.28 + 0.7, damp = damping * 0.4;
  const channel = (input, spread) => {
    const cs = combs.map(n => ({ buf: new Float32Array(tune(n + spread)), i: 0, store: 0 }));
    const as = allpasses.map(n => ({ buf: new Float32Array(tune(n + spread)), i: 0 }));
    const out = new Float32Array(input.length);
    for (let s = 0; s < input.length; s++) {
      const x = input[s] * 0.015;
      let y = 0;
      for (const c of cs) {
        const o = c.buf[c.i];
        c.store = o * (1 - damp) + c.store * damp;
        c.buf[c.i] = x + c.store * feedback;
        c.i = (c.i + 1) % c.buf.length;
        y += o;
      }
      for (const a of as) {
        const b = a.buf[a.i];
        a.buf[a.i] = y + b * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        y = b - y;
      }
      out[s] = y;
    }
    return out;
  };
  return [channel(inL, 0), channel(inR, 23)];
}

function writeWav(file, left, right) {
  const frames = left.length;
  const buffer = Buffer.alloc(44 + frames * 8);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + frames * 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(3, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(RATE, 24); buffer.writeUInt32LE(RATE * 8, 28); buffer.writeUInt16LE(8, 32); buffer.writeUInt16LE(32, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 8, 40);
  for (let i = 0; i < frames; i++) { buffer.writeFloatLE(left[i], 44 + i * 8); buffer.writeFloatLE(right[i], 48 + i * 8); }
  fs.writeFileSync(file, buffer);
}
