// Voce del Vuoto - motore audio (AudioWorklet)
// Tre processori: pitch shifter a bassa latenza, noise gate, registratore.

/**
 * Pitch shifter a linea di ritardo con due testine sfasate di mezza finestra
 * e dissolvenza sin^2 (somma costante = 1). Latenza media = finestra / 2.
 * ratio < 1 abbassa il tono, ratio > 1 lo alza.
 */
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.len = 1 << 16; // 65536 campioni (> 1 s a 48 kHz)
    this.mask = this.len - 1;
    this.buf = new Float32Array(this.len);
    this.w = 0;
    this.phase = 0;
    this.win = Math.round(sampleRate * 0.05);
    this.port.onmessage = (e) => {
      if (e.data && e.data.win) {
        const w = Math.round((sampleRate * e.data.win) / 1000);
        this.win = Math.min(this.len / 2 - 8, Math.max(64, w));
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0][0];
    if (!output) return true;
    const input = inputs[0] && inputs[0][0];
    if (!input) {
      output.fill(0);
      return true;
    }
    const ratio = parameters.ratio[0];
    const win = this.win;
    const inc = (1 - ratio) / win;
    const buf = this.buf;
    const mask = this.mask;
    let w = this.w;
    let phase = this.phase;

    for (let i = 0; i < output.length; i++) {
      buf[w] = input[i];

      const pA = phase;
      let pB = phase + 0.5;
      if (pB >= 1) pB -= 1;

      const sA = Math.sin(Math.PI * pA);
      const sB = Math.sin(Math.PI * pB);

      let posA = w - (pA * win + 1);
      let posB = w - (pB * win + 1);
      let iA = Math.floor(posA);
      let iB = Math.floor(posB);
      const fA = posA - iA;
      const fB = posB - iB;

      const a = buf[iA & mask] * (1 - fA) + buf[(iA + 1) & mask] * fA;
      const b = buf[iB & mask] * (1 - fB) + buf[(iB + 1) & mask] * fB;
      output[i] = a * sA * sA + b * sB * sB;

      phase += inc;
      if (phase >= 1) phase -= 1;
      else if (phase < 0) phase += 1;
      w = (w + 1) & mask;
    }

    this.w = w;
    this.phase = phase;
    return true;
  }
}

/** Noise gate con hold, per tagliare il fruscio quando non parli. */
class Gate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'threshold', defaultValue: 0.01, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.env = 0;
    this.g = 0;
    this.hold = 0;
    this.holdN = Math.round(sampleRate * 0.25);
    this.rel = Math.exp(-1 / (sampleRate * 0.02));
    this.gOpen = 1 - Math.exp(-1 / (sampleRate * 0.002));
    this.gClose = 1 - Math.exp(-1 / (sampleRate * 0.06));
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0][0];
    if (!out) return true;
    const inp = inputs[0] && inputs[0][0];
    if (!inp) {
      out.fill(0);
      return true;
    }
    const thr = parameters.threshold[0];
    let { env, g, hold } = this;
    for (let i = 0; i < out.length; i++) {
      const a = Math.abs(inp[i]);
      env = a > env ? a : env * this.rel;
      if (env > thr) hold = this.holdN;
      else if (hold > 0) hold--;
      const target = hold > 0 || thr === 0 ? 1 : 0;
      g += (target - g) * (target ? this.gOpen : this.gClose);
      out[i] = inp[i] * g;
    }
    this.env = env;
    this.g = g;
    this.hold = hold;
    return true;
  }
}

/** Registratore (max 8 s) per le frasi preregistrate. */
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rec = false;
    this.chunks = [];
    this.n = 0;
    this.max = Math.round(sampleRate * 8);
    this.port.onmessage = (e) => {
      if (e.data === 'start') {
        this.chunks = [];
        this.n = 0;
        this.rec = true;
      } else if (e.data === 'stop' && this.rec) {
        this.finish();
      }
    };
  }

  finish() {
    this.rec = false;
    const all = new Float32Array(this.n);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    this.port.postMessage({ buffer: all }, [all.buffer]);
  }

  process(inputs) {
    const inp = inputs[0] && inputs[0][0];
    if (this.rec && inp) {
      this.chunks.push(inp.slice());
      this.n += inp.length;
      if (this.n >= this.max) this.finish();
    }
    return true;
  }
}

registerProcessor('pitch-shifter', PitchShifter);
registerProcessor('gate', Gate);
registerProcessor('recorder', Recorder);
