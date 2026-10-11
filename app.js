'use strict';
// Voce del Vuoto - logica app (Web Audio API nativa, nessuna dipendenza)

const $ = (s) => document.querySelector(s);
const st2r = (st) => Math.pow(2, st / 12);

/* ---------- Preset e parametri ---------- */

const PRESETS = {
  vuoto:    { label: 'Il Vuoto',   main: -7,  layer: 5,   mix: 0.25, dist: 0.15, tone: 6000,  revMix: 0.45, revTime: 4.0, delayTime: 0.30, delayFb: 0.30, delayMix: 0.20, win: 50 },
  demone:   { label: 'Demone',     main: -9,  layer: 3,   mix: 0.45, dist: 0.40, tone: 4500,  revMix: 0.30, revTime: 2.5, delayTime: 0.12, delayFb: 0.25, delayMix: 0.25, win: 45 },
  sussurro: { label: 'Sussurro',   main: -2,  layer: 7,   mix: 0.35, dist: 0.05, tone: 9000,  revMix: 0.60, revTime: 5.0, delayTime: 0.35, delayFb: 0.45, delayMix: 0.30, win: 40 },
  entita:   { label: 'Entità',     main: -5,  layer: -12, mix: 0.55, dist: 0.22, tone: 5500,  revMix: 0.55, revTime: 6.0, delayTime: 0.40, delayFb: 0.40, delayMix: 0.25, win: 55 },
  bambino:  { label: 'Presenza',   main: 4,   layer: -4,  mix: 0.40, dist: 0.08, tone: 8000,  revMix: 0.50, revTime: 4.5, delayTime: 0.22, delayFb: 0.35, delayMix: 0.20, win: 35 },
  pulita:   { label: 'Pulita (test)', main: 0, layer: 0,  mix: 0,    dist: 0,    tone: 12000, revMix: 0,    revTime: 1.0, delayTime: 0.20, delayFb: 0,    delayMix: 0,    win: 30 },
};

const SLIDERS = [
  { k: 'main',      label: 'Tono principale',          min: -12, max: 6,    step: 0.5,  fmt: (v) => (v > 0 ? '+' : '') + v + ' st' },
  { k: 'layer',     label: 'Secondo strato (tono)',    min: -12, max: 12,   step: 0.5,  fmt: (v) => (v > 0 ? '+' : '') + v + ' st' },
  { k: 'mix',       label: 'Secondo strato (volume)',  min: 0,   max: 1,    step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
  { k: 'dist',      label: 'Distorsione',              min: 0,   max: 1,    step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
  { k: 'tone',      label: 'Taglio acuti',             min: 1500, max: 12000, step: 100, fmt: (v) => v + ' Hz' },
  { k: 'revMix',    label: 'Riverbero',                min: 0,   max: 1,    step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
  { k: 'revTime',   label: 'Durata riverbero',         min: 0.5, max: 8,    step: 0.1,  fmt: (v) => v.toFixed(1) + ' s' },
  { k: 'delayTime', label: 'Eco: tempo',               min: 0.05, max: 0.8, step: 0.01, fmt: (v) => Math.round(v * 1000) + ' ms' },
  { k: 'delayFb',   label: 'Eco: ripetizioni',         min: 0,   max: 0.8,  step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
  { k: 'delayMix',  label: 'Eco: volume',              min: 0,   max: 1,    step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
  { k: 'win',       label: 'Finestra pitch (latenza)', min: 20,  max: 120,  step: 5,    fmt: (v) => v + ' ms' },
  { k: 'gate',      label: 'Soglia noise gate',        min: -70, max: -20,  step: 1,    fmt: (v) => (v <= -70 ? 'spento' : v + ' dB') },
  { k: 'inGain',    label: 'Guadagno microfono',       min: 0,   max: 4,    step: 0.05, fmt: (v) => v.toFixed(2) + 'x' },
  { k: 'sfxVol',    label: 'Volume effetti',           min: 0,   max: 1,    step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
  { k: 'master',    label: 'Volume uscita',            min: 0,   max: 1,    step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
];

const STORE_KEY = 'vuoto-settings-v1';
const settings = Object.assign({}, PRESETS.vuoto, { gate: -50, inGain: 1, sfxVol: 0.7, master: 0.8, preset: 'vuoto' });
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved) Object.assign(settings, saved);
} catch (_) { /* storage non disponibile: nessun problema */ }
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (_) {} };

/* ---------- Stato audio ---------- */

let ctx = null;
const N = {};            // nodi
let micSrc = null, micStream = null;
let muted = false;
let appliedRevTime = -1, appliedDist = -1;
let wakeLock = null;

/* ---------- Costruzione UI ---------- */

function buildUI() {
  const presets = $('#presets');
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.id = id;
    b.textContent = p.label;
    b.onclick = () => applyPreset(id);
    presets.appendChild(b);
  }

  const sl = $('#sliders');
  for (const s of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `<span class="rl">${s.label}</span><output id="o_${s.k}"></output>
      <input type="range" id="r_${s.k}" min="${s.min}" max="${s.max}" step="${s.step}">`;
    sl.appendChild(row);
    const inp = row.querySelector('input');
    inp.addEventListener('input', () => {
      settings[s.k] = parseFloat(inp.value);
      settings.preset = '';
      refreshUI();
      apply();
      save();
    });
  }

  buildSfx();
  buildSlots();
  refreshUI();
}

function refreshUI() {
  for (const s of SLIDERS) {
    $('#r_' + s.k).value = settings[s.k];
    $('#o_' + s.k).textContent = s.fmt(settings[s.k]);
  }
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.id === settings.preset));
}

function applyPreset(id) {
  const p = PRESETS[id];
  for (const k of Object.keys(p)) if (k !== 'label') settings[k] = p[k];
  settings.preset = id;
  refreshUI();
  apply();
  save();
}

/* ---------- Grafo audio ---------- */

function distCurve(amount) {
  if (amount < 0.01) return null;
  const n = 2048, c = new Float32Array(n), k = 1 + amount * 40, norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

function makeImpulse(seconds) {
  const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * seconds)), pre = Math.floor(sr * 0.02);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const x = (Math.random() * 2 - 1) * Math.pow(1 - t, 3);
      lp += 0.35 * (x - lp);          // coda scura
      d[i] = lp;
    }
  }
  return buf;
}

