// ============================================================================
// audioHud.js — Monaco GP: Street Circuit Challenge
// Web Audio V6 turbo-hybrid synthesis + F1 TV broadcast DOM HUD.
// React-lifecycle safe: initHud() binds DOM refs after mount and returns a
// cleanup function for unmount / StrictMode safety.
// ============================================================================

import { getCircuitConfig } from '../data/circuits.ts';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let els = {};
let towerRows = [];
let leds = [];
let gantryLights = [];

function setText(el, v) { if (el && el.__v !== v) { el.__v = v; el.textContent = v; } }
function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
const code3 = (name) => (name === 'YOU' ? 'YOU' : (name.split(' ').pop() || name).slice(0, 3).toUpperCase());

// ═══════════════════════════════════════════════════════════════════════════
// 1 · MINIMAP GEOMETRY  (dynamic mirror of active circuit layout + curve math)
// ═══════════════════════════════════════════════════════════════════════════
const SEG = 1600;
const mapX = new Float32Array(SEG + 1), mapZ = new Float32Array(SEG + 1), cum = new Float32Array(SEG + 1);
let activeCircuit = getCircuitConfig('monaco-gp');
let PTS = activeCircuit.worldPoints;
let NP = PTS.length;
let mapLen = 0, startU = 0;
const bounds = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
let DRZ = [];
let TUN = null;
let waterC = [0, 0];

