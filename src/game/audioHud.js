// ============================================================================
// audioHud.js — Monaco GP: Street Circuit Challenge
// Web Audio V6 turbo-hybrid synthesis + F1 TV broadcast DOM HUD.
// React-lifecycle safe: initHud() binds DOM refs after mount and returns a
// cleanup function for unmount / StrictMode safety.
// ============================================================================

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
// 1 · MINIMAP GEOMETRY  (mirror of track.js layout + curve math)
// ═══════════════════════════════════════════════════════════════════════════
const SCALE = 1.18;
const PTS = [
  [40,0,160],[0,0,120],[0,0,0],[0,0,-140],[12,1,-192],[48,3,-218],[115,8,-232],
  [195,14,-252],[243,16,-292],[252,17,-352],[288,17,-396],[332,15,-402],[372,12,-372],
  [398,8,-322],[392,5,-262],[358,4,-228],[326,4,-252],[318,2,-306],[332,1,-356],
  [392,0,-362],[478,0,-336],[552,0,-278],[588,0,-206],[576,0,-158],[596,0,-118],
  [586,0,-52],[556,0,12],[516,0,52],[478,0,64],[428,0,104],[362,0,148],[304,0,190],
  [252,0,198],[204,0,178],[122,0,168],
].map(p => [p[0] * SCALE, p[1] * SCALE, p[2] * SCALE]);

const NP = PTS.length, SEG = 1200;
const mapX = new Float32Array(SEG + 1), mapZ = new Float32Array(SEG + 1), cum = new Float32Array(SEG + 1);
let mapLen = 0, startU = 0;
const bounds = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };

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
(function buildMapTable() {
  let px = 0, pz = 0;
  for (let i = 0; i <= SEG; i++) {
    const [x, z] = curvePoint(i / SEG);
    mapX[i] = x; mapZ[i] = z;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(x - px, z - pz);
    px = x; pz = z;
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  mapLen = cum[SEG];
  startU = uAtPoint(PTS[2]);
})();
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
const DRZ = [
  [0.012, uAtPoint(PTS[3]) - 0.012],
  [uAtPoint(PTS[21]) + 0.012, uAtPoint(PTS[23]) - 0.008],
];
const TUN = [uAtPoint(PTS[19]) - 0.006, uAtPoint(PTS[21]) + 0.006];
const waterC = (() => {
  let x = 0, z = 0; for (let k = 22; k <= 29; k++) { x += PTS[k][0]; z += PTS[k][2]; }
  return [x / 8 + 60, z / 8];
})();

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
  const steps = Math.max(2, Math.ceil((u1 - u0) * SEG));
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
  const [wx, wy] = mm.tx(waterC[0] - 280, waterC[1] - 230);
  const [wx2, wy2] = mm.tx(waterC[0] + 280, waterC[1] + 230);
  const hg = g.createLinearGradient(wx, wy, wx2, wy2);
  hg.addColorStop(0, 'rgba(0,210,190,0.10)'); hg.addColorStop(1, 'rgba(59,130,246,0.14)');
  g.fillStyle = hg;
  g.beginPath();
  if (g.roundRect) g.roundRect(wx, wy, wx2 - wx, wy2 - wy, 14);
  else g.rect(wx, wy, wx2 - wx, wy2 - wy);
  g.fill();

  g.lineJoin = g.lineCap = 'round';
  mmPath(g, 0, 1); g.closePath();
  g.strokeStyle = 'rgba(0,210,190,0.22)'; g.lineWidth = 7; g.stroke();
  g.strokeStyle = 'rgba(242,239,230,0.88)'; g.lineWidth = 2.6; g.stroke();

  mmPath(g, TUN[0], TUN[1]);
  g.strokeStyle = 'rgba(255,176,32,0.9)'; g.lineWidth = 3.4; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);

  for (const [a, z] of DRZ) {
    mmPath(g, a, z);
    g.strokeStyle = 'rgba(34,255,136,0.95)'; g.lineWidth = 3.4; g.stroke();
  }

  const [sx0, sz0] = uToXY(startU), [sx1, sz1] = uToXY(startU + 0.004);
  const [cx, cy] = mm.tx(sx0, sz0);
  let dx = sx1 - sx0, dz = sz1 - sz0; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  g.strokeStyle = '#f2efe6'; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(cx - dz * 6, cy + dx * 6); g.lineTo(cx + dz * 6, cy - dx * 6); g.stroke();

  g.font = '700 7px "Titillium Web", sans-serif'; g.fillStyle = 'rgba(242,239,230,0.5)';
  const label = (pi, txt, ox, oy) => { const [x, y] = mm.tx(PTS[pi][0], PTS[pi][2]); g.fillText(txt, x + ox, y + oy); };
  label(9, 'CASINO', -40, -6); label(20, 'TUNNEL', -12, -9); label(27, 'PISCINE', 7, 4); label(31, 'RASCASSE', -14, 13);
  mm.base = b;
  setText(els.minimapLabel, 'CIRCUIT DE MONACO - 3.34 KM');
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
let ctx = null, master = null, noiseBuf = null, audioReady = false, muted = false;
let engine = null, screech = null, curb = null, shiftCutUntil = 0;
let latestCarState = null;
let prevGear = 1, prevHit = 0, prevDrs = false;