function makeNoise(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

async function buildGraph() {
  await ctx.audioWorklet.addModule('worklet.js');
  const mk = (type, opts) => new AudioWorkletNode(ctx, type, Object.assign({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }, opts));

  N.micGain = ctx.createGain();
  N.inBus = ctx.createGain();
  N.hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 90, Q: 0.7 });
  N.gate = mk('gate');
  N.pitchMain = mk('pitch-shifter');
  N.pitchLayer = mk('pitch-shifter');
  N.mainGain = ctx.createGain();
  N.layerGain = ctx.createGain();
  N.mix = ctx.createGain();
  N.mix.gain.value = 0.85;
  N.shaper = ctx.createWaveShaper();
  N.shaper.oversample = '2x';
  N.tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6000, Q: 0.7 });
  N.conv = ctx.createConvolver();
  N.revGain = ctx.createGain();
  N.delay = ctx.createDelay(1.5);
  N.fb = ctx.createGain();
  N.delGain = ctx.createGain();
  N.pre = ctx.createGain();
  N.sfxBus = ctx.createGain();
  N.master = ctx.createGain();
  N.limiter = new DynamicsCompressorNode(ctx, { threshold: -8, knee: 0, ratio: 20, attack: 0.003, release: 0.12 });
  N.anIn = new AnalyserNode(ctx, { fftSize: 1024 });
  N.anOut = new AnalyserNode(ctx, { fftSize: 1024 });
  N.recorder = mk('recorder', { numberOfOutputs: 1 });
  N.recSink = ctx.createGain();
  N.recSink.gain.value = 0;

  // voce: bus -> filtro -> gate -> (due strati di pitch) -> effetti
  N.micGain.connect(N.inBus);
  N.inBus.connect(N.hp).connect(N.gate);
  N.gate.connect(N.pitchMain).connect(N.mainGain).connect(N.mix);
  N.gate.connect(N.pitchLayer).connect(N.layerGain).connect(N.mix);
  N.mix.connect(N.shaper).connect(N.tone);

  // mandate: secco + riverbero + eco
  N.tone.connect(N.pre);
  N.tone.connect(N.conv).connect(N.revGain).connect(N.pre);
  N.tone.connect(N.delay);
  N.delay.connect(N.fb).connect(N.delay);
  N.delay.connect(N.delGain).connect(N.pre);

  N.pre.connect(N.master);
  N.sfxBus.connect(N.master);
  N.master.connect(N.limiter).connect(ctx.destination);

  // misuratori e registratore (sul segnale grezzo del microfono)
  N.inBus.connect(N.anIn);
  N.master.connect(N.anOut);
  N.micGain.connect(N.recorder).connect(N.recSink).connect(ctx.destination);

  N.recorder.port.onmessage = onRecorded;
  appliedRevTime = -1;
  appliedDist = -1;
}