function axisVal(x0, x1, x2, x3, dt0, dt1, dt2, w) {
  let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
  let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
  t1 *= dt1; t2 *= dt1;
  const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2, c3 = 2 * x1 - 2 * x2 + t1 + t2;
  return ((c3 * w + c2) * w + t1) * w + x1;
}
function curvePoint(t) {
  const p = t * NP, i = Math.floor(p), w = p - i;
  const P = (k) => PTS[((k % NP) + NP) % NP];
  const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
  const d2 = (a, b) => (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;
  let dt0 = Math.pow(d2(p0, p1), 0.25), dt1 = Math.pow(d2(p1, p2), 0.25), dt2 = Math.pow(d2(p2, p3), 0.25);
  if (dt1 < 1e-4) dt1 = 1; if (dt0 < 1e-4) dt0 = dt1; if (dt2 < 1e-4) dt2 = dt1;
  return [
    axisVal(p0[0], p1[0], p2[0], p3[0], dt0, dt1, dt2, w),
    axisVal(p0[2], p1[2], p2[2], p3[2], dt0, dt1, dt2, w),
  ];
}
function uAtPoint(pt) {
  let best = 0, bd = Infinity;
  for (let i = 0; i <= SEG; i++) {
    const d = (mapX[i] - pt[0]) ** 2 + (mapZ[i] - pt[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best / SEG;
}
function uToXY(u) {
  const target = ((u % 1) + 1) % 1 * mapLen;
  let lo = 0, hi = SEG;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
  const i = Math.max(1, lo), f = (target - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
  return [mapX[i - 1] + (mapX[i] - mapX[i - 1]) * f, mapZ[i - 1] + (mapZ[i] - mapZ[i - 1]) * f];
}
function rebuildMinimapGeometry(circuitId = 'monaco-gp') {
  activeCircuit = getCircuitConfig(circuitId);
  PTS = activeCircuit.worldPoints;
  NP = PTS.length;
  bounds.minX = 1e9; bounds.maxX = -1e9; bounds.minZ = 1e9; bounds.maxZ = -1e9;
  let px = 0, pz = 0;
  for (let i = 0; i <= SEG; i++) {
    const [x, z] = curvePoint(i / SEG);
    mapX[i] = x; mapZ[i] = z;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(x - px, z - pz);
    else cum[0] = 0;
    px = x; pz = z;
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  mapLen = cum[SEG];
  startU = uAtPoint(PTS[activeCircuit.startIndex]);

  DRZ = activeCircuit.drsPointPairs.map(([aIdx, bIdx]) => [
    uAtPoint(PTS[aIdx]) + 0.010,
    uAtPoint(PTS[bIdx]) - 0.008,
  ]);

  if (activeCircuit.tunnelPointPair) {
    const [ta, tb] = activeCircuit.tunnelPointPair;
    TUN = [uAtPoint(PTS[ta]) - 0.006, uAtPoint(PTS[tb]) + 0.006];
  } else {
    TUN = null;
  }

  if (activeCircuit.hasHarborWater && PTS.length >= 30) {
    let wx = 0, wz = 0;
    for (let k = 22; k <= 29; k++) { wx += PTS[k][0]; wz += PTS[k][2]; }
    waterC = [wx / 8 + 60, wz / 8];
  } else {
    waterC = [0, 0];
  }
}
rebuildMinimapGeometry('monaco-gp');

const mm = { ctx: null, base: null, w: 0, h: 0, dpr: 1, tx: null };
function mmSize() {
  const c = els.minimap; if (!c) return;
  const w = c.clientWidth || 236, h = c.clientHeight || 198;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = w * dpr; c.height = h * dpr;
  mm.ctx = c.getContext('2d'); mm.w = w; mm.h = h; mm.dpr = dpr;
  const pad = 12, sx = (w - pad * 2) / (bounds.maxX - bounds.minX), sz = (h - pad * 2) / (bounds.maxZ - bounds.minZ);
  const s = Math.min(sx, sz);
  const ox = (w - (bounds.maxX - bounds.minX) * s) / 2, oz = (h - (bounds.maxZ - bounds.minZ) * s) / 2;
  mm.tx = (x, z) => [ox + (x - bounds.minX) * s, oz + (z - bounds.minZ) * s];
  mmRenderBase();
}
function mmPath(g, u0, u1) {
  g.beginPath();
  const steps = Math.max(2, Math.ceil(Math.abs(u1 - u0) * SEG));
  for (let k = 0; k <= steps; k++) {
    const [x, z] = uToXY(u0 + (u1 - u0) * (k / steps));
    const [cx, cy] = mm.tx(x, z);
    k ? g.lineTo(cx, cy) : g.moveTo(cx, cy);
  }
}
function ensureMinimapCanvas() {
  const c = $('minimap');
  if (!c) {
    els.minimap = null;
    mm.ctx = null;
    return false;
  }
  const cw = c.clientWidth || 236;
  const ch = c.clientHeight || 198;
  if (
    c !== els.minimap ||
    !mm.ctx ||
    mm.ctx.canvas !== c ||
    !mm.base ||
    c.width === 0 ||
    mm.w !== cw ||
    mm.h !== ch
  ) {
    els.minimap = c;
    els.minimapLabel = $('minimap-label');
    els.checkpoint = $('checkpoint-name');
    mmSize();
  }
  return !!(mm.ctx && mm.base);
}
function mmRenderBase() {
  if (!mm.ctx) return;
  const b = document.createElement('canvas');
  b.width = mm.w * mm.dpr; b.height = mm.h * mm.dpr;
  const g = b.getContext('2d'); g.scale(mm.dpr, mm.dpr);

  if (activeCircuit.hasHarborWater) {
    const [wx, wy] = mm.tx(waterC[0] - 280, waterC[1] - 230);
    const [wx2, wy2] = mm.tx(waterC[0] + 280, waterC[1] + 230);
    const hg = g.createLinearGradient(wx, wy, wx2, wy2);
    hg.addColorStop(0, 'rgba(0,210,190,0.10)'); hg.addColorStop(1, 'rgba(59,130,246,0.14)');
    g.fillStyle = hg;
    g.beginPath();
    if (g.roundRect) g.roundRect(wx, wy, wx2 - wx, wy2 - wy, 14);
    else g.rect(wx, wy, wx2 - wx, wy2 - wy);
    g.fill();
  }

  g.lineJoin = g.lineCap = 'round';
  mmPath(g, 0, 1); g.closePath();
  g.strokeStyle = activeCircuit.id === 'salatiga-gp' ? 'rgba(34,255,136,0.22)' : 'rgba(0,210,190,0.22)';
  g.lineWidth = 7; g.stroke();
  g.strokeStyle = 'rgba(242,239,230,0.88)'; g.lineWidth = 2.6; g.stroke();

  if (TUN) {
    mmPath(g, TUN[0], TUN[1]);
    g.strokeStyle = 'rgba(255,176,32,0.9)'; g.lineWidth = 3.4; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
  }

  for (const [a, z] of DRZ) {
    mmPath(g, a, z);
    g.strokeStyle = 'rgba(34,255,136,0.95)'; g.lineWidth = 3.4; g.stroke();
  }

  const [sx0, sz0] = uToXY(startU), [sx1, sz1] = uToXY(startU + 0.004);
  const [cx, cy] = mm.tx(sx0, sz0);
  let dx = sx1 - sx0, dz = sz1 - sz0; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  g.strokeStyle = '#ff2d1a'; g.lineWidth = 2.8;
  g.beginPath(); g.moveTo(cx - dz * 6, cy + dx * 6); g.lineTo(cx + dz * 6, cy - dx * 6); g.stroke();

  g.font = '700 7px "Titillium Web", sans-serif'; g.fillStyle = 'rgba(242,239,230,0.58)';
  for (const lbl of activeCircuit.minimapLabels) {
    const pt = PTS[lbl.pointIndex];
    if (!pt) continue;
    const [x, y] = mm.tx(pt[0], pt[2]);
    g.fillText(lbl.label, x + lbl.ox, y + lbl.oy);
  }
  mm.base = b;
  setText(els.minimapLabel, `${activeCircuit.circuitTitle} - ${activeCircuit.lengthLabel}`);
}

export function setHudCircuit(circuitId = 'monaco-gp') {
  rebuildMinimapGeometry(circuitId);
  if (!els.minimap) els.minimap = $('minimap');
  if (!els.minimapLabel) els.minimapLabel = $('minimap-label');
  if (els.minimapLabel) els.minimapLabel.__v = null;
  mmSize();
}
function mmDraw(raceState, now) {
  if (!ensureMinimapCanvas()) return;
  const g = mm.ctx;
  g.setTransform(mm.dpr, 0, 0, mm.dpr, 0, 0);
  g.clearRect(0, 0, mm.w, mm.h);
  g.drawImage(mm.base, 0, 0, mm.w, mm.h);
  for (const e of raceState.standings) {
    const u = (((e.progress % 1) + 1) % 1 + startU) % 1;
    const [x, z] = uToXY(u); const [cx, cy] = mm.tx(x, z);
    if (e.isPlayer) {
      const pulse = 5.4 + Math.sin(now * 0.006) * 1.1;
      g.beginPath(); g.arc(cx, cy, pulse + 3, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(242,239,230,0.85)'; g.lineWidth = 1.6; g.stroke();
      const [ax, az] = uToXY(u + 0.003);
      let hx = ax - x, hz = az - z; const hl = Math.hypot(hx, hz) || 1;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (hx / hl) * 9, cy + (hz / hl) * 9);
      g.strokeStyle = '#f2efe6'; g.lineWidth = 2; g.stroke();
    }
    g.beginPath(); g.arc(cx, cy, e.isPlayer ? 4.4 : 3.2, 0, Math.PI * 2);
    g.fillStyle = e.color; g.shadowColor = e.color; g.shadowBlur = 7; g.fill(); g.shadowBlur = 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · WEB AUDIO — V6 turbo-hybrid engine, screech, impacts, UI tones
// ═══════════════════════════════════════════════════════════════════════════
let ctx = null, master = null, noiseBuf = null, pinkNoiseBuf = null, audioReady = false, muted = false;
let engine = null, screech = null, curb = null, scrape = null, rainLoop = null, shiftCutUntil = 0;
let latestCarState = null;
let prevGear = 1, prevDrs = false;

function makeNoise() {
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function makePinkNoise() {
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    d[i] = clamp((b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11, -1, 1);
    b6 = white * 0.115926;
  }
  return buf;
}
function buildEngine() {
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 0.7;
  const gain = ctx.createGain(); gain.gain.value = 0;
  filter.connect(gain); gain.connect(master);
  const layers = [[1, 'sawtooth', 0.5], [0.5, 'square', 0.2], [1.5, 'sawtooth', 0.17], [2.01, 'sawtooth', 0.11], [3.02, 'triangle', 0.06]];
  const oscs = layers.map(([mult, type, g]) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = 210 * mult;
    const og = ctx.createGain(); og.gain.value = g;
    o.connect(og); og.connect(filter); o.start();
    return { o, mult };
  });
  const turbo = ctx.createOscillator(); turbo.type = 'sine'; turbo.frequency.value = 1000;
  const tg = ctx.createGain(); tg.gain.value = 0;
  turbo.connect(tg); tg.connect(master); turbo.start();
  engine = { oscs, filter, gain, turbo, tg };
}
function buildLoops() {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.1;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(bp); bp.connect(g); g.connect(master); src.start();
  screech = { bp, g };
  const src2 = ctx.createBufferSource(); src2.buffer = noiseBuf; src2.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
  const g2 = ctx.createGain(); g2.gain.value = 0;
  src2.connect(lp); lp.connect(g2); g2.connect(master); src2.start();
  curb = { g: g2 };

  const scrapeSrc = ctx.createBufferSource(); scrapeSrc.buffer = noiseBuf; scrapeSrc.loop = true;
  const scrapeBp = ctx.createBiquadFilter(); scrapeBp.type = 'bandpass'; scrapeBp.frequency.value = 1850; scrapeBp.Q.value = 1.5;
  const crunchSrc = ctx.createBufferSource(); crunchSrc.buffer = pinkNoiseBuf || noiseBuf; crunchSrc.loop = true;
  const crunchBp = ctx.createBiquadFilter(); crunchBp.type = 'bandpass'; crunchBp.frequency.value = 420; crunchBp.Q.value = 1.25;
  const crunchMix = ctx.createGain(); crunchMix.gain.value = 0.7;
  const scrapeGain = ctx.createGain(); scrapeGain.gain.value = 0;
  scrapeSrc.connect(scrapeBp); scrapeBp.connect(scrapeGain);
  crunchSrc.connect(crunchBp); crunchBp.connect(crunchMix); crunchMix.connect(scrapeGain);
  scrapeGain.connect(master);
  scrapeSrc.start(); crunchSrc.start();
  scrape = { bp: scrapeBp, crunchBp, g: scrapeGain };

  // Continuous filtered pink-noise rain patter loop (modulated by weather & tunnel)
  const rainSrc = ctx.createBufferSource();
  rainSrc.buffer = pinkNoiseBuf || noiseBuf;
  rainSrc.loop = true;
  const rainBp = ctx.createBiquadFilter();
  rainBp.type = 'bandpass';
  rainBp.frequency.value = 1350;
  rainBp.Q.value = 0.55;
  const rainLp = ctx.createBiquadFilter();
  rainLp.type = 'lowpass';
  rainLp.frequency.value = 4200;
  const rainGain = ctx.createGain();
  rainGain.gain.value = 0;
  rainSrc.connect(rainBp);
  rainBp.connect(rainLp);
  rainLp.connect(rainGain);
  rainGain.connect(master);
  rainSrc.start();
  rainLoop = { bp: rainBp, lp: rainLp, g: rainGain };
}
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return true; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.18;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = makeNoise();
    pinkNoiseBuf = makePinkNoise();
    buildEngine(); buildLoops();
    audioReady = true;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  } catch { ctx = null; audioReady = false; return false; }
}
function burst({ type = 'lowpass', freq = 300, q = 0.8, gain = 0.3, dur = 0.25, sweepTo = null, delay = 0, usePink = false, dest = null }) {
  if (!audioReady || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource(); src.buffer = usePink && pinkNoiseBuf ? pinkNoiseBuf : noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f); f.connect(g); g.connect(dest || master);
  src.start(t); src.stop(t + dur + 0.03);
}
function tone(freq, dur = 0.15, gain = 0.12, delay = 0, type = 'sine', dest = null) {
  if (!audioReady || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(dest || master);
  o.start(t); o.stop(t + dur + 0.03);
}

// 1 · Opponent Proximity & Overtake Doppler Whoosh
export function playWhooshSound(relativeSpeed = 20, pan = 0) {
  if (!audioReady || !ctx || ctx.state !== 'running' || muted) return;
  const t = ctx.currentTime;
  const spd = clamp(Math.abs(relativeSpeed) / 42, 0.25, 1.25);
  const dur = clamp(0.54 - spd * 0.16, 0.28, 0.56);

  const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const p = clamp(pan, -0.95, 0.95);
  const side = Math.abs(p) > 0.08 ? Math.sign(p) : 1;
  const pStart = clamp(side * Math.max(0.45, Math.abs(p)), -0.95, 0.95);
  const pEnd = clamp(-pStart * 0.45, -0.65, 0.65);
  if (panner) {
    panner.pan.setValueAtTime(pStart, t);
    panner.pan.linearRampToValueAtTime(pEnd, t + dur);
    panner.connect(master);
  }
  const dest = panner || master;

  // Bandpass-filtered white/pink aerodynamic noise sweeping high -> low
  const airSrcW = ctx.createBufferSource(); airSrcW.buffer = noiseBuf;
  const airSrcP = ctx.createBufferSource(); airSrcP.buffer = pinkNoiseBuf || noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.65;
  bp.frequency.setValueAtTime(2400 + spd * 1500, t);
  bp.frequency.exponentialRampToValueAtTime(240 + spd * 110, t + dur);

  const airGain = ctx.createGain();
  airGain.gain.setValueAtTime(0.0001, t);
  airGain.gain.linearRampToValueAtTime(0.24 * spd, t + dur * 0.30);
  airGain.gain.exponentialRampToValueAtTime(0.0008, t + dur);

  const wMix = ctx.createGain(); wMix.gain.value = 0.52;
  const pMix = ctx.createGain(); pMix.gain.value = 0.68;
  airSrcW.connect(wMix); wMix.connect(bp);
  airSrcP.connect(pMix); pMix.connect(bp);
  bp.connect(airGain); airGain.connect(dest);
  airSrcW.start(t); airSrcW.stop(t + dur + 0.03);
  airSrcP.start(t); airSrcP.stop(t + dur + 0.03);

  // Brief Doppler pitch-dropping engine hum
  const engOsc = ctx.createOscillator();
  engOsc.type = 'sawtooth';
  engOsc.frequency.setValueAtTime(275 + spd * 155, t);
  engOsc.frequency.exponentialRampToValueAtTime(115 + spd * 40, t + dur);

  const engSub = ctx.createOscillator();
  engSub.type = 'triangle';
  engSub.frequency.setValueAtTime(138 + spd * 78, t);
  engSub.frequency.exponentialRampToValueAtTime(58 + spd * 20, t + dur);

  const engLp = ctx.createBiquadFilter();
  engLp.type = 'lowpass';
  engLp.frequency.setValueAtTime(980, t);
  engLp.frequency.exponentialRampToValueAtTime(280, t + dur);

  const engGain = ctx.createGain();
  engGain.gain.setValueAtTime(0.0001, t);
  engGain.gain.linearRampToValueAtTime(0.11 * spd, t + dur * 0.28);
  engGain.gain.exponentialRampToValueAtTime(0.0008, t + dur);

  engOsc.connect(engLp);
  engSub.connect(engLp);
  engLp.connect(engGain);
  engGain.connect(dest);
  engOsc.start(t); engOsc.stop(t + dur + 0.03);
  engSub.start(t); engSub.stop(t + dur + 0.03);
}

// 2 · Dynamic Collision Impact Sound (Barrier/Armco vs Car-to-Car)
export function playCollisionSound(impactIntensity = 0.5, isBarrier = true) {
  if (!audioReady || !ctx || ctx.state !== 'running' || muted) return;
  const t = ctx.currentTime;
  const hit = clamp(impactIntensity, 0.16, 1.0);

  if (isBarrier) {
    // Low-end Armco thud
    burst({ type: 'lowpass', freq: 230, q: 0.9, gain: 0.44 * hit, dur: 0.27, usePink: true });
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(138, t);
    sub.frequency.exponentialRampToValueAtTime(34, t + 0.24);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.45 * hit, t);
    subG.gain.exponentialRampToValueAtTime(0.0008, t + 0.27);
    sub.connect(subG); subG.connect(master);
    sub.start(t); sub.stop(t + 0.29);

    // Crisp metallic Armco clank (inharmonic ring partials)
    const clank1 = ctx.createOscillator(); clank1.type = 'triangle';
    clank1.frequency.setValueAtTime(790, t);
    clank1.frequency.exponentialRampToValueAtTime(510, t + 0.16);
    const clank2 = ctx.createOscillator(); clank2.type = 'square';
    clank2.frequency.setValueAtTime(1240, t);
    clank2.frequency.exponentialRampToValueAtTime(840, t + 0.14);
    const clankBp = ctx.createBiquadFilter();
    clankBp.type = 'bandpass'; clankBp.frequency.value = 1050; clankBp.Q.value = 2.2;
    const clankG = ctx.createGain();
    clankG.gain.setValueAtTime(0.18 * hit, t);
    clankG.gain.exponentialRampToValueAtTime(0.0008, t + 0.19);
    clank1.connect(clankBp); clank2.connect(clankBp);
    clankBp.connect(clankG); clankG.connect(master);
    clank1.start(t); clank1.stop(t + 0.21);
    clank2.start(t); clank2.stop(t + 0.21);

    // Brief metallic scraping noise burst
    burst({ type: 'bandpass', freq: 1850, q: 2.0, gain: 0.24 * hit, dur: 0.23, sweepTo: 620 });
  } else {
    // Car-to-car contact: hollow carbon-fiber thump + crisp crunch
    burst({ type: 'lowpass', freq: 340, q: 1.1, gain: 0.34 * hit, dur: 0.19, usePink: true });
    const thump = ctx.createOscillator(); thump.type = 'triangle';
    thump.frequency.setValueAtTime(165, t);
    thump.frequency.exponentialRampToValueAtTime(46, t + 0.18);
    const thumpG = ctx.createGain();
    thumpG.gain.setValueAtTime(0.38 * hit, t);
    thumpG.gain.exponentialRampToValueAtTime(0.0008, t + 0.20);
    thump.connect(thumpG); thumpG.connect(master);
    thump.start(t); thump.stop(t + 0.22);

    // Carbon-fiber transient crunch + secondary composite crackle
    burst({ type: 'bandpass', freq: 2350, q: 1.3, gain: 0.32 * hit, dur: 0.13, sweepTo: 920 });
    burst({ type: 'bandpass', freq: 2900, q: 1.6, gain: 0.20 * hit, dur: 0.08, sweepTo: 1200, delay: 0.028 });
  }
}

export function playRepairSound() {
  if (!audioReady || !ctx) return;
  tone(880, 0.12, 0.14, 0, 'triangle');
  tone(1174.66, 0.14, 0.14, 0.06, 'triangle');
  tone(1567.98, 0.22, 0.15, 0.12, 'triangle');
  burst({ type: 'highpass', freq: 2400, q: 2.0, gain: 0.07, dur: 0.06 });
}

export function playThunderSound(intensity = 1.0) {
  if (!audioReady || !ctx || ctx.state !== 'running' || muted) return;
  const t = ctx.currentTime;
  const str = clamp(intensity, 0.4, 1.25);

  // Sharp cloud-to-ground crack transient
  burst({
    type: 'bandpass',
    freq: 940,
    q: 0.72,
    gain: 0.22 * str,
    dur: 0.28,
    sweepTo: 180,
    usePink: false,
  });

  // Deep rolling lowpass-swept pink-noise thunderclap + echo swells
  const rumbles = [
    { delay: 0.04, freqStart: 420, freqEnd: 58, gain: 0.42 * str, dur: 1.9 },
    { delay: 0.36, freqStart: 290, freqEnd: 48, gain: 0.32 * str, dur: 2.3 },
    { delay: 0.92, freqStart: 220, freqEnd: 42, gain: 0.21 * str, dur: 2.1 },
  ];
  for (const r of rumbles) {
    const st = t + r.delay;
    const src = ctx.createBufferSource();
    src.buffer = pinkNoiseBuf || noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.1;
    lp.frequency.setValueAtTime(r.freqStart, st);
    lp.frequency.exponentialRampToValueAtTime(r.freqEnd, st + r.dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, st);
    g.gain.linearRampToValueAtTime(r.gain, st + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0008, st + r.dur);

    src.connect(lp);
    lp.connect(g);
    g.connect(master);
    src.start(st);
    src.stop(st + r.dur + 0.05);
  }

  // Sub-bass pressure thump
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(86, t + 0.03);
  sub.frequency.exponentialRampToValueAtTime(28, t + 1.1);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.0001, t + 0.03);
  sg.gain.linearRampToValueAtTime(0.26 * str, t + 0.08);
  sg.gain.exponentialRampToValueAtTime(0.0008, t + 1.15);
  sub.connect(sg);
  sg.connect(master);
  sub.start(t + 0.03);
  sub.stop(t + 1.18);
}

// 3 · Game Over / DNF Audio (immediate engine cut, power-down spin-down + 3-note brass defeat chord)
const victoryLoop = {
  active: false,
  timer: 0,
  startTimeout: 0,
  step: 0,
  nextTime: 0,
  gainNode: null,
  nodes: new Set(),
};

export function stopVictoryMusic() {
  if (victoryLoop.startTimeout) {
    clearTimeout(victoryLoop.startTimeout);
    victoryLoop.startTimeout = 0;
  }
  if (victoryLoop.timer) {
    clearInterval(victoryLoop.timer);
    victoryLoop.timer = 0;
  }
  victoryLoop.active = false;
  if (ctx && victoryLoop.gainNode) {
    const t = ctx.currentTime;
    try {
      victoryLoop.gainNode.gain.cancelScheduledValues(t);
      victoryLoop.gainNode.gain.setTargetAtTime(0.0001, t, 0.025);
    } catch {}
  }
  for (const n of victoryLoop.nodes) {
    try { n.stop(ctx ? ctx.currentTime + 0.08 : 0); } catch {}
  }
  victoryLoop.nodes.clear();
  victoryLoop.gainNode = null;
}

export function playGameOverSound() {
  dnfSoundDone = true;
  stopVictoryMusic();
  if (!audioReady || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t = ctx.currentTime;

  // Immediately silence active engine revving, turbo, tire screech, and curb rumble
  if (engine) {
    engine.gain.gain.cancelScheduledValues(t);
    engine.gain.gain.setTargetAtTime(0, t, 0.015);
    engine.tg.gain.cancelScheduledValues(t);
    engine.tg.gain.setTargetAtTime(0, t, 0.015);
  }
  if (screech) screech.g.gain.setTargetAtTime(0, t, 0.02);
  if (curb) curb.g.gain.setTargetAtTime(0, t, 0.02);
  if (scrape) scrape.g.gain.setTargetAtTime(0, t, 0.02);
  if (rainLoop) rainLoop.g.gain.setTargetAtTime(0, t, 0.12);

  // Dramatic engine power-down spin-down
  const spinFilter = ctx.createBiquadFilter();
  spinFilter.type = 'lowpass';
  spinFilter.frequency.setValueAtTime(1400, t);
  spinFilter.frequency.exponentialRampToValueAtTime(130, t + 0.92);

  const spinGain = ctx.createGain();
  spinGain.gain.setValueAtTime(0.24, t);
  spinGain.gain.exponentialRampToValueAtTime(0.0008, t + 0.95);
  spinFilter.connect(spinGain);
  spinGain.connect(master);

  const spin1 = ctx.createOscillator(); spin1.type = 'sawtooth';
  spin1.frequency.setValueAtTime(260, t);
  spin1.frequency.exponentialRampToValueAtTime(34, t + 0.92);
  const spin2 = ctx.createOscillator(); spin2.type = 'sine';
  spin2.frequency.setValueAtTime(130, t);
  spin2.frequency.exponentialRampToValueAtTime(24, t + 0.92);
  spin1.connect(spinFilter);
  spin2.connect(spinFilter);
  spin1.start(t); spin1.stop(t + 0.96);
  spin2.start(t); spin2.stop(t + 0.96);

  // Turbo whine power-down
  const turboDown = ctx.createOscillator(); turboDown.type = 'sine';
  turboDown.frequency.setValueAtTime(1750, t);
  turboDown.frequency.exponentialRampToValueAtTime(210, t + 0.65);
  const turboG = ctx.createGain();
  turboG.gain.setValueAtTime(0.055, t);
  turboG.gain.exponentialRampToValueAtTime(0.0008, t + 0.66);
  turboDown.connect(turboG); turboG.connect(master);
  turboDown.start(t); turboDown.stop(t + 0.68);

  // Somber descending 3-note brass/synth defeat chord progression (D4 -> C4 -> G3 minor cadence)
  const defeatNotes = [
    { lead: 293.66, bass: 146.83, harm: 220.00, delay: 0.38, dur: 0.48 },
    { lead: 261.63, bass: 130.81, harm: 196.00, delay: 0.78, dur: 0.50 },
    { lead: 196.00, bass: 98.00,  harm: 233.08, delay: 1.18, dur: 0.95 },
  ];
  for (const n of defeatNotes) {
    const nt = t + n.delay;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1150, nt);
    lp.frequency.exponentialRampToValueAtTime(380, nt + n.dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, nt);
    g.gain.linearRampToValueAtTime(0.14, nt + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0008, nt + n.dur);
    lp.connect(g); g.connect(master);

    for (const [freq, type, det] of [
      [n.lead, 'sawtooth', -5],
      [n.lead, 'sawtooth', 5],
      [n.harm, 'triangle', 0],
      [n.bass, 'triangle', 0],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, nt);
      if (det) o.detune.value = det;
      o.connect(lp);
      o.start(nt);
      o.stop(nt + n.dur + 0.04);
    }
  }
}

export function playDnfSound() {
  playGameOverSound();
}

// 4 & 5 · Race Finish Fanfare + Podium Victory Synth-Orchestral Melody (1st-3rd) / Completion Jingle (4th-8th)
function scheduleVictoryVoice(freq, startTime, dur, type, gainVal, cutoffStart, cutoffEnd, bus) {
  if (!ctx || !bus) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, startTime);

  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(cutoffStart, startTime);
  f.frequency.exponentialRampToValueAtTime(Math.max(120, cutoffEnd), startTime + dur);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, startTime);
  g.gain.linearRampToValueAtTime(gainVal, startTime + 0.016);
  g.gain.exponentialRampToValueAtTime(0.0008, startTime + dur);

  o.connect(f);
  f.connect(g);
  g.connect(bus);
  victoryLoop.nodes.add(o);
  o.onended = () => victoryLoop.nodes.delete(o);
  o.start(startTime);
  o.stop(startTime + dur + 0.03);
}

function startPodiumVictoryMusic() {
  stopVictoryMusic();
  if (!audioReady || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.85, ctx.currentTime);
  bus.connect(master);
  victoryLoop.gainNode = bus;
  victoryLoop.active = true;
  victoryLoop.step = 0;

  // 132 BPM -> eighth-note duration = 0.22727s, 32-step celebratory 8-bar loop (C -> Am -> F -> G)
  const STEP_SEC = 60 / 132 / 2;
  const CHORDS = [
    [261.63, 329.63, 392.00, 523.25], // C major
    [220.00, 261.63, 329.63, 440.00], // A minor
    [174.61, 220.00, 261.63, 349.23], // F major
    [196.00, 246.94, 293.66, 392.00], // G major
  ];
  const BASS = [130.81, 110.00, 87.31, 98.00];
  // Triumphant brassy synth lead melody (null = sustain/rest)
  const LEAD = [
    783.99, null, 659.25, 783.99, null, null, 1046.50, null,
    880.00, null, null, 783.99, 659.25, null, null, null,
    698.46, null, 880.00, 1046.50, null, null, 880.00, null,
    783.99, null, 987.77, 1174.66, null, null, 987.77, 783.99,
  ];
  const LEAD_DUR = [
    1.7, 0, 0.9, 2.4, 0, 0, 1.7, 0,
    2.4, 0, 0, 0.9, 3.0, 0, 0, 0,
    1.7, 0, 0.9, 2.4, 0, 0, 1.7, 0,
    1.7, 0, 0.9, 2.5, 0, 0, 0.9, 0.9,
  ];

  const scheduleStep = (stepIdx, when) => {
    if (!victoryLoop.active || !ctx) return;
    const barPair = (stepIdx >> 3) % 4;
    const chord = CHORDS[barPair];
    const bassFreq = BASS[barPair];

    // Sparkling major-key arpeggio
    const arpFreq = chord[stepIdx % 4] * 2;
    scheduleVictoryVoice(arpFreq, when, STEP_SEC * 0.85, 'triangle', 0.055, 3600, 1400, bus);

    // Rhythmic octave bassline
    const bFreq = stepIdx % 2 === 0 ? bassFreq : bassFreq * 2;
    scheduleVictoryVoice(bFreq, when, STEP_SEC * 0.88, stepIdx % 2 === 0 ? 'triangle' : 'sawtooth', stepIdx % 2 === 0 ? 0.13 : 0.06, 620, 210, bus);

    // Brassy synth-orchestral lead + harmonic third
    const leadFreq = LEAD[stepIdx];
    if (leadFreq) {
      const dur = STEP_SEC * LEAD_DUR[stepIdx];
      scheduleVictoryVoice(leadFreq, when, dur, 'sawtooth', 0.085, 2900, 950, bus);
      scheduleVictoryVoice(leadFreq * 1.004, when, dur, 'sawtooth', 0.065, 2700, 900, bus);
      scheduleVictoryVoice(leadFreq * 0.5, when, dur, 'triangle', 0.06, 1600, 600, bus);
    }

    // Celebratory beat pulse (kick on downbeats, bright shimmer on offbeats)
    if (stepIdx % 4 === 0) {
      const kick = ctx.createOscillator(); kick.type = 'sine';
      kick.frequency.setValueAtTime(128, when);
      kick.frequency.exponentialRampToValueAtTime(42, when + 0.11);
      const kg = ctx.createGain();
      kg.gain.setValueAtTime(0.18, when);
      kg.gain.exponentialRampToValueAtTime(0.0008, when + 0.14);
      kick.connect(kg); kg.connect(bus);
      victoryLoop.nodes.add(kick);
      kick.onended = () => victoryLoop.nodes.delete(kick);
      kick.start(when); kick.stop(when + 0.16);
    } else if (stepIdx % 2 === 1 && noiseBuf) {
      const hat = ctx.createBufferSource(); hat.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.032, when);
      hg.gain.exponentialRampToValueAtTime(0.0008, when + 0.06);
      hat.connect(hp); hp.connect(hg); hg.connect(bus);
      victoryLoop.nodes.add(hat);
      hat.onended = () => victoryLoop.nodes.delete(hat);
      hat.start(when); hat.stop(when + 0.08);
    }
  };

  victoryLoop.nextTime = ctx.currentTime + 0.03;
  const tickScheduler = () => {
    if (!victoryLoop.active || !ctx) return;
    while (victoryLoop.nextTime < ctx.currentTime + 0.16) {
      scheduleStep(victoryLoop.step, victoryLoop.nextTime);
      victoryLoop.step = (victoryLoop.step + 1) % 32;
      victoryLoop.nextTime += STEP_SEC;
    }
  };
  tickScheduler();
  victoryLoop.timer = window.setInterval(tickScheduler, 50);
}

export function playFinishSound(finalPosition = 1) {
  fanfareDone = true;
  stopVictoryMusic();
  if (!audioReady || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t = ctx.currentTime;

  // Bright chequered-flag air-horn / chime fanfare (plays for all finishers)
  const hornChord = [523.25, 659.25, 783.99];
  for (const [delay, dur] of [[0, 0.20], [0.22, 0.48]]) {
    const ht = t + delay;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, ht);
    lp.frequency.exponentialRampToValueAtTime(1400, ht + dur);
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, ht);
    hg.gain.linearRampToValueAtTime(0.11, ht + 0.015);
    hg.gain.exponentialRampToValueAtTime(0.0008, ht + dur);
    lp.connect(hg); hg.connect(master);
    for (const freq of hornChord) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, ht);
      o.connect(lp); o.start(ht); o.stop(ht + dur + 0.03);
    }
  }
  tone(1046.50, 0.35, 0.11, 0.02, 'triangle');
  tone(1567.98, 0.50, 0.10, 0.24, 'triangle');

  if (finalPosition >= 1 && finalPosition <= 3) {
    // 1st-3rd Podium Finish: launch celebratory F1 Podium Victory Synth-Orchestral Melody
    victoryLoop.startTimeout = window.setTimeout(() => {
      victoryLoop.startTimeout = 0;
      startPodiumVictoryMusic();
    }, 640);
  } else {
    // 4th-8th: pleasant race-completion resolution jingle without podium anthem loop
    const notes = [523.25, 587.33, 659.25, 783.99];
    notes.forEach((f, i) => tone(f, i === 3 ? 0.65 : 0.22, 0.11, 0.55 + i * 0.13, 'triangle'));
    tone(261.63, 0.85, 0.09, 0.55, 'sine');
    tone(392.00, 0.85, 0.07, 0.55, 'sine');
  }
}