function makeNoise() {
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
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
    buildEngine(); buildLoops();
    audioReady = true;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  } catch { ctx = null; audioReady = false; return false; }
}
function burst({ type = 'lowpass', freq = 300, q = 0.8, gain = 0.3, dur = 0.25, sweepTo = null }) {
  if (!audioReady || !ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}
function tone(freq, dur = 0.15, gain = 0.12, delay = 0, type = 'sine') {
  if (!audioReady || !ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function thud(hit) {
  burst({ freq: 220, gain: 0.45 * hit, dur: 0.3 });
  if (!audioReady || !ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.24);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.4 * hit, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.3);
}

export function updateAudio(carState) {
  if (carState) latestCarState = carState;
  if (!audioReady || !ctx || !carState) return;
  const t = ctx.currentTime;
  const rpm = carState.rpm || 4200;
  const f = Math.max(30, (rpm / 60) * 3);
  const rpmFrac = clamp((rpm - 4200) / 8100, 0, 1);
  const thr = carState.throttle ?? 0;
  const speedFrac = clamp((carState.speedKmh || 0) / 340, 0, 1);

  for (const L of engine.oscs) L.o.frequency.setTargetAtTime(f * L.mult, t, 0.03);
  engine.filter.frequency.setTargetAtTime(500 + rpmFrac * 5200 + thr * 1200, t, 0.05);
  let vol = 0.09 + thr * 0.17 + speedFrac * 0.05;
  if (carState.gear !== prevGear) {
    if (carState.gear > prevGear) burst({ type: 'bandpass', freq: 420, q: 1.2, gain: 0.1, dur: 0.07 });
    shiftCutUntil = t + 0.09;
    prevGear = carState.gear;
  }
  if (t < shiftCutUntil) vol *= 0.3;
  engine.gain.gain.setTargetAtTime(vol, t, 0.06);
  engine.turbo.frequency.setTargetAtTime(900 + rpmFrac * 2800, t, 0.08);
  engine.tg.gain.setTargetAtTime(thr * rpmFrac * 0.035, t, 0.1);

  const slide = carState.isSliding ? clamp((carState.lateralG || 2) / 5, 0.2, 1) : 0;
  screech.g.gain.setTargetAtTime(slide * 0.16 * (0.4 + speedFrac), t, 0.05);
  screech.bp.frequency.setTargetAtTime(1100 + speedFrac * 900, t, 0.1);
  curb.g.gain.setTargetAtTime(carState.onCurb && carState.speedKmh > 20 ? 0.07 : 0, t, 0.04);

  const hit = carState.hitIntensity || 0;
  if (hit > 0.22 && hit > prevHit + 0.12) thud(hit);
  prevHit = hit;
  if (carState.drsActive && !prevDrs) burst({ type: 'bandpass', freq: 600, q: 1.4, gain: 0.08, dur: 0.28, sweepTo: 3000 });
  prevDrs = !!carState.drsActive;
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
let modalOpen = false, finishSig = '', fanfareDone = false;

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
  if (els.flash) els.flash.style.opacity = String(clamp((cs.hitIntensity || 0) * 0.6, 0, 0.55));
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
    if (rs.startLights > prevLights) tone(660, 0.14, 0.12);
    announce('MONACO GP', 'STREET CIRCUIT CHALLENGE · 3 LAPS · 8 CARS', '', 0);
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
  setText(els.finishSub, `CIRCUIT DE MONACO · ${rs.totalLaps} LAPS · BEST ${fmtTime(me && me.bestLapTime)}`);
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
    fanfareDone = true;
    const notes = rs.playerPosition === 1 ? [523, 659, 784, 1046] : [440, 554, 659];
    notes.forEach((f, i) => tone(f, 0.5, 0.14, i * 0.16, 'triangle'));
  }
}
function closeFinish() {
  modalOpen = false; fanfareDone = false; finishSig = '';
  els.modal?.classList.remove('open');
  if (els.confetti) els.confetti.innerHTML = '';
}
function requestRestart() {
  initAudio();
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
  if (raceState.isFinished) {
    if (!modalOpen) openFinish(raceState);
    else renderFinish(raceState);
  } else if (modalOpen) closeFinish();
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
    hint: $('controls-hint'), flash: $('flash'),
    announce: $('announce'), announceText: $('announce-text'), announceSub: $('announce-sub'),
    modal: $('finish-modal'), card: $('finish-card'), finishTitle: $('finish-title'),
    finishSub: $('finish-sub'), podium: $('podium'), finishRows: $('finish-rows'),
    raceAgain: $('race-again'), confetti: $('confetti'),
  };

  prevLights = 0; prevPhase = null; prevLap = 1; prevBest = null; prevPos = 8;
  posToastAt = 0; bootDone = false; firstFrame = false;
  modalOpen = false; finishSig = ''; fanfareDone = false;

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
    if (e.code === 'KeyM' && !e.repeat) { initAudio(); setMuted(!muted); }
    if (e.code === 'Enter' && modalOpen) requestRestart();
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
    clearTimeout(bootTimeout);
    clearTimeout(announceTimer);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pointerdown', onPointerFirst);
    document.removeEventListener('visibilitychange', onVisibility);
    els.audioToggle?.removeEventListener('click', onAudioClick);
    els.raceAgain?.removeEventListener('click', requestRestart);
    for (const fn of touchCleanups) fn();
  };
}