function apply() {
  if (!ctx || !N.master) return;
  const t = ctx.currentTime, T = 0.03, s = settings;
  N.pitchMain.parameters.get('ratio').setTargetAtTime(st2r(s.main), t, T);
  N.pitchLayer.parameters.get('ratio').setTargetAtTime(st2r(s.layer), t, T);
  N.pitchMain.port.postMessage({ win: s.win });
  N.pitchLayer.port.postMessage({ win: s.win });
  N.layerGain.gain.setTargetAtTime(s.mix, t, T);
  N.mainGain.gain.setTargetAtTime(1, t, T);
  if (s.dist !== appliedDist) { N.shaper.curve = distCurve(s.dist); appliedDist = s.dist; }
  N.tone.frequency.setTargetAtTime(s.tone, t, T);
  if (s.revTime !== appliedRevTime) { N.conv.buffer = makeImpulse(s.revTime); appliedRevTime = s.revTime; }
  N.revGain.gain.setTargetAtTime(s.revMix * 1.3, t, T);
  N.delay.delayTime.setTargetAtTime(s.delayTime, t, T);
  N.fb.gain.setTargetAtTime(s.delayFb, t, T);
  N.delGain.gain.setTargetAtTime(s.delayMix, t, T);
  N.gate.parameters.get('threshold').setTargetAtTime(s.gate <= -70 ? 0 : Math.pow(10, s.gate / 20), t, T);
  N.micGain.gain.setTargetAtTime(muted ? 0 : s.inGain, t, 0.02);
  N.sfxBus.gain.setTargetAtTime(s.sfxVol, t, T);
  N.master.gain.setTargetAtTime(s.master, t, T);
}

/* ---------- Microfono e dispositivi ---------- */

async function connectMic(deviceId) {
  if (micStream) micStream.getTracks().forEach((tr) => tr.stop());
  if (micSrc) micSrc.disconnect();
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      latency: 0,
    },
  });
  micSrc = ctx.createMediaStreamSource(micStream);
  micSrc.connect(N.micGain);
}

async function listDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind) => {
    const cur = sel.value;
    sel.innerHTML = '';
    devs.filter((d) => d.kind === kind).forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `${kind} ${i + 1}`;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  };
  fill($('#inSel'), 'audioinput');
  fill($('#outSel'), 'audiooutput');
}

/* ---------- Soundboard ---------- */

const sfxState = {};
let noiseBuf = null;

function env(g, t, points) {           // points: [[tempo, valore], ...]
  g.gain.setValueAtTime(points[0][1], t + points[0][0]);
  for (let i = 1; i < points.length; i++) g.gain.linearRampToValueAtTime(points[i][1], t + points[i][0]);
}