export function updateAudio(carState) {
  if (carState) latestCarState = carState;
  if (!audioReady || !ctx || !carState) return;
  const t = ctx.currentTime;
  const isDead = !!carState.isDead;
  const rpm = carState.rpm || 4200;
  const f = Math.max(30, (rpm / 60) * 3);
  const rpmFrac = clamp((rpm - 4200) / 8100, 0, 1);
  const thr = isDead ? 0 : (carState.throttle ?? 0);
  const speedFrac = clamp((carState.speedKmh || 0) / 340, 0, 1);

  for (const L of engine.oscs) L.o.frequency.setTargetAtTime(f * L.mult, t, 0.03);
  engine.filter.frequency.setTargetAtTime(500 + rpmFrac * 5200 + thr * 1200, t, 0.05);
  let vol = isDead ? 0 : (0.09 + thr * 0.17 + speedFrac * 0.05);
  if (carState.gear !== prevGear) {
    if (carState.gear > prevGear) burst({ type: 'bandpass', freq: 420, q: 1.2, gain: 0.1, dur: 0.07 });
    shiftCutUntil = t + 0.09;
    prevGear = carState.gear;
  }
  if (t < shiftCutUntil) vol *= 0.3;
  engine.gain.gain.setTargetAtTime(vol, t, 0.06);
  engine.turbo.frequency.setTargetAtTime(900 + rpmFrac * 2800, t, 0.08);
  engine.tg.gain.setTargetAtTime(isDead ? 0 : thr * rpmFrac * 0.035, t, 0.1);

  const slide = !isDead && carState.isSliding ? clamp((carState.lateralG || 2) / 5, 0.2, 1) : 0;
  screech.g.gain.setTargetAtTime(slide * 0.16 * (0.4 + speedFrac), t, 0.05);
  screech.bp.frequency.setTargetAtTime(1100 + speedFrac * 900, t, 0.1);
  curb.g.gain.setTargetAtTime(!isDead && carState.onCurb && carState.speedKmh > 20 ? 0.07 : 0, t, 0.04);

  const scrapeLvl = !isDead ? clamp(carState.scrapeIntensity || 0, 0, 1) : 0;
  if (scrape) {
    scrape.g.gain.setTargetAtTime(scrapeLvl > 0.01 ? scrapeLvl * 0.26 : 0, t, scrapeLvl > 0.01 ? 0.025 : 0.05);
    scrape.bp.frequency.setTargetAtTime(1450 + speedFrac * 1100 + scrapeLvl * 550, t, 0.06);
    scrape.crunchBp.frequency.setTargetAtTime(340 + scrapeLvl * 260, t, 0.06);
  }

  if (carState.drsActive && !prevDrs) burst({ type: 'bandpass', freq: 600, q: 1.4, gain: 0.08, dur: 0.28, sweepTo: 3000 });
  prevDrs = !!carState.drsActive;

  if (rainLoop) {
    const rainAmt = !isDead ? clamp(carState.rainIntensity || 0, 0, 1) : 0;
    const tunnelMuffle = carState.inTunnel ? 0.18 : 1.0;
    const targetRainGain = rainAmt > 0.01 ? (0.028 + rainAmt * 0.115) * tunnelMuffle : 0;
    rainLoop.g.gain.setTargetAtTime(targetRainGain, t, 0.16);
    rainLoop.lp.frequency.setTargetAtTime(
      carState.inTunnel ? 900 : 2100 + rainAmt * 2600,
      t,
      0.16
    );
    rainLoop.bp.frequency.setTargetAtTime(
      carState.inTunnel ? 500 : 1050 + rainAmt * 550,
      t,
      0.16
    );
  }
}