const SFX = {
  breath() {
    const t = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 700, Q: 0.9 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1800 });
    const g = ctx.createGain();
    env(g, t, [[0, 0], [1.1, 0.5], [1.5, 0.06], [1.9, 0.08], [2.5, 0.75], [4.0, 0]]);
    src.connect(bp).connect(lp).connect(g).connect(N.sfxBus);
    src.start(t); src.stop(t + 4.1);
  },
  creak() {
    const t = ctx.currentTime + 0.02;
    const o = new OscillatorNode(ctx, { type: 'sawtooth' });
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(210, t + 0.5);
    o.frequency.linearRampToValueAtTime(130, t + 1.2);
    o.frequency.linearRampToValueAtTime(300, t + 1.7);
    const vib = new OscillatorNode(ctx, { frequency: 9 }), vg = ctx.createGain(); vg.gain.value = 14;
    vib.connect(vg).connect(o.frequency);
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 6 });
    const g = ctx.createGain();
    env(g, t, [[0, 0], [0.2, 0.35], [1.4, 0.3], [1.9, 0]]);
    o.connect(bp).connect(g).connect(N.sfxBus);
    o.start(t); vib.start(t); o.stop(t + 2); vib.stop(t + 2);
  },
  boom() {
    const t = ctx.currentTime + 0.02;
    const o = new OscillatorNode(ctx, { type: 'sine' });
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(g).connect(N.sfxBus);
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const nl = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 450 });
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.connect(nl).connect(ng).connect(N.sfxBus);
    o.start(t); o.stop(t + 1.6); n.start(t); n.stop(t + 0.6);
  },
};

function makeToggle(kind) {
  if (kind === 'drone') {
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 260 });
    [55, 55.4, 82.5, 110.3].forEach((f) => {
      const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f }); o.connect(lp); o.start();
    });
    const lfo = new OscillatorNode(ctx, { frequency: 0.07 }), lg = ctx.createGain(); lg.gain.value = 90;
    lfo.connect(lg).connect(lp.frequency); lfo.start();
    lp.connect(g).connect(N.sfxBus);
    return { on: () => g.gain.setTargetAtTime(0.22, ctx.currentTime, 1.5), off: () => g.gain.setTargetAtTime(0, ctx.currentTime, 1.0) };
  }
  if (kind === 'wind') {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 450, Q: 0.8 });
    const lfo = new OscillatorNode(ctx, { frequency: 0.13 }), lg = ctx.createGain(); lg.gain.value = 260;
    lfo.connect(lg).connect(bp.frequency);
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(N.sfxBus); src.start(); lfo.start();
    return { on: () => g.gain.setTargetAtTime(0.5, ctx.currentTime, 1.2), off: () => g.gain.setTargetAtTime(0, ctx.currentTime, 0.8) };
  }
  if (kind === 'heart') {
    let timer = null;
    const thump = (t, v) => {
      const o = new OscillatorNode(ctx, { type: 'sine' });
      o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(N.sfxBus); o.start(t); o.stop(t + 0.25);
    };
    const beat = () => { const t = ctx.currentTime + 0.02; thump(t, 0.9); thump(t + 0.28, 0.7); };
    return {
      on: () => { beat(); timer = setInterval(beat, 1000); },
      off: () => { clearInterval(timer); timer = null; },
    };
  }
}

function buildSfx() {
  const box = $('#sfx');
  const items = [
    ['Respiro', 'shot', 'breath'], ['Cigolio', 'shot', 'creak'], ['Tonfo', 'shot', 'boom'],
    ['Drone', 'toggle', 'drone'], ['Vento', 'toggle', 'wind'], ['Battito', 'toggle', 'heart'],
  ];
  for (const [label, type, id] of items) {
    const b = document.createElement('button');
    b.className = 'pad' + (type === 'toggle' ? ' toggle' : '');
    b.textContent = label;
    b.onclick = () => {
      if (!ctx) return;
      if (type === 'shot') { SFX[id](); return; }
      if (!sfxState[id]) sfxState[id] = { node: makeToggle(id), on: false };
      const s = sfxState[id];
      s.on = !s.on;
      s.on ? s.node.on() : s.node.off();
      b.classList.toggle('on', s.on);
    };
    box.appendChild(b);
  }
}

/* ---------- Frasi registrate ---------- */

const slots = [null, null, null, null];     // AudioBuffer
let recSlot = -1;

function buildSlots() {
  const box = $('#slots');
  for (let i = 0; i < slots.length; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'slot';
    wrap.innerHTML = `<button class="pad slotbtn" id="slot${i}">Frase ${i + 1}<small>vuota: tocca per registrare</small></button>
      <button class="mini" id="re${i}" title="Registra di nuovo">↺</button>`;
    box.appendChild(wrap);
    $('#slot' + i).onclick = () => slotTap(i);
    $('#re' + i).onclick = () => { if (recSlot < 0) { slots[i] = null; startRec(i); } };
  }
}