function setMuted(m) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.05);
  if (els.audioToggle) {
    els.audioToggle.classList.toggle('muted', m);
    els.audioToggle.setAttribute('aria-pressed', String(!m));
  }
  setText(els.audioIcon, m ? '🔇' : '🔊');
  setText(els.audioText, m ? 'MUTED' : 'AUDIO ON');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · HUD — tower, timers, gantry, telemetry, announcements, podium
// ═══════════════════════════════════════════════════════════════════════════
let prevLights = 0, prevPhase = null, prevLap = 1, prevBest = null, prevPos = 8;
let posToastAt = 0, announceTimer = 0, bootDone = false, firstFrame = false;
let modalOpen = false, dnfOpen = false, finishSig = '', fanfareDone = false, dnfSoundDone = false;

export function notifyRepairPickup(newHealth) {
  playRepairSound();
  announce('REPAIR +20%', `CAR INTEGRITY ${Math.round(newHealth)}%`, 'green', 1200);
}

function announce(text, sub = '', toneCls = '', ms = 1800) {
  if (!els.announce) return;
  clearTimeout(announceTimer);
  setText(els.announceText, text); setText(els.announceSub, sub);
  els.announce.className = 'show' + (toneCls ? ' ' + toneCls : '');
  if (ms > 0) announceTimer = setTimeout(() => { if (els.announce) els.announce.className = ''; }, ms);
}
function hideBoot() {
  if (bootDone) return;
  bootDone = true; firstFrame = true;
  if (els.boot) els.boot.classList.add('done');
}

function updateTelemetry(cs) {
  if (!els.speed || !els.gear) return;
  setText(els.speed, String(Math.round(cs.speedKmh || 0)));
  if (String(cs.gear) !== els.gear.__v) {
    setText(els.gear, String(cs.gear));
    els.gear.animate?.([{ transform: 'scale(1.3)', color: '#fff' }, { transform: 'scale(1)' }], { duration: 170, easing: 'ease-out' });
  }
  const frac = clamp(((cs.rpm || 4200) - 4200) / 8100, 0, 1);
  const lit = Math.round(frac * 16);
  for (let i = 0; i < leds.length; i++) leds[i].classList.toggle('lit', i < lit);
  if (els.rpmBar) els.rpmBar.classList.toggle('shift', (cs.rpm || 0) > 11700);
  if (els.drs) {
    if (cs.drsActive) { els.drs.className = 'active'; setText(els.drs, 'DRS ACTIVE'); }
    else if (cs.drsAvailable) { els.drs.className = 'ready'; setText(els.drs, 'DRS READY'); }
    else { els.drs.className = ''; setText(els.drs, 'DRS'); }
  }
  if (els.throttle) els.throttle.style.width = `${Math.round((cs.throttle || 0) * 100)}%`;
  if (els.brake) els.brake.style.width = `${Math.round((cs.brake || 0) * 100)}%`;

  // Health / Car Integrity bar
  const hp = clamp(Math.round(cs.health ?? 100), 0, 100);
  if (els.healthValue) setText(els.healthValue, `${hp}%`);
  if (els.healthFill) els.healthFill.style.width = `${hp}%`;
  if (els.healthWrap) {
    els.healthWrap.classList.toggle('warn', hp >= 35 && hp < 70);
    els.healthWrap.classList.toggle('critical', hp > 0 && hp < 35);
    els.healthWrap.classList.toggle('dead', hp <= 0);
    els.healthWrap.classList.toggle('repairing', (cs.repairFlash || 0) > 0.1);
  }

  if (els.flash) {
    const repairOp = (cs.repairFlash || 0) * 0.42;
    const hitOp = clamp((cs.hitIntensity || 0) * 0.6, 0, 0.55);
    const useHeal = repairOp > hitOp;
    els.flash.classList.toggle('heal', useHeal);
    els.flash.style.opacity = String(useHeal ? repairOp : hitOp);
  }
}