function slotUI(i) {
  const b = $('#slot' + i);
  b.classList.toggle('rec', recSlot === i);
  const sm = b.querySelector('small');
  if (recSlot === i) sm.textContent = '● registro… tocca per fermare';
  else if (slots[i]) sm.textContent = (slots[i].duration).toFixed(1) + ' s · tocca per riprodurre';
  else sm.textContent = 'vuota: tocca per registrare';
}

function slotTap(i) {
  if (!ctx) return;
  if (recSlot === i) { N.recorder.port.postMessage('stop'); return; }
  if (recSlot >= 0) return;
  if (!slots[i]) { startRec(i); return; }
  const src = ctx.createBufferSource();
  src.buffer = slots[i];
  src.connect(N.inBus);                 // passa da gate, pitch ed effetti
  src.start();
}

function startRec(i) {
  recSlot = i;
  N.recorder.port.postMessage('start');
  slotUI(i);
}

function onRecorded(e) {
  const data = e.data && e.data.buffer;
  if (!data || recSlot < 0) return;
  const i = recSlot;
  recSlot = -1;
  // taglia silenzio iniziale e finale
  let a = 0, b = data.length - 1;
  while (a < b && Math.abs(data[a]) < 0.02) a++;
  while (b > a && Math.abs(data[b]) < 0.02) b--;
  a = Math.max(0, a - Math.floor(ctx.sampleRate * 0.05));
  b = Math.min(data.length - 1, b + Math.floor(ctx.sampleRate * 0.15));
  const len = b - a + 1;
  if (len < ctx.sampleRate * 0.15) { slots[i] = null; slotUI(i); return; }
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  buf.copyToChannel(data.subarray(a, b + 1), 0);
  slots[i] = buf;
  slotUI(i);
}

/* ---------- Misuratori e stato ---------- */

const tmp = new Float32Array(1024);
function level(an) {
  an.getFloatTimeDomainData(tmp);
  let pk = 0;
  for (let i = 0; i < tmp.length; i++) { const v = Math.abs(tmp[i]); if (v > pk) pk = v; }
  return pk;
}

function tick() {
  if (!ctx || !N.anIn) return;
  const li = level(N.anIn), lo = level(N.anOut);
  $('#mIn').style.width = Math.min(100, li * 100) + '%';
  $('#mOut').style.width = Math.min(100, lo * 100) + '%';
  $('#mOut').classList.toggle('hot', lo > 0.9);
  requestAnimationFrame(tick);
}

function updateLatency() {
  if (!ctx) return;
  const sys = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
  const est = Math.round(sys * 1000 + settings.win / 2 + 3);
  $('#lat').textContent = `latenza stimata ≈ ${est} ms (+ ingresso mic, di solito 10-30 ms)`;
}

/* ---------- Avvio ---------- */

async function start() {
  const btn = $('#startBtn');
  btn.disabled = true;
  btn.textContent = 'Avvio…';
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microfono non disponibile: apri la pagina in HTTPS (o da localhost).');
    }
    ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.resume();
    await buildGraph();
    noiseBuf = makeNoise(4);
    await connectMic();
    await listDevices();
    navigator.mediaDevices.addEventListener('devicechange', listDevices);
    if (!('setSinkId' in AudioContext.prototype)) $('#outWrap').hidden = true;
    apply();
    $('#startBox').hidden = true;
    $('#app').hidden = false;
    $('#muteBtn').hidden = false;
    document.body.classList.add('live');
    tick();
    setInterval(updateLatency, 700);
    ctx.onstatechange = () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); };
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '▶ Riprova';
    $('#err').hidden = false;
    $('#err').textContent = 'Errore: ' + (err && err.message ? err.message : err);
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && ctx) {
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }
});

$('#startBtn').onclick = start;
$('#muteBtn').onclick = () => {
  muted = !muted;
  $('#muteBtn').classList.toggle('muted', muted);
  $('#muteBtn').textContent = muted ? '🔇 MICROFONO SPENTO' : '🎙 MICROFONO ATTIVO';
  apply();
};
$('#inSel').onchange = (e) => connectMic(e.target.value).catch((err) => alert(err.message));
$('#outSel').onchange = (e) => ctx.setSinkId(e.target.value).catch((err) => alert(err.message));

buildUI();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