function updateTower(rs) {
  for (let i = 0; i < towerRows.length; i++) {
    const r = towerRows[i], e = rs.standings[i];
    if (!e) { r.row.style.display = 'none'; continue; }
    r.row.style.display = '';
    setText(r.pos, String(i + 1));
    if (r.badge.__c !== e.color) { r.badge.__c = e.color; r.badge.style.background = e.color; r.badge.style.color = e.color; }
    setText(r.code, code3(e.name));
    setText(r.team, e.team);
    setText(r.gap, e.finished && i > 0 ? e.gapText : (i === 0 ? 'LEADER' : e.gapText));
    r.row.classList.toggle('player', e.isPlayer);
    r.row.classList.toggle('leader', i === 0);
    r.row.classList.toggle('finished', e.finished);
    r.drs.classList.toggle('on', !!e.drsActive);
    if (r.lastDriver && r.lastDriver !== e.name) {
      r.row.animate?.([{ background: 'rgba(242,239,230,0.22)' }, { background: 'transparent' }], { duration: 420 });
    }
    r.lastDriver = e.name;
  }
  setText(els.towerLaps, `${rs.totalLaps} LAPS`);
}

function updateLapPanel(rs) {
  setText(els.lapCurrent, String(rs.playerLap));
  setText(els.lapTotal, String(rs.totalLaps));
  if (els.lapCount) els.lapCount.classList.toggle('final', rs.playerLap === rs.totalLaps && !rs.isFinished);
  setText(els.lapTime, fmtTime(rs.currentLapTime));
  setText(els.bestTime, fmtTime(rs.bestLapTime));
  setText(els.lastTime, fmtTime(rs.lastLapTime));
  let overall = Infinity;
  for (const e of rs.standings) if (e.bestLapTime != null && e.bestLapTime < overall) overall = e.bestLapTime;
  if (els.bestTime) els.bestTime.classList.toggle('overall', rs.bestLapTime != null && rs.bestLapTime <= overall);
  if (!els.checkpoint || !els.checkpoint.isConnected) els.checkpoint = $('checkpoint-name');
  setText(els.checkpoint, (rs.checkpointName || 'START / FINISH').toUpperCase());

  for (let i = 0; i < gantryLights.length; i++) gantryLights[i].classList.toggle('on', i < rs.startLights);
  if (els.gantryStatus) {
    if (rs.phase === 'LIGHTS') {
      setText(els.gantryStatus, rs.startLights >= 5 ? 'HOLD…' : 'START SEQUENCE');
      els.gantryStatus.className = '';
      setText(els.sessionLabel, 'GRID');
    } else if (rs.phase === 'FINISHED') {
      setText(els.gantryStatus, 'CHEQUERED FLAG');
      els.gantryStatus.className = 'flag';
      setText(els.sessionLabel, 'RESULT');
    } else {
      setText(els.gantryStatus, 'GREEN FLAG');
      els.gantryStatus.className = 'go';
      setText(els.sessionLabel, 'RACE');
    }
  }
}

function updateEvents(rs, now) {
  if (rs.phase === 'LIGHTS') {
    if (prevPhase !== 'LIGHTS') {
      prevBest = null;
      prevPos = rs.playerPosition;
      posToastAt = 0;
    }
    if (!rs.waitingToStart) {
      if (rs.startLights > prevLights) tone(660, 0.14, 0.12);
      announce(activeCircuit.gpTitle, 'STREET CIRCUIT CHALLENGE · 3 LAPS · 8 CARS', '', 0);
    } else if (els.announce) {
      els.announce.className = '';
    }
    els.hint?.classList.remove('dim');
  } else if (prevPhase === 'LIGHTS' && rs.phase === 'RACING') {
    announce('LIGHTS OUT', 'GO · GO · GO', 'green', 1500);
    tone(990, 0.4, 0.16); tone(1320, 0.5, 0.12, 0.05);
    els.hint?.classList.add('dim');
  }
  if (rs.playerLap > prevLap && !rs.isFinished) {
    if (rs.playerLap === rs.totalLaps) {
      announce('FINAL LAP', 'PUSH NOW', 'purple', 2200);
      tone(880, 0.2, 0.1); tone(1174, 0.3, 0.1, 0.12);
    } else {
      announce(`LAP ${rs.playerLap} / ${rs.totalLaps}`, '', '', 1500);
      tone(760, 0.14, 0.08);
    }
  }
  if (rs.bestLapTime != null && (prevBest == null || rs.bestLapTime < prevBest - 0.001)) {
    if (prevBest != null || rs.playerLap > 1) {
      announce('PERSONAL BEST', fmtTime(rs.bestLapTime), 'purple', 2200);
      tone(880, 0.16, 0.1); tone(1174, 0.26, 0.1, 0.1);
    }
    prevBest = rs.bestLapTime;
  }
  if (rs.phase === 'RACING' && !rs.isFinished && rs.playerPosition < prevPos && now - posToastAt > 3000) {
    announce(`P${rs.playerPosition}`, 'OVERTAKE', 'green', 1100);
    posToastAt = now;
  }
  prevLights = rs.startLights; prevPhase = rs.phase; prevLap = rs.playerLap; prevPos = rs.playerPosition;
}

function renderFinish(rs) {
  const sig = rs.standings.map(e => `${e.name}${e.finished ? 1 : 0}`).join('|') + rs.playerPosition;
  if (sig === finishSig) return;
  finishSig = sig;
  const podiumOrder = [rs.standings[1], rs.standings[0], rs.standings[2]];
  const cls = ['p2', 'p1', 'p3'];
  if (els.podium) {
    els.podium.innerHTML = podiumOrder.map((e, i) => e ? `
      <div class="podium-col ${cls[i]}">
        <div class="podium-driver" style="color:${e.color}">${e.name}</div>
        <div class="podium-team">${e.team}</div>
        <div class="podium-gap">${e.position === 1 ? fmtTime(e.finishTime) : e.gapText}</div>
        <div class="podium-block">${e.position}</div>
      </div>` : '').join('');
  }
  if (els.finishRows) {
    els.finishRows.innerHTML = rs.standings.map(e => `
      <div class="frow${e.isPlayer ? ' player' : ''}">
        <span class="fpos">${e.position}</span>
        <span class="fbadge" style="background:${e.color}"></span>
        <span class="fname">${e.name}<small>${e.team}</small></span>
        <span class="fbest">${fmtTime(e.bestLapTime)}</span>
        <span class="fgap${e.finished ? ' done' : ''}">${e.finished ? (e.position === 1 ? 'WINNER' : e.gapText) : 'RACING…'}</span>
      </div>`).join('');
  }
  const p = rs.playerPosition;
  setText(els.finishTitle, p === 1 ? 'VICTORY!' : `P${p} — RACE COMPLETE`);
  els.card?.classList.toggle('win', p === 1);
  const me = rs.standings.find(e => e.isPlayer);
  setText(els.finishSub, `${activeCircuit.circuitTitle} · ${rs.totalLaps} LAPS · BEST ${fmtTime(me && me.bestLapTime)}`);
}
function openFinish(rs) {
  modalOpen = true; finishSig = '';
  renderFinish(rs);
  els.modal?.classList.add('open');
  if (els.confetti) {
    els.confetti.innerHTML = '';
    if (rs.playerPosition === 1) {
      const colors = ['#d8b24a', '#e10600', '#f2efe6', '#00d2be', '#22ff88'];
      for (let i = 0; i < 16; i++) {
        const s = document.createElement('i');
        s.style.left = `${Math.random() * 100}%`;
        s.style.background = colors[i % colors.length];
        s.style.animationDuration = `${2.4 + Math.random() * 2.4}s`;
        s.style.animationDelay = `${Math.random() * 1.6}s`;
        els.confetti.appendChild(s);
      }
    }
  }
  if (!fanfareDone) {
    playFinishSound(rs.playerPosition);
  }
}
function openDnf(rs) {
  dnfOpen = true;
  setText(els.dnfLap, `LAP ${rs.playerLap} / ${rs.totalLaps}`);
  setText(els.dnfTime, fmtTime(rs.raceTime || 0));
  setText(els.dnfPos, `P${rs.playerPosition || 1}`);
  els.dnfModal?.classList.add('open');
  if (!dnfSoundDone) {
    playGameOverSound();
  }
}
function closeDnf() {
  dnfOpen = false;
  dnfSoundDone = false;
  els.dnfModal?.classList.remove('open');
}
function closeFinish() {
  modalOpen = false; fanfareDone = false; finishSig = '';
  stopVictoryMusic();
  els.modal?.classList.remove('open');
  if (els.confetti) els.confetti.innerHTML = '';
}
function requestRestart() {
  initAudio();
  stopVictoryMusic();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR', key: 'r', bubbles: true }));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · CONTRACT EXPORTS — initHud(), updateHUD(raceState)
// ═══════════════════════════════════════════════════════════════════════════
export function updateHUD(raceState) {
  hideBoot();
  const now = performance.now();
  if (latestCarState) updateTelemetry(latestCarState);
  if (!raceState) return;
  updateTower(raceState);
  updateLapPanel(raceState);
  updateEvents(raceState, now);
  mmDraw(raceState, now);

  const isDead = !!(latestCarState && latestCarState.isDead);
  if (isDead) {
    if (modalOpen) closeFinish();
    if (!dnfOpen) openDnf(raceState);
  } else {
    if (dnfOpen) closeDnf();
    if (raceState.isFinished) {
      if (!modalOpen) openFinish(raceState);
      else renderFinish(raceState);
    } else if (modalOpen) closeFinish();
  }
}

export function initHud() {
  els = {
    boot: $('boot'), bootNote: $('boot-note'), bootRetry: $('boot-retry'),
    towerRows: $('tower-rows'), towerLaps: $('tower-laps'),
    lapCurrent: $('lap-current'), lapTotal: $('lap-total'), lapCount: $('lap-count'),
    lapTime: $('lap-time'), bestTime: $('best-time'), lastTime: $('last-time'),
    gantry: $('gantry'), gantryStatus: $('gantry-status'), sessionLabel: $('session-label'),
    audioToggle: $('audio-toggle'), audioIcon: $('audio-icon'), audioText: $('audio-text'),
    minimap: $('minimap'), minimapLabel: $('minimap-label'), checkpoint: $('checkpoint-name'),
    rpmBar: $('rpm-bar'), gear: $('gear-value'), speed: $('speed-value'), drs: $('drs-badge'),
    throttle: $('throttle-bar'), brake: $('brake-bar'),
    healthWrap: $('health-wrap'), healthValue: $('health-value'), healthFill: $('health-fill'),
    hint: $('controls-hint'), flash: $('flash'),
    announce: $('announce'), announceText: $('announce-text'), announceSub: $('announce-sub'),
    modal: $('finish-modal'), card: $('finish-card'), finishTitle: $('finish-title'),
    finishSub: $('finish-sub'), podium: $('podium'), finishRows: $('finish-rows'),
    raceAgain: $('race-again'), confetti: $('confetti'),
    dnfModal: $('gameover-modal'), dnfLap: $('dnf-lap'), dnfTime: $('dnf-time'), dnfPos: $('dnf-pos'),
    dnfRaceAgain: $('dnf-race-again'),
  };

  prevLights = 0; prevPhase = null; prevLap = 1; prevBest = null; prevPos = 8;
  posToastAt = 0; bootDone = false; firstFrame = false;
  modalOpen = false; dnfOpen = false; finishSig = ''; fanfareDone = false; dnfSoundDone = false;

  towerRows = [];
  if (els.towerRows) {
    els.towerRows.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const row = document.createElement('div');
      row.className = 'trow';
      row.innerHTML = `<span class="tpos"></span><span class="tbadge"></span><span class="tcode"></span><span class="tteam"></span><span style="display:flex;align-items:center;gap:6px"><span class="tdrs"></span><span class="tgap"></span></span>`;
      els.towerRows.appendChild(row);
      towerRows.push({
        row, pos: row.querySelector('.tpos'), badge: row.querySelector('.tbadge'),
        code: row.querySelector('.tcode'), team: row.querySelector('.tteam'),
        gap: row.querySelector('.tgap'), drs: row.querySelector('.tdrs'), lastDriver: '',
      });
    }
  }

  leds = [];
  if (els.rpmBar) {
    els.rpmBar.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const d = document.createElement('div');
      d.className = 'led ' + (i < 8 ? 'g' : i < 13 ? 'r' : 'b');
      els.rpmBar.appendChild(d);
      leds.push(d);
    }
  }
  gantryLights = els.gantry ? [...els.gantry.children] : [];

  mmSize();
  const onResize = () => mmSize();
  window.addEventListener('resize', onResize);

  const onAudioClick = () => { initAudio(); setMuted(!muted); };
  els.audioToggle?.addEventListener('click', onAudioClick);

  const onKeyDown = (e) => {
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
    if (e.code === 'KeyM' && !e.repeat) { initAudio(); setMuted(!muted); }
    if (e.code === 'Enter' && (modalOpen || dnfOpen)) requestRestart();
  };
  window.addEventListener('keydown', onKeyDown);

  const onPointerFirst = () => initAudio();
  window.addEventListener('pointerdown', onPointerFirst, { once: true });

  const onVisibility = () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisibility);

  els.raceAgain?.addEventListener('click', requestRestart);
  els.dnfRaceAgain?.addEventListener('click', requestRestart);

  const touchCleanups = [];
  for (const btn of document.querySelectorAll('.tbtn')) {
    const code = btn.dataset.key;
    const press = (e) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      btn.classList.add('held');
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    };
    const release = (e) => {
      e.preventDefault();
      btn.classList.remove('held');
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    };
    const noCtx = (e) => e.preventDefault();
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', noCtx);
    touchCleanups.push(() => {
      btn.removeEventListener('pointerdown', press);
      btn.removeEventListener('pointerup', release);
      btn.removeEventListener('pointercancel', release);
      btn.removeEventListener('lostpointercapture', release);
      btn.removeEventListener('contextmenu', noCtx);
    });
  }

  const bootTimeout = window.setTimeout(() => {
    if (!firstFrame && els.bootNote && els.bootRetry) {
      setText(els.bootNote, 'Still loading — check WebGL support and retry.');
      els.bootRetry.hidden = false;
    }
  }, 9000);

  setMuted(false);

  return function cleanupHud() {
    stopVictoryMusic();
    clearTimeout(bootTimeout);
    clearTimeout(announceTimer);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pointerdown', onPointerFirst);
    document.removeEventListener('visibilitychange', onVisibility);
    els.audioToggle?.removeEventListener('click', onAudioClick);
    els.raceAgain?.removeEventListener('click', requestRestart);
    els.dnfRaceAgain?.removeEventListener('click', requestRestart);
    for (const fn of touchCleanups) fn();
  };
}
