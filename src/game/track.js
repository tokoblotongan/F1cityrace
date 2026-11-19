// ============================================================================
// track.js — Monaco GP: Street Circuit Challenge
// Procedural Circuit de Monaco: centripetal Catmull-Rom spline, arc-length
// parameterization, asphalt & curb textures, safety barriers, Monaco Tunnel,
// Port Hercule shader water + yachts, Monte Carlo hillside skyline, start
// gantry with 5 red F1 lights, and sector checkpoints.
// ============================================================================

import * as THREE from 'three';

const SCALE = 1.18;
export const TRACK_POINTS = [
  [40, 0, 160], [0, 0, 120], [0, 0, 0], [0, 0, -140], [12, 1, -192], [48, 3, -218], [115, 8, -232],
  [195, 14, -252], [243, 16, -292], [252, 17, -352], [288, 17, -396], [332, 15, -402], [372, 12, -372],
  [398, 8, -322], [392, 5, -262], [358, 4, -228], [326, 4, -252], [318, 2, -306], [332, 1, -356],
  [392, 0, -362], [478, 0, -336], [552, 0, -278], [588, 0, -206], [576, 0, -158], [596, 0, -118],
  [586, 0, -52], [556, 0, 12], [516, 0, 52], [478, 0, 64], [428, 0, 104], [362, 0, 148], [304, 0, 190],
  [252, 0, 198], [204, 0, 178], [122, 0, 168],
].map((p) => new THREE.Vector3(p[0] * SCALE, p[1] * SCALE, p[2] * SCALE));

const SAMPLE_COUNT = 1200;
const HALF_WIDTH = 8.4;

function axisVal(x0, x1, x2, x3, dt0, dt1, dt2, w) {
  let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
  let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
  t1 *= dt1;
  t2 *= dt1;
  const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2;
  const c3 = 2 * x1 - 2 * x2 + t1 + t2;
  return ((c3 * w + c2) * w + t1) * w + x1;
}

function evalCentripetal(pts, t) {
  const n = pts.length;
  const p = ((t % 1) + 1) % 1 * n;
  const i = Math.floor(p);
  const w = p - i;
  const get = (k) => pts[((k % n) + n) % n];
  const p0 = get(i - 1);
  const p1 = get(i);
  const p2 = get(i + 1);
  const p3 = get(i + 2);
  let dt0 = Math.pow(p0.distanceToSquared(p1), 0.25);
  let dt1 = Math.pow(p1.distanceToSquared(p2), 0.25);
  let dt2 = Math.pow(p2.distanceToSquared(p3), 0.25);
  if (dt1 < 1e-4) dt1 = 1;
  if (dt0 < 1e-4) dt0 = dt1;
  if (dt2 < 1e-4) dt2 = dt1;
  return new THREE.Vector3(
    axisVal(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2, w),
    axisVal(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2, w),
    axisVal(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2, w)
  );
}

function makeAsphaltTextures() {
  const W = 1024;
  const H = 1024;
  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const ag = alb.getContext('2d');

  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const rg = rgh.getContext('2d');

  const bmp = document.createElement('canvas');
  bmp.width = W; bmp.height = H;
  const bg = bmp.getContext('2d');

  const aImg = ag.createImageData(W, H);
  const rImg = rg.createImageData(W, H);
  const bImg = bg.createImageData(W, H);
  const ad = aImg.data;
  const rd = rImg.data;
  const bd = bImg.data;

  // Deterministic fast hash for seamless mineral aggregate micro-grain
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const u = x / W;

      // Multi-frequency mineral aggregate + subtle quartz/basalt speckles
      const n1 = rnd();
      const speck = n1 > 0.94 ? 22 : n1 < 0.08 ? -14 : (n1 - 0.5) * 16;

      // Dual rubberized racing-line grooves (left & right tire tracks + center polish)
      const gL = Math.exp(-Math.pow((u - 0.31) / 0.11, 2));
      const gR = Math.exp(-Math.pow((u - 0.69) / 0.11, 2));
      const gMid = Math.exp(-Math.pow((u - 0.50) / 0.14, 2)) * 0.45;
      const groove = Math.min(1, gL + gR + gMid);

      const base = 44 + speck - groove * 13;
      ad[idx] = Math.max(12, Math.min(95, base));
      ad[idx + 1] = Math.max(13, Math.min(98, base + 2));
      ad[idx + 2] = Math.max(16, Math.min(104, base + 5));
      ad[idx + 3] = 255;

      // Roughness: coarse shoulder aggregate (~0.92), smoother rubbered racing groove (~0.58)
      const rVal = Math.max(125, Math.min(248, 232 - groove * 76 + speck * 0.7));
      rd[idx] = rd[idx + 1] = rd[idx + 2] = rVal;
      rd[idx + 3] = 255;

      // Bump: crisp stone aggregate relief (slightly compacted in rubbered grooves)
      const bVal = Math.max(40, Math.min(235, 138 + speck * 3.2 - groove * 14));
      bd[idx] = bd[idx + 1] = bd[idx + 2] = bVal;
      bd[idx + 3] = 255;
    }
  }

  ag.putImageData(aImg, 0, 0);
  rg.putImageData(rImg, 0, 0);
  bg.putImageData(bImg, 0, 0);

  // Subtle weathered longitudinal asphalt paving seam
  ag.fillStyle = 'rgba(10, 12, 16, 0.22)';
  ag.fillRect(W * 0.5 - 3, 0, 6, H);

  // Crisp painted white track-edge lines (with slight satin paint roughness)
  ag.fillStyle = '#e7e3d9';
  ag.fillRect(18, 0, 15, H);
  ag.fillRect(W - 33, 0, 15, H);
  rg.fillStyle = 'rgb(165, 165, 165)';
  rg.fillRect(18, 0, 15, H);
  rg.fillRect(W - 33, 0, 15, H);
  bg.fillStyle = 'rgb(175, 175, 175)';
  bg.fillRect(18, 0, 15, H);
  bg.fillRect(W - 33, 0, 15, H);

  const setup = (canvas, isColor) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 260);
    if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };

  return {
    map: setup(alb, true),
    roughnessMap: setup(rgh, false),
    bumpMap: setup(bmp, false),
  };
}

function makeCurbTexture() {
  const W = 256;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  for (let y = 0; y < H; y += 128) {
    const isRed = (y / 128) % 2 === 0;
    g.fillStyle = isRed ? '#d4160a' : '#eee9dc';
    g.fillRect(0, y, W, 128);

    // Subtle stone/paint bevel highlight & expansion joint seam
    g.fillStyle = 'rgba(255, 255, 255, 0.14)';
    g.fillRect(0, y + 2, W, 6);
    g.fillStyle = 'rgba(12, 14, 18, 0.36)';
    g.fillRect(0, y + 123, W, 5);
  }

  // Outer edge bevel shadow
  g.fillStyle = 'rgba(10, 12, 16, 0.25)';
  g.fillRect(0, 0, 16, H);
  g.fillRect(W - 16, 0, 16, H);

  // Weathered apex rubber scuff marks & tire scrub streaks
  for (let i = 0; i < 38; i++) {
    const sy = (i * 83) % H;
    const sx = 24 + ((i * 59) % (W - 72));
    const sw = 18 + (i % 4) * 14;
    const sh = 14 + (i % 3) * 12;
    g.fillStyle = `rgba(18, 20, 24, ${0.14 + (i % 4) * 0.06})`;
    g.beginPath();
    g.ellipse(sx, sy, sw * 0.5, sh * 0.32, -0.35 + (i % 3) * 0.14, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 340);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeStartFinishTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  const sq = 16;
  for (let y = 0; y < 64; y += sq) {
    for (let x = 0; x < 256; x += sq) {
      g.fillStyle = ((x / sq + y / sq) % 2 === 0) ? '#f2efe6' : '#12161e';
      g.fillRect(x, y, sq, sq);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeArmcoTextures() {
  const W = 512;
  const H = 256;
  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const ag = alb.getContext('2d');

  const bmp = document.createElement('canvas');
  bmp.width = W; bmp.height = H;
  const bg = bmp.getContext('2d');

  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const rg = rgh.getContext('2d');

  // Galvanized steel base
  ag.fillStyle = '#adb5c0';
  ag.fillRect(0, 0, W, H);
  bg.fillStyle = 'rgb(115, 115, 115)';
  bg.fillRect(0, 0, W, H);
  rg.fillStyle = 'rgb(110, 110, 110)';
  rg.fillRect(0, 0, W, H);

  // Subtle brushed / galvanized steel grain
  for (let i = 0; i < 4200; i++) {
    const x = (i * 97) % W;
    const y = (i * 151) % H;
    const v = 162 + (i % 34);
    ag.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
    ag.fillRect(x, y, 6, 2);
  }

  // Triple-beam corrugated W-rail profile (3 horizontal beams across barrier height)
  const beams = [22, 100, 178];
  const beamH = 60;
  for (const by of beams) {
    // Albedo metallic W-beam highlight + deep central trough + lower shadow
    const grad = ag.createLinearGradient(0, by, 0, by + beamH);
    grad.addColorStop(0.0, '#626a75');
    grad.addColorStop(0.18, '#e3e8f0');
    grad.addColorStop(0.36, '#b7c0cc');
    grad.addColorStop(0.50, '#5a626d');
    grad.addColorStop(0.64, '#d9e0e8');
    grad.addColorStop(0.84, '#b8c1cd');
    grad.addColorStop(1.0, '#525963');
    ag.fillStyle = grad;
    ag.fillRect(0, by, W, beamH);

    // Matching bump profile for sharp sunlight specular reflection along crests
    const bGrad = bg.createLinearGradient(0, by, 0, by + beamH);
    bGrad.addColorStop(0.0, 'rgb(45,45,45)');
    bGrad.addColorStop(0.22, 'rgb(240,240,240)');
    bGrad.addColorStop(0.50, 'rgb(52,52,52)');
    bGrad.addColorStop(0.76, 'rgb(235,235,235)');
    bGrad.addColorStop(1.0, 'rgb(42,42,42)');
    bg.fillStyle = bGrad;
    bg.fillRect(0, by, W, beamH);

    // Polished crests vs rougher recessed troughs
    const rGrad = rg.createLinearGradient(0, by, 0, by + beamH);
    rGrad.addColorStop(0.0, 'rgb(155,155,155)');
    rGrad.addColorStop(0.22, 'rgb(75,75,75)');
    rGrad.addColorStop(0.50, 'rgb(165,165,165)');
    rGrad.addColorStop(0.76, 'rgb(80,80,80)');
    rGrad.addColorStop(1.0, 'rgb(155,155,155)');
    rg.fillStyle = rGrad;
    rg.fillRect(0, by, W, beamH);
  }

  // Vertical splice seams + galvanized hex bolts every 256px
  for (const sx of [6, 262]) {
    ag.fillStyle = 'rgba(20, 24, 30, 0.35)';
    ag.fillRect(sx, 20, 5, H - 28);
    bg.fillStyle = 'rgb(60, 60, 60)';
    bg.fillRect(sx, 20, 4, H - 28);
    for (const by of beams) {
      for (const dy of [15, 45]) {
        ag.fillStyle = '#dde3ec';
        ag.beginPath();
        ag.arc(sx + 10, by + dy, 3.5, 0, Math.PI * 2);
        ag.fill();
        bg.fillStyle = 'rgb(250, 250, 250)';
        bg.beginPath();
        bg.arc(sx + 10, by + dy, 3.5, 0, Math.PI * 2);
        bg.fill();
      }
    }
  }

  // Monaco FIA red-and-white safety top rail stripe
  ag.fillStyle = '#d4160a';
  ag.fillRect(0, 0, 256, 18);
  ag.fillStyle = '#f2efe6';
  ag.fillRect(256, 0, 256, 18);
  rg.fillStyle = 'rgb(140, 140, 140)';
  rg.fillRect(0, 0, W, 18);

  const setup = (canvas, isColor) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(360, 1);
    if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };

  return {
    map: setup(alb, true),
    bumpMap: setup(bmp, false),
    roughnessMap: setup(rgh, false),
  };
}

function makeCatchFenceTextures() {
  const W = 256;
  const H = 256;
  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const ag = alb.getContext('2d');

  const alp = document.createElement('canvas');
  alp.width = W; alp.height = H;
  const pg = alp.getContext('2d');

  ag.fillStyle = '#6f7885';
  ag.fillRect(0, 0, W, H);
  pg.fillStyle = '#000000';
  pg.fillRect(0, 0, W, H);

  // Welded FIA steel wire-mesh grid
  pg.strokeStyle = '#d8d8d8';
  pg.lineWidth = 2;
  ag.strokeStyle = '#8b95a3';
  ag.lineWidth = 2;
  const step = 16;
  for (let x = 0; x <= W; x += step) {
    pg.beginPath(); pg.moveTo(x, 0); pg.lineTo(x, H); pg.stroke();
    ag.beginPath(); ag.moveTo(x, 0); ag.lineTo(x, H); ag.stroke();
  }
  for (let y = 0; y <= H; y += step) {
    pg.beginPath(); pg.moveTo(0, y); pg.lineTo(W, y); pg.stroke();
    ag.beginPath(); ag.moveTo(0, y); ag.lineTo(W, y); ag.stroke();
  }

  // Heavy horizontal steel tension cables across catch-fencing
  for (const cy of [4, 76, 152, 248]) {
    pg.fillStyle = '#ffffff';
    pg.fillRect(0, cy - 2, W, 5);
    ag.fillStyle = '#cfd6e0';
    ag.fillRect(0, cy - 2, W, 5);
  }

  const map = new THREE.CanvasTexture(alb);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const alphaMap = new THREE.CanvasTexture(alp);
  alphaMap.wrapS = THREE.RepeatWrapping;
  alphaMap.wrapT = THREE.ClampToEdgeWrapping;
  alphaMap.anisotropy = 8;

  return { map, alphaMap };
}

function makeDistanceBoardTexture(distText) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const g = c.getContext('2d');

  // Reflective white FIA braking marker background
  g.fillStyle = '#f5f2ea';
  g.fillRect(0, 0, 256, 192);

  // Red FIA border + top marshal accent bar
  g.fillStyle = '#d4160a';
  g.fillRect(0, 0, 256, 16);
  g.fillRect(0, 178, 256, 14);
  g.fillRect(0, 0, 12, 192);
  g.fillRect(244, 0, 12, 192);

  // Bold distance numerals (150 / 100 / 50)
  g.fillStyle = '#11151d';
  g.font = '900 108px "Titillium Web", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(distText, 128, 102);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeCurtainWallTextures(theme = 'silverSky') {
  const W = 1024;
  const H = 1024;
  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const ag = alb.getContext('2d');

  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const rg = rgh.getContext('2d');

  const ems = document.createElement('canvas');
  ems.width = W; ems.height = H;
  const eg = ems.getContext('2d');

  const palettes = {
    silverSky: {
      top: '#4e83b0',
      mid: '#76add6',
      bot: '#a8d3f0',
      mullion: '#eef3f8',
      spandrel: '#cfdbe6',
      spandrelTrim: '#9cb2c7',
      glowA: 'rgba(210, 244, 255, 0.36)',
      glowB: 'rgba(255, 245, 220, 0.30)',
      emsA: 'rgb(115, 195, 225)',
      emsB: 'rgb(175, 155, 115)',
      diagAlpha: 0.16,
      isMasonry: false,
    },
    champagneIvory: {
      top: '#9c7f52',
      mid: '#bca06e',
      bot: '#d6be8e',
      mullion: '#f4ecdc',
      spandrel: '#eee4cf',
      spandrelTrim: '#cbb894',
      glowA: 'rgba(255, 236, 185, 0.38)',
      glowB: 'rgba(220, 245, 255, 0.24)',
      emsA: 'rgb(190, 156, 92)',
      emsB: 'rgb(120, 180, 200)',
      diagAlpha: 0.14,
      isMasonry: true,
    },
    pearlTeal: {
      top: '#3e979c',
      mid: '#64bdbd',
      bot: '#95dada',
      mullion: '#e7edf2',
      spandrel: '#d6dde5',
      spandrelTrim: '#aebbc8',
      glowA: 'rgba(190, 255, 248, 0.36)',
      glowB: 'rgba(255, 246, 222, 0.26)',
      emsA: 'rgb(108, 208, 202)',
      emsB: 'rgb(176, 158, 120)',
      diagAlpha: 0.15,
      isMasonry: false,
    },
    coralMarina: {
      top: '#346380',
      mid: '#4d84a4',
      bot: '#78acc8',
      mullion: '#f8f3eb',
      spandrel: '#f4ede2',
      spandrelTrim: '#d96b4e',
      glowA: 'rgba(255, 234, 200, 0.36)',
      glowB: 'rgba(195, 242, 255, 0.28)',
      emsA: 'rgb(195, 148, 102)',
      emsB: 'rgb(112, 186, 215)',
      diagAlpha: 0.08,
      isMasonry: true,
    },
  };
  const pal = palettes[theme] || palettes.silverSky;

  // Bright sunlit architectural glass base gradient
  const baseGrad = ag.createLinearGradient(0, 0, W * 0.4, H);
  baseGrad.addColorStop(0, pal.top);
  baseGrad.addColorStop(0.55, pal.mid);
  baseGrad.addColorStop(1, pal.bot);
  ag.fillStyle = baseGrad;
  ag.fillRect(0, 0, W, H);

  // Smooth glass multiplier (~0.72 -> multiplied by material roughness 0.28-0.34 => ~0.20-0.24)
  rg.fillStyle = 'rgb(184, 184, 184)';
  rg.fillRect(0, 0, W, H);

  eg.fillStyle = '#000000';
  eg.fillRect(0, 0, W, H);

  const cols = 8;
  const rows = 8;
  const colW = W / cols;
  const rowH = H / rows;

  // Individual curtain-wall bays with sky reflections & subtle interior depth
  for (let r = 0; r < rows; r++) {
    const ry = r * rowH;
    for (let c = 0; c < cols; c++) {
      const cx = c * colW;
      const hash = ((r * 31 + c * 17) % 19) / 19;

      const paneGrad = ag.createLinearGradient(cx, ry, cx + colW, ry + rowH);
      paneGrad.addColorStop(0, `rgba(255, 255, 255, ${0.08 + hash * 0.10})`);
      paneGrad.addColorStop(0.5, 'rgba(225, 246, 255, 0.04)');
      paneGrad.addColorStop(1, `rgba(20, 42, 64, ${0.06 + (1 - hash) * 0.08})`);
      ag.fillStyle = paneGrad;
      ag.fillRect(cx + 3, ry + 18, colW - 6, rowH - 22);

      // Diagonal Mediterranean sky glint on alternating bays
      if ((r + c) % 3 === 0) {
        ag.fillStyle = 'rgba(235, 248, 255, 0.20)';
        ag.beginPath();
        ag.moveTo(cx + 4, ry + 18);
        ag.lineTo(cx + colW * 0.68, ry + 18);
        ag.lineTo(cx + 4, ry + rowH * 0.66);
        ag.closePath();
        ag.fill();
      }

      // Interior office / double-height atrium lighting
      if ((r * 7 + c * 13) % 5 === 0) {
        const isWarm = (r + c) % 2 === 0;
        ag.fillStyle = isWarm ? pal.glowB : pal.glowA;
        ag.fillRect(cx + 8, ry + rowH * 0.34, colW - 16, rowH * 0.45);
        eg.fillStyle = isWarm ? pal.emsB : pal.emsA;
        eg.fillRect(cx + 10, ry + rowH * 0.38, colW - 20, rowH * 0.38);
      }
    }

    // Architectural horizontal spandrel bands (ivory limestone / coral-terracotta / pearl-aluminum)
    const bandH = pal.isMasonry ? 28 : 18;
    ag.fillStyle = pal.spandrel;
    ag.fillRect(0, ry, W, bandH);
    ag.fillStyle = pal.spandrelTrim;
    ag.fillRect(0, ry + bandH - 6, W, 6);
    rg.fillStyle = 'rgb(255, 255, 255)';
    rg.fillRect(0, ry, W, bandH);
  }

  // Vertical mullions / limestone-terracotta piers
  const mullW = pal.isMasonry ? 10 : 5;
  for (let c = 0; c <= cols; c++) {
    const x = c * colW;
    ag.fillStyle = pal.mullion;
    ag.fillRect(x - mullW * 0.5, 0, mullW, H);
    if (pal.isMasonry && c % 2 === 0) {
      ag.fillStyle = pal.spandrelTrim;
      ag.fillRect(x - 3, 0, 6, H);
    }
    rg.fillStyle = 'rgb(255, 255, 255)';
    rg.fillRect(x - mullW * 0.5, 0, mullW, H);
  }

  // Subtle architectural diagrid accent
  if (pal.diagAlpha > 0) {
    ag.strokeStyle = `rgba(245, 250, 255, ${pal.diagAlpha})`;
    ag.lineWidth = 4;
    for (let offset = -W; offset <= W * 2; offset += W * 0.5) {
      ag.beginPath();
      ag.moveTo(offset, 0);
      ag.lineTo(offset + W, H);
      ag.stroke();
      ag.beginPath();
      ag.moveTo(offset + W, 0);
      ag.lineTo(offset, H);
      ag.stroke();
    }
  }

  const setup = (canvas, isColor) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };

  return {
    map: setup(alb, true),
    roughnessMap: setup(rgh, false),
    emissiveMap: setup(ems, true),
  };
}

function makeZahaCompositeTextures() {
  const W = 1024;
  const H = 1024;
  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const ag = alb.getContext('2d');

  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const rg = rgh.getContext('2d');

  const ems = document.createElement('canvas');
  ems.width = W; ems.height = H;
  const eg = ems.getContext('2d');

  // Sleek pearlescent white composite cladding
  const base = ag.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#f7f9fc');
  base.addColorStop(0.5, '#eef2f7');
  base.addColorStop(1, '#e3e9f1');
  ag.fillStyle = base;
  ag.fillRect(0, 0, W, H);
  rg.fillStyle = 'rgb(245, 245, 245)';
  rg.fillRect(0, 0, W, H);
  eg.fillStyle = '#000000';
  eg.fillRect(0, 0, W, H);

  // Seamless composite panel joints + wrap-around dark tinted horizontal ribbon windows
  const ribbons = 4;
  const bandH = H / ribbons;
  for (let i = 0; i < ribbons; i++) {
    const y = i * bandH;
    ag.fillStyle = '#cbd5e1';
    ag.fillRect(0, y + 8, W, 4);

    // Continuous sweeping ribbon glass
    const winY = y + bandH * 0.34;
    const winH = bandH * 0.38;
    const wGrad = ag.createLinearGradient(0, winY, 0, winY + winH);
    wGrad.addColorStop(0, '#132a3e');
    wGrad.addColorStop(0.5, '#214c6b');
    wGrad.addColorStop(1, '#0f2030');
    ag.fillStyle = wGrad;
    ag.fillRect(0, winY, W, winH);

    // Thin silver-slate mullions inside ribbon glazing
    ag.fillStyle = '#8fa0b2';
    for (let mx = 0; mx < W; mx += 128) {
      ag.fillRect(mx, winY, 3, winH);
    }

    // Crisp low roughness multiplier on ribbon windows
    rg.fillStyle = 'rgb(172, 172, 172)';
    rg.fillRect(0, winY, W, winH);

    // Subtle cyan LED cove glow along ribbon ceiling
    eg.fillStyle = 'rgba(130, 232, 255, 0.55)';
    eg.fillRect(0, winY + 3, W, 8);
  }

  const setup = (canvas, isColor) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };

  return {
    map: setup(alb, true),
    roughnessMap: setup(rgh, false),
    emissiveMap: setup(ems, true),
  };
}

function makeHelipadTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#252c36';
  g.fillRect(0, 0, 256, 256);

  // Outer safety circle & amber perimeter dashes
  g.strokeStyle = '#d8b24a';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 128, 98, 0, Math.PI * 2);
  g.stroke();

  g.strokeStyle = '#38e8ff';
  g.lineWidth = 4;
  g.setLineDash([16, 12]);
  g.beginPath();
  g.arc(128, 128, 114, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);

  // Crisp centered white 'H'
  g.fillStyle = '#f2f5f8';
  g.fillRect(78, 72, 22, 112);
  g.fillRect(156, 72, 22, 112);
  g.fillRect(78, 116, 100, 24);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeCasinoFacadeTextures() {
  const W = 512;
  const H = 256;
  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const ag = alb.getContext('2d');

  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const rg = rgh.getContext('2d');

  // Rich Beaux-Arts ochre-limestone base
  ag.fillStyle = '#e8dcc2';
  ag.fillRect(0, 0, W, H);
  rg.fillStyle = 'rgb(210,210,210)';
  rg.fillRect(0, 0, W, H);

  // Ornamental cornice & gold frieze
  ag.fillStyle = '#d3c2a0';
  ag.fillRect(0, 0, W, 22);
  ag.fillStyle = '#c89e3c';
  ag.fillRect(0, 22, W, 6);
  ag.fillRect(0, H - 18, W, 5);
  rg.fillStyle = 'rgb(65,65,65)';
  rg.fillRect(0, 22, W, 6);

  const bays = 6;
  const bw = W / bays;
  for (let i = 0; i < bays; i++) {
    const x = i * bw;
    // Fluted column between bays
    ag.fillStyle = '#f3ebd9';
    ag.fillRect(x, 28, 12, H - 46);
    ag.fillStyle = 'rgba(80,65,40,0.22)';
    ag.fillRect(x + 4, 34, 2, H - 58);
    ag.fillRect(x + 8, 34, 2, H - 58);

    // Grand arched Casino glass windows with warm golden interior sheen
    const wx = x + 20;
    const wy = 46;
    const ww = bw - 28;
    const wh = H - 78;
    const g = ag.createLinearGradient(wx, wy, wx, wy + wh);
    g.addColorStop(0, '#3a556a');
    g.addColorStop(0.55, '#6b5530');
    g.addColorStop(1, '#d8aa4b');
    ag.fillStyle = g;
    ag.beginPath();
    ag.arc(wx + ww * 0.5, wy + ww * 0.4, ww * 0.5, Math.PI, 0);
    ag.lineTo(wx + ww, wy + wh);
    ag.lineTo(wx, wy + wh);
    ag.closePath();
    ag.fill();

    // Arch keystone & gold muntins
    ag.strokeStyle = '#d9b55b';
    ag.lineWidth = 3;
    ag.strokeRect(wx + 2, wy + ww * 0.35, ww - 4, wh - ww * 0.35);
    rg.fillStyle = 'rgb(28,28,28)';
    rg.fillRect(wx, wy + 8, ww, wh - 8);
  }

  const map = new THREE.CanvasTexture(alb);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rgh);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.ClampToEdgeWrapping;
  roughnessMap.anisotropy = 8;

  return { map, roughnessMap };
}

function makePalmTrunkTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#7c6248';
  g.fillRect(0, 0, 256, 512);

  // Subtle vertical fibrous bark grain
  for (let x = 0; x < 256; x += 6) {
    g.fillStyle = (x % 12 === 0) ? 'rgba(48,34,22,0.16)' : 'rgba(176,148,118,0.12)';
    g.fillRect(x, 0, 3, 512);
  }

  // Distinct Royal & Date palm annular leaf-scar rings
  for (let y = 0; y < 512; y += 16) {
    g.fillStyle = '#4f3a27';
    g.fillRect(0, y, 256, 5);
    g.fillStyle = '#9a8064';
    g.fillRect(0, y + 5, 256, 4);
    g.fillStyle = 'rgba(255,244,224,0.12)';
    g.fillRect(0, y + 9, 256, 2);
  }

  // Upper crownshaft transition band near top
  const grad = g.createLinearGradient(0, 440, 0, 512);
  grad.addColorStop(0, 'rgba(92,126,56,0)');
  grad.addColorStop(1, 'rgba(92,126,56,0.72)');
  g.fillStyle = grad;
  g.fillRect(0, 440, 256, 72);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makePalmFrondTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');

  const a = document.createElement('canvas');
  a.width = 256; a.height = 256;
  const ag = a.getContext('2d');
  ag.fillStyle = '#000000';
  ag.fillRect(0, 0, 256, 256);

  // Fill color canvas base green so bilinear sampling never bleeds black halos
  g.fillStyle = '#4f8e34';
  g.fillRect(0, 0, 256, 256);

  // Central rachis rib (color + alpha)
  g.strokeStyle = '#7ba13e';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(128, 254);
  g.lineTo(128, 8);
  g.stroke();

  ag.strokeStyle = '#ffffff';
  ag.lineWidth = 7;
  ag.beginPath();
  ag.moveTo(128, 254);
  ag.lineTo(128, 8);
  ag.stroke();

  // Dense tapered pinnate leaflets along both sides of the frond
  const leafletCount = 30;
  for (let i = 0; i < leafletCount; i++) {
    const t = i / (leafletCount - 1);
    const y = 246 - t * 232;
    const span = Math.sin(Math.pow(t, 0.68) * Math.PI * 0.96) * 120 + 6;
    const tipY = y - 20 - (1 - t) * 15;
    const shade = i % 3 === 0 ? '#5ea63d' : i % 3 === 1 ? '#478b31' : '#6cb448';

    for (const dir of [-1, 1]) {
      g.fillStyle = shade;
      g.beginPath();
      g.moveTo(128, y);
      g.quadraticCurveTo(128 + dir * span * 0.56, y - 16, 128 + dir * span, tipY);
      g.quadraticCurveTo(128 + dir * span * 0.48, y - 3, 128, y + 5.5);
      g.fill();

      ag.fillStyle = '#ffffff';
      ag.beginPath();
      ag.moveTo(128, y);
      ag.quadraticCurveTo(128 + dir * span * 0.56, y - 16, 128 + dir * span, tipY);
      ag.quadraticCurveTo(128 + dir * span * 0.48, y - 3, 128, y + 5.5);
      ag.fill();
    }
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const alphaMap = new THREE.CanvasTexture(a);
  alphaMap.anisotropy = 8;

  return { map, alphaMap };
}

function makeSponsorBannerTexture(primary, accent, title, sub) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = primary;
  g.fillRect(0, 0, 1024, 256);

  // Subtle horizontal brushed sheen
  const sheen = g.createLinearGradient(0, 0, 0, 256);
  sheen.addColorStop(0, 'rgba(255,255,255,0.08)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, 1024, 256);

  // Motorsport side chevrons & bottom trim bar
  g.fillStyle = accent;
  g.fillRect(0, 0, 46, 256);
  g.fillRect(978, 0, 46, 256);
  g.fillRect(0, 224, 1024, 32);
  g.fillStyle = '#f8f5ec';
  g.fillRect(54, 16, 916, 5);

  g.fillStyle = '#f8f5ec';
  g.font = '900 84px sans-serif';
  g.textAlign = 'center';
  g.fillText(title, 512, 124);
  g.fillStyle = accent;
  g.font = '800 38px sans-serif';
  g.fillText(sub, 512, 186);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

function makeTopCoolBannerTexture() {
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  // Deep motorsport crimson-red & dark carbon-black racing gradient
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b0e14');
  bg.addColorStop(0.32, '#171c26');
  bg.addColorStop(0.68, '#a60500');
  bg.addColorStop(1, '#e10600');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // Diagonal crimson racing band across center-right & dark carbon wing on left
  g.fillStyle = '#0e1118';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(W * 0.44, 0);
  g.lineTo(W * 0.34, H);
  g.lineTo(0, H);
  g.closePath();
  g.fill();

  // Subtle carbon-fiber micro-weave pattern over the dark section
  g.fillStyle = 'rgba(255, 255, 255, 0.04)';
  for (let y = 0; y < H; y += 16) {
    for (let x = (y % 32 === 0 ? 0 : 8); x < W * 0.45; x += 16) {
      g.fillRect(x, y, 6, 6);
    }
  }

  // Deep crimson center-right field
  const redGrad = g.createLinearGradient(W * 0.34, 0, W, H);
  redGrad.addColorStop(0, '#960400');
  redGrad.addColorStop(0.45, '#d40700');
  redGrad.addColorStop(1, '#7a0300');
  g.fillStyle = redGrad;
  g.beginPath();
  g.moveTo(W * 0.44, 0);
  g.lineTo(W, 0);
  g.lineTo(W, H);
  g.lineTo(W * 0.34, H);
  g.closePath();
  g.fill();

  // Metallic silver diagonal accent stripes
  const silverGrad = g.createLinearGradient(0, 0, 0, H);
  silverGrad.addColorStop(0, '#f8fafc');
  silverGrad.addColorStop(0.5, '#94a3b8');
  silverGrad.addColorStop(1, '#e2e8f0');

  g.fillStyle = silverGrad;
  g.beginPath();
  g.moveTo(W * 0.422, 0);
  g.lineTo(W * 0.445, 0);
  g.lineTo(W * 0.345, H);
  g.lineTo(W * 0.322, H);
  g.closePath();
  g.fill();

  g.fillStyle = '#ffd60a';
  g.beginPath();
  g.moveTo(W * 0.452, 0);
  g.lineTo(W * 0.464, 0);
  g.lineTo(W * 0.364, H);
  g.lineTo(W * 0.352, H);
  g.closePath();
  g.fill();

  // Top & bottom metallic silver + crimson racing rails
  g.fillStyle = silverGrad;
  g.fillRect(0, 0, W, 18);
  g.fillRect(0, H - 18, W, 18);
  g.fillStyle = '#ffd60a';
  g.fillRect(0, 18, W, 6);
  g.fillRect(0, H - 24, W, 6);

  // Helper to draw stylized motorsport racing tire icon (tread + silver multi-spoke rim)
  const drawTireIcon = (cx, cy, rad) => {
    g.save();
    // Dynamic yellow/silver speed streaks behind tire
    for (let s = 0; s < 5; s++) {
      const sy = cy - rad * 0.65 + s * rad * 0.32;
      const sl = rad * (1.25 - Math.abs(s - 2) * 0.2);
      g.fillStyle = s % 2 === 0 ? 'rgba(255, 214, 10, 0.85)' : 'rgba(226, 232, 240, 0.72)';
      g.fillRect(cx - rad - sl * 0.85, sy, sl * 0.75, 10);
    }

    // Outer tire carcass + directional tread grooves
    g.beginPath();
    g.arc(cx, cy, rad, 0, Math.PI * 2);
    const tireGrad = g.createRadialGradient(cx - rad * 0.25, cy - rad * 0.25, rad * 0.3, cx, cy, rad);
    tireGrad.addColorStop(0, '#303642');
    tireGrad.addColorStop(0.75, '#171a21');
    tireGrad.addColorStop(1, '#090b0f');
    g.fillStyle = tireGrad;
    g.fill();

    // Tread notches around circumference
    g.strokeStyle = '#07090c';
    g.lineWidth = 10;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * rad * 0.80, cy + Math.sin(a) * rad * 0.80);
      g.lineTo(cx + Math.cos(a + 0.14) * rad * 0.99, cy + Math.sin(a + 0.14) * rad * 0.99);
      g.stroke();
    }

    // Yellow & Crimson motorsport compound sidewall stripe
    g.strokeStyle = '#ffd60a';
    g.lineWidth = 12;
    g.beginPath();
    g.arc(cx, cy, rad * 0.72, -0.4, Math.PI * 0.72);
    g.stroke();
    g.strokeStyle = '#ff2d1a';
    g.beginPath();
    g.arc(cx, cy, rad * 0.72, Math.PI * 0.9, Math.PI * 1.85);
    g.stroke();

    // Metallic silver inner rim & spokes
    g.beginPath();
    g.arc(cx, cy, rad * 0.56, 0, Math.PI * 2);
    const rimGrad = g.createRadialGradient(cx - 18, cy - 18, 10, cx, cy, rad * 0.56);
    rimGrad.addColorStop(0, '#f8fafc');
    rimGrad.addColorStop(0.6, '#94a3b8');
    rimGrad.addColorStop(1, '#475569');
    g.fillStyle = rimGrad;
    g.fill();

    g.beginPath();
    g.arc(cx, cy, rad * 0.44, 0, Math.PI * 2);
    g.fillStyle = '#11151d';
    g.fill();

    // 5 metallic spokes
    g.strokeStyle = '#e2e8f0';
    g.lineWidth = 14;
    g.lineCap = 'round';
    for (let sp = 0; sp < 5; sp++) {
      const ang = (sp / 5) * Math.PI * 2 - 0.3;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(ang) * rad * 0.46, cy + Math.sin(ang) * rad * 0.46);
      g.stroke();
    }

    // Center lock nut
    g.beginPath();
    g.arc(cx, cy, rad * 0.15, 0, Math.PI * 2);
    g.fillStyle = '#e10600';
    g.fill();
    g.strokeStyle = '#f8fafc';
    g.lineWidth = 4;
    g.stroke();
    g.restore();
  };

  drawTireIcon(290, H * 0.5, 148);
  drawTireIcon(W - 220, H * 0.5, 118);

  // Bold Italic Racing Typography: "TOP COOL"
  g.save();
  g.textBaseline = 'middle';
  g.font = 'italic 900 182px "Arial Black", Impact, "Segoe UI", sans-serif';
  const textX = W * 0.53;
  const textY = H * 0.43;

  // Measure combined width to center "TOP " + "COOL" cleanly
  const wTop = g.measureText('TOP ').width;
  const wCool = g.measureText('COOL').width;
  const startX = textX - (wTop + wCool) * 0.5;

  g.textAlign = 'left';
  g.shadowColor = 'rgba(0, 0, 0, 0.72)';
  g.shadowBlur = 18;
  g.shadowOffsetX = 6;
  g.shadowOffsetY = 8;

  // Crisp dark outline
  g.lineWidth = 16;
  g.lineJoin = 'round';
  g.strokeStyle = '#090b10';
  g.strokeText('TOP ', startX, textY);
  g.strokeText('COOL', startX + wTop, textY);

  // "TOP" in championship yellow-gold gradient, "COOL" in bright pure white
  const topGrad = g.createLinearGradient(0, textY - 85, 0, textY + 85);
  topGrad.addColorStop(0, '#fff3b0');
  topGrad.addColorStop(0.45, '#ffd60a');
  topGrad.addColorStop(1, '#f59e0b');
  g.fillStyle = topGrad;
  g.fillText('TOP ', startX, textY);

  const coolGrad = g.createLinearGradient(0, textY - 85, 0, textY + 85);
  coolGrad.addColorStop(0, '#ffffff');
  coolGrad.addColorStop(0.7, '#f1f5f9');
  coolGrad.addColorStop(1, '#cbd5e1');
  g.fillStyle = coolGrad;
  g.fillText('COOL', startX + wTop, textY);
  g.restore();

  // Subtle subtitle "PERFORMANCE TIRES" flanked by silver bars
  g.save();
  g.font = '800 42px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f8fafc';
  g.shadowColor = 'rgba(0, 0, 0, 0.65)';
  g.shadowBlur = 8;
  const subTxt = 'P E R F O R M A N C E   T I R E S';
  g.fillText(subTxt, textX, H * 0.77);

  g.fillStyle = '#e2e8f0';
  g.fillRect(textX - 460, H * 0.77 - 3, 115, 6);
  g.fillRect(textX + 345, H * 0.77 - 3, 115, 6);
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

function makeEsLumutJuniBannerTexture() {
  const W = 1536;
  const H = 384;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  // Fresh emerald-pandan green & icy-cyan gradient background
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#047857');
  bg.addColorStop(0.32, '#10b981');
  bg.addColorStop(0.68, '#06b6d4');
  bg.addColorStop(1, '#0284c7');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // Flowing icy-cyan wave splash across the bottom-right
  g.fillStyle = 'rgba(165, 243, 252, 0.24)';
  g.beginPath();
  g.moveTo(0, H * 0.72);
  g.bezierCurveTo(W * 0.28, H * 0.42, W * 0.62, H * 0.94, W, H * 0.46);
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.closePath();
  g.fill();

  // Secondary creamy pandan-milk swirl
  g.fillStyle = 'rgba(236, 253, 245, 0.16)';
  g.beginPath();
  g.moveTo(0, H * 0.28);
  g.bezierCurveTo(W * 0.35, H * 0.08, W * 0.68, H * 0.48, W, H * 0.16);
  g.lineTo(W, 0);
  g.lineTo(0, 0);
  g.closePath();
  g.fill();

  // Frosty ice-cube helper
  const drawIceCube = (ix, iy, sz, rot, alpha = 0.38) => {
    g.save();
    g.translate(ix, iy);
    g.rotate(rot);
    g.fillStyle = `rgba(224, 242, 254, ${alpha})`;
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.lineWidth = 4;
    const r = sz * 0.18;
    const hw = sz * 0.5;
    g.beginPath();
    g.moveTo(-hw + r, -hw);
    g.lineTo(hw - r, -hw);
    g.quadraticCurveTo(hw, -hw, hw, -hw + r);
    g.lineTo(hw, hw - r);
    g.quadraticCurveTo(hw, hw, hw - r, hw);
    g.lineTo(-hw + r, hw);
    g.quadraticCurveTo(-hw, hw, -hw, hw - r);
    g.lineTo(-hw, -hw + r);
    g.quadraticCurveTo(-hw, -hw, -hw + r, -hw);
    g.closePath();
    g.fill();
    g.stroke();

    // Inner specular highlight facet
    g.fillStyle = 'rgba(255, 255, 255, 0.45)';
    g.fillRect(-hw * 0.62, -hw * 0.62, sz * 0.38, sz * 0.14);
    g.restore();
  };

  // Scattered ice cubes & refreshing splash droplets
  drawIceCube(370, 84, 54, -0.35, 0.34);
  drawIceCube(1260, 110, 62, 0.28, 0.42);
  drawIceCube(1370, 252, 74, -0.22, 0.44);
  drawIceCube(1455, 130, 44, 0.5, 0.36);

  for (const [dx, dy, dr] of [
    [325, 260, 12], [350, 290, 8], [415, 315, 10],
    [1190, 290, 14], [1235, 250, 9], [1310, 88, 11], [1420, 305, 13],
  ]) {
    g.beginPath();
    g.arc(dx, dy, dr, 0, Math.PI * 2);
    g.fillStyle = 'rgba(236, 254, 255, 0.72)';
    g.fill();
  }

  // Refreshing Cold Drink Cup / Moss-Ice (Es Lumut) Illustration on Left
  g.save();
  const cx = 185;
  const cy = 205;

  // Frost halo glow behind cup
  const halo = g.createRadialGradient(cx, cy, 20, cx, cy, 150);
  halo.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
  halo.addColorStop(1, 'rgba(103, 232, 249, 0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(cx, cy, 150, 0, Math.PI * 2);
  g.fill();

  // Striped green/white straw
  g.save();
  g.translate(cx + 12, cy - 110);
  g.rotate(0.24);
  g.fillStyle = '#ffffff';
  g.fillRect(-9, -76, 18, 120);
  g.fillStyle = '#059669';
  for (let sy = -70; sy < 30; sy += 22) {
    g.fillRect(-9, sy, 18, 10);
  }
  g.strokeStyle = '#064e3b';
  g.lineWidth = 3;
  g.strokeRect(-9, -76, 18, 120);
  g.restore();

  // Cup body (tapered clear plastic cup)
  g.beginPath();
  g.moveTo(cx - 72, cy - 58);
  g.lineTo(cx + 72, cy - 58);
  g.lineTo(cx + 52, cy + 122);
  g.lineTo(cx - 52, cy + 122);
  g.closePath();
  const cupGrad = g.createLinearGradient(cx - 70, cy - 58, cx + 70, cy + 122);
  cupGrad.addColorStop(0, '#ecfdf5');
  cupGrad.addColorStop(0.45, '#6ee7b7');
  cupGrad.addColorStop(1, '#047857');
  g.fillStyle = cupGrad;
  g.fill();

  // Pandan moss-jelly ("lumut") ribbons + ice cubes inside cup
  g.save();
  g.clip();
  g.fillStyle = '#065f46';
  for (let m = 0; m < 18; m++) {
    const mx = cx - 55 + ((m * 37) % 110);
    const my = cy - 30 + ((m * 29) % 140);
    g.beginPath();
    g.ellipse(mx, my, 18, 7, (m * 0.7) % Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(255, 255, 255, 0.6)';
  g.fillRect(cx - 60, cy - 42, 120, 26);
  drawIceCube(cx - 22, cy - 22, 34, 0.25, 0.65);
  drawIceCube(cx + 22, cy - 16, 32, -0.3, 0.65);
  g.restore();

  // Cup crisp dark-green outline & dome lid
  g.strokeStyle = '#064e3b';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(cx - 72, cy - 58);
  g.lineTo(cx + 72, cy - 58);
  g.lineTo(cx + 52, cy + 122);
  g.lineTo(cx - 52, cy + 122);
  g.closePath();
  g.stroke();

  g.beginPath();
  g.arc(cx, cy - 58, 72, Math.PI, 0);
  g.fillStyle = 'rgba(224, 242, 254, 0.68)';
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.stroke();
  g.restore();

  // Top & bottom crisp icy-white border accents
  g.fillStyle = '#ecfeff';
  g.fillRect(0, 0, W, 14);
  g.fillRect(0, H - 14, W, 14);
  g.fillStyle = '#064e3b';
  g.fillRect(0, 14, W, 6);
  g.fillRect(0, H - 20, W, 6);

  // Hero Brand Typography: "ES LUMUT JUNI"
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const titleX = W * 0.56;
  const titleY = H * 0.45;
  g.font = '900 118px "Segoe UI", "Trebuchet MS", system-ui, sans-serif';

  g.shadowColor = 'rgba(4, 47, 46, 0.68)';
  g.shadowBlur = 16;
  g.shadowOffsetX = 0;
  g.shadowOffsetY = 8;

  g.lineWidth = 18;
  g.lineJoin = 'round';
  g.strokeStyle = '#064e3b';
  g.strokeText('ES LUMUT JUNI', titleX, titleY);

  g.fillStyle = '#ffffff';
  g.fillText('ES LUMUT JUNI', titleX, titleY);
  g.restore();

  // Refreshing icy-cyan sub-pill bar
  g.save();
  g.fillStyle = '#064e3b';
  const pillW = 470;
  const pillH = 50;
  const px = W * 0.56 - pillW * 0.5;
  const py = H * 0.72;
  g.beginPath();
  g.roundRect(px, py, pillW, pillH, 25);
  g.fill();
  g.strokeStyle = '#a5f3fc';
  g.lineWidth = 3;
  g.stroke();

  g.font = '800 28px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#67e8f9';
  g.fillText('FRESH ICED PANDAN MOSS', W * 0.56, py + pillH * 0.52);
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

function mergeBoxParts(parts) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vertOffset = 0;

  for (const part of parts) {
    const box = new THREE.BoxGeometry(part.w, part.h, part.d);
    if (part.rx) box.rotateX(part.rx);
    if (part.ry) box.rotateY(part.ry);
    if (part.rz) box.rotateZ(part.rz);
    box.translate(part.x || 0, part.y || 0, part.z || 0);

    const pos = box.getAttribute('position');
    const norm = box.getAttribute('normal');
    const uv = box.getAttribute('uv');
    const idx = box.getIndex();
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(vertOffset + idx.getX(i));
    }
    vertOffset += pos.count;
    box.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function makeIBeamPostGeometry() {
  // Galvanized steel I-beam support post (height 1.52m, grounded -0.35..+1.17)
  return mergeBoxParts([
    { w: 0.14, h: 1.52, d: 0.03, x: 0, y: 0.41, z: 0.06 },
    { w: 0.14, h: 1.52, d: 0.03, x: 0, y: 0.41, z: -0.06 },
    { w: 0.032, h: 1.52, d: 0.10, x: 0, y: 0.41, z: 0 },
  ]);
}

function makeCatchFencePoleGeometry() {
  // Vertical mast (1.05..3.25) + cranked inward-angled cantilever arm (tilted +Z toward track)
  return mergeBoxParts([
    { w: 0.08, h: 2.2, d: 0.08, x: 0, y: 2.15, z: 0 },
    { w: 0.075, h: 0.65, d: 0.075, x: 0, y: 3.52, z: 0.17, rx: 0.55 },
    { w: 0.14, h: 0.08, d: 0.18, x: 0, y: 1.12, z: 0 },
  ]);
}

function makeTecproBlockGeometry() {
  // Cushioned Tecpro barrier block with molded vertical energy-absorption ribs
  return mergeBoxParts([
    { w: 2.15, h: 1.06, d: 0.72, x: 0, y: 0.53, z: 0 },
    { w: 0.45, h: 1.10, d: 0.80, x: -0.72, y: 0.55, z: 0 },
    { w: 0.45, h: 1.10, d: 0.80, x: 0, y: 0.55, z: 0 },
    { w: 0.45, h: 1.10, d: 0.80, x: 0.72, y: 0.55, z: 0 },
  ]);
}

function makeLoftedTowerGeo(ringFn, heightSegs, segsAround, uRepeat, vRepeat) {
  // Generic smooth lofted skyscraper geometry grounded at y = 0 .. 1
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let yIdx = 0; yIdx <= heightSegs; yIdx++) {
    const t = yIdx / heightSegs;
    const ring = ringFn(t);
    for (let aIdx = 0; aIdx <= segsAround; aIdx++) {
      const s = aIdx / segsAround;
      const pt = ring[aIdx % segsAround];
      positions.push(pt.x, t, pt.z);
      uvs.push(s * uRepeat, t * vRepeat);
    }
  }

  const stride = segsAround + 1;
  for (let yIdx = 0; yIdx < heightSegs; yIdx++) {
    for (let aIdx = 0; aIdx < segsAround; aIdx++) {
      const a = yIdx * stride + aIdx;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Flat roof cap at t = 1 (facing +Y)
  const topRing = ringFn(1);
  const topCenterIdx = positions.length / 3;
  positions.push(0, 1, 0);
  uvs.push(0.02, 0.96);
  const capStart = positions.length / 3;
  for (let aIdx = 0; aIdx < segsAround; aIdx++) {
    positions.push(topRing[aIdx].x, 1, topRing[aIdx].z);
    uvs.push(0.02, 0.96);
  }
  for (let aIdx = 0; aIdx < segsAround; aIdx++) {
    const next = (aIdx + 1) % segsAround;
    indices.push(topCenterIdx, capStart + next, capStart + aIdx);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeTaperedDiagridTowerGeo(uRepeat, vRepeat) {
  // Archetype A: Etihad / Ping An style chamfered octagonal supertall tapering smoothly 1.0 -> 0.58
  const baseAngles = [0.28, 0.5, 1.07, 1.29, 1.85, 2.07, 2.64, 2.86, 3.42, 3.64, 4.21, 4.43, 4.99, 5.21, 5.78, 6.00];
  return makeLoftedTowerGeo(
    (t) => {
      const taper = 1.0 - 0.42 * Math.pow(t, 1.25);
      const rx = 0.56 * taper;
      const rz = 0.56 * taper;
      return baseAngles.map((ang) => {
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        // Superellipse chamfered cross section
        return {
          x: Math.sign(c) * Math.pow(Math.abs(c), 0.55) * rx,
          z: Math.sign(s) * Math.pow(Math.abs(s), 0.55) * rz,
        };
      });
    },
    14,
    baseAngles.length,
    uRepeat,
    vRepeat
  );
}

function makeTaperedFinsGeo() {
  // Sleek tapered metallic corner fins + crown spire for Archetype A
  const parts = [];
  const corners = [
    [0.44, 0.44], [-0.44, 0.44], [0.44, -0.44], [-0.44, -0.44],
  ];
  for (const [cx, cz] of corners) {
    // Lower + upper angled aerodynamic fin segments tapering inward
    parts.push({ w: 0.048, h: 0.55, d: 0.048, x: cx * 0.94, y: 0.275, z: cz * 0.94, rx: -cz * 0.14, rz: cx * 0.14 });
    parts.push({ w: 0.036, h: 0.52, d: 0.036, x: cx * 0.72, y: 0.76, z: cz * 0.72, rx: -cz * 0.22, rz: cx * 0.22 });
  }
  // Crown perimeter ring & spire
  parts.push({ w: 0.64, h: 0.025, d: 0.64, x: 0, y: 1.005, z: 0 });
  parts.push({ w: 0.032, h: 0.18, d: 0.032, x: 0, y: 1.09, z: 0 });
  return mergeBoxParts(parts);
}

function makeTwistedHelixTowerGeo(uRepeat, vRepeat) {
  // Archetype B1: Cayan / Shenzhen Bay style smooth twisted helical glass tower (y: 0..1)
  const segsAround = 28;
  return makeLoftedTowerGeo(
    (t) => {
      const twist = t * 1.12; // ~64 deg smooth helical twist
      const taper = 1.0 - 0.22 * t;
      const cosT = Math.cos(twist);
      const sinT = Math.sin(twist);
      const pts = [];
      for (let i = 0; i < segsAround; i++) {
        const ang = (i / segsAround) * Math.PI * 2;
        const lx = Math.sign(Math.cos(ang)) * Math.pow(Math.abs(Math.cos(ang)), 0.62) * 0.56 * taper;
        const lz = Math.sign(Math.sin(ang)) * Math.pow(Math.abs(Math.sin(ang)), 0.62) * 0.42 * taper;
        pts.push({
          x: lx * cosT - lz * sinT,
          z: lx * sinT + lz * cosT,
        });
      }
      return pts;
    },
    18,
    segsAround,
    uRepeat,
    vRepeat
  );
}

function makeCurvedSailTowerGeo(uRepeat, vRepeat) {
  // Archetype B2: Sweeping curved sail / teardrop tower (Burj Al Arab / Houhai Bay inspired)
  const segsAround = 28;
  return makeLoftedTowerGeo(
    (t) => {
      const sweepZ = Math.sin(t * Math.PI * 0.72) * 0.14;
      const taperX = 1.0 - 0.46 * Math.pow(t, 1.35);
      const taperZ = 1.0 - 0.34 * Math.pow(t, 1.15);
      const pts = [];
      for (let i = 0; i < segsAround; i++) {
        const ang = (i / segsAround) * Math.PI * 2;
        // Aerodynamic airfoil/sail cross-section
        const lx = Math.cos(ang) * (0.48 + 0.14 * Math.sin(ang)) * taperX;
        const lz = Math.sin(ang) * 0.56 * taperZ + sweepZ;
        pts.push({ x: lx, z: lz });
      }
      return pts;
    },
    16,
    segsAround,
    uRepeat,
    vRepeat
  );
}

function makeChamferedBoxGeo(uRepeat, vRepeat) {
  // Chamfered 8-sided sleek curtain-wall tower prism grounded at y = 0..1
  const segs = 16;
  return makeLoftedTowerGeo(
    () => {
      const pts = [];
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push({
          x: Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.45) * 0.5,
          z: Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.45) * 0.5,
        });
      }
      return pts;
    },
    2,
    segs,
    uRepeat,
    vRepeat
  );
}

function makeOrganicPavilionGeo(uRepeat, vRepeat) {
  // Archetype D: Zaha Hadid-style multi-lobed fluid pavilion extruded upward (y: 0..1)
  const shape = new THREE.Shape();
  const lobes = 28;
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const rad = 0.46 + 0.11 * Math.cos(2 * a) + 0.06 * Math.sin(3 * a);
    const px = Math.cos(a) * rad * 1.15;
    const py = Math.sin(a) * rad * 0.88;
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.92,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.06,
    bevelSegments: 4,
    curveSegments: 28,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.05, 0);

  // Remap cylindrical/ribbon UVs smoothly around perimeter and height
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angleU = (Math.atan2(z, x) / (Math.PI * 2) + 0.5) * uRepeat;
    uv.setXY(i, angleU, y * vRepeat);
  }
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function makePalmTrunkGeometry() {
  // High-segment tapered curved palm trunk with swollen root flare & ringed relief
  const radialSegs = 12;
  const heightSegs = 14;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let yIdx = 0; yIdx <= heightSegs; yIdx++) {
    const t = yIdx / heightSegs;
    const cy = t;
    const bendX = Math.sin(t * Math.PI * 0.78) * 0.14;
    const rootFlare = t < 0.14 ? Math.pow(1 - t / 0.14, 1.6) * 0.22 : 0;
    const ringBump = 1 + Math.sin(t * Math.PI * 26) * 0.032;
    const rad = (THREE.MathUtils.lerp(0.36, 0.19, Math.pow(t, 0.85)) + rootFlare) * ringBump;
    for (let aIdx = 0; aIdx <= radialSegs; aIdx++) {
      const ang = (aIdx / radialSegs) * Math.PI * 2;
      positions.push(bendX + Math.cos(ang) * rad, cy, Math.sin(ang) * rad);
      uvs.push(aIdx / radialSegs, t);
    }
  }
  const stride = radialSegs + 1;
  for (let yIdx = 0; yIdx < heightSegs; yIdx++) {
    for (let aIdx = 0; aIdx < radialSegs; aIdx++) {
      const a = yIdx * stride + aIdx;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makePalmCrownGeometry() {
  // 3-tier arching royal & date palm frond crown with vertex color variation (emerald -> lime)
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  let vertOffset = 0;

  const tiers = [
    { count: 7, pitch: 0.14, droop: 1.68, len: 4.1, width: 1.55, phase: 0.0,  baseL: 0.25, tipL: 0.82 },
    { count: 6, pitch: 0.48, droop: 1.15, len: 3.6, width: 1.42, phase: 0.42, baseL: 0.42, tipL: 0.95 },
    { count: 4, pitch: 0.88, droop: 0.58, len: 2.7, width: 1.15, phase: 0.88, baseL: 0.58, tipL: 1.00 },
  ];

  const cDeep = new THREE.Color(0x2d6a33);
  const cSunlit = new THREE.Color(0x9be24f);
  const cTmpV = new THREE.Color();

  const segs = 8;
  for (const tier of tiers) {
    for (let f = 0; f < tier.count; f++) {
      const yaw = (f / tier.count) * Math.PI * 2 + tier.phase;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const r = t * tier.len;
        const yCenter = t * Math.sin(tier.pitch) * tier.len - t * t * tier.droop;
        const hw = tier.width * 0.5 * Math.sin(Math.min(1, t * 1.08) * Math.PI * 0.86 + 0.14);
        // Subtle 3D V-fold droop along leaflet edges for crisp light/shadow catching
        const edgeY = yCenter - hw * 0.14;

        const lx = cosY * r - sinY * hw;
        const lz = sinY * r + cosY * hw;
        const rx = cosY * r + sinY * hw;
        const rz = sinY * r - cosY * hw;

        positions.push(lx, edgeY, lz, cosY * r, yCenter + 0.04, sinY * r, rx, edgeY, rz);
        uvs.push(0, 1 - t, 0.5, 1 - t, 1, 1 - t);

        const blend = THREE.MathUtils.lerp(tier.baseL, tier.tipL, Math.pow(t, 0.85));
        cTmpV.copy(cDeep).lerp(cSunlit, blend);
        colors.push(
          cTmpV.r * 0.92, cTmpV.g * 0.95, cTmpV.b * 0.92,
          cTmpV.r * 1.04, cTmpV.g * 1.06, cTmpV.b * 1.02,
          cTmpV.r * 0.92, cTmpV.g * 0.95, cTmpV.b * 0.92
        );
      }
      for (let s = 0; s < segs; s++) {
        const a = vertOffset + s * 3;
        indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
        indices.push(a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
      }
      vertOffset += (segs + 1) * 3;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeSpectatorTorsoArmsGeometry() {
  // Multi-part cheering spectator silhouette (tapered torso + raised left/right V-arms)
  const parts = [];

  const torso = new THREE.CylinderGeometry(0.24, 0.30, 0.72, 10);
  torso.translate(0, 0.36, 0);
  parts.push(torso);

  for (const side of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.065, 0.08, 0.48, 7);
    arm.rotateZ(side * -0.44);
    arm.translate(side * 0.30, 0.72, 0);
    parts.push(arm);
  }

  const positions = [];
  const normals = [];
  const indices = [];
  let vertOffset = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const idx = g.getIndex();
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(vertOffset + idx.getX(i));
    }
    vertOffset += p.count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

function makeCrowdFlagGeometry() {
  // Pole + fluttering pennant extending along +X from top of pole
  return mergeBoxParts([
    { w: 0.045, h: 1.55, d: 0.045, x: 0, y: 0.77, z: 0 },
    { w: 0.92, h: 0.56, d: 0.025, x: 0.48, y: 1.24, z: 0 },
  ]);
}

function makeYachtHullGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 14.5);
  s.quadraticCurveTo(4.1, 7.5, 4.4, -3.0);
  s.quadraticCurveTo(4.2, -11.5, 3.3, -13.8);
  s.lineTo(-3.3, -13.8);
  s.quadraticCurveTo(-4.2, -11.5, -4.4, -3.0);
  s.quadraticCurveTo(-4.1, 7.5, 0, 14.5);

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 2.3,
    bevelEnabled: true,
    bevelThickness: 0.45,
    bevelSize: 0.35,
    bevelSegments: 2,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function buildRibbon(samples, offsetLeft, offsetRight, yBias, mat) {
  const N = samples.count;
  const positions = new Float32Array((N + 1) * 2 * 3);
  const normals = new Float32Array((N + 1) * 2 * 3);
  const uvs = new Float32Array((N + 1) * 2 * 2);
  const indices = [];

  for (let i = 0; i <= N; i++) {
    const idx = i % N;
    const p = samples.pos[idx];
    const r = samples.right[idx];
    const vCoord = i / N;

    const lx = p.x + r.x * offsetLeft;
    const ly = p.y + yBias;
    const lz = p.z + r.z * offsetLeft;

    const rx = p.x + r.x * offsetRight;
    const ry = p.y + yBias;
    const rz = p.z + r.z * offsetRight;

    const base = i * 6;
    positions[base] = lx;
    positions[base + 1] = ly;
    positions[base + 2] = lz;
    positions[base + 3] = rx;
    positions[base + 4] = ry;
    positions[base + 5] = rz;

    normals[base] = 0; normals[base + 1] = 1; normals[base + 2] = 0;
    normals[base + 3] = 0; normals[base + 4] = 1; normals[base + 5] = 0;

    const uvBase = i * 4;
    uvs[uvBase] = 0;
    uvs[uvBase + 1] = vCoord;
    uvs[uvBase + 2] = 1;
    uvs[uvBase + 3] = vCoord;

    if (i < N) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildWallRibbon(samples, latOffset, height, thickness, mat) {
  const N = samples.count;
  const positions = [];
  const uvs = [];
  const indices = [];

  const sideSign = Math.sign(latOffset) || 1;
  const innerBase = latOffset - sideSign * (thickness * 0.5);
  const outerBase = latOffset + sideSign * (thickness * 0.5);

  // 12-point triple-beam corrugated Armco W-rail cross section:
  // 10 points up the track-facing corrugated face (hFrac 0..1) + 2 rear wall points (top, bot)
  const profile = [
    { h: 0.00, protrude: -0.02 },
    { h: 0.11, protrude: 0.08 },
    { h: 0.21, protrude: -0.04 },
    { h: 0.31, protrude: 0.08 },
    { h: 0.42, protrude: -0.02 },
    { h: 0.52, protrude: 0.08 },
    { h: 0.62, protrude: -0.04 },
    { h: 0.72, protrude: 0.08 },
    { h: 0.85, protrude: -0.02 },
    { h: 1.00, protrude: 0.06 },
  ];
  const ptsPerRing = profile.length + 2; // + outerTop, outerBot

  for (let i = 0; i <= N; i++) {
    const idx = i % N;
    const p = samples.pos[idx];
    const r = samples.right[idx];
    const uCoord = i / N;
    const y0 = p.y - 0.15;
    const hSpan = height + 0.15;

    for (const pt of profile) {
      const lat = innerBase - sideSign * pt.protrude;
      positions.push(p.x + r.x * lat, y0 + pt.h * hSpan, p.z + r.z * lat);
      uvs.push(uCoord, pt.h);
    }

    const ox = p.x + r.x * outerBase;
    const oz = p.z + r.z * outerBase;
    positions.push(ox, y0 + hSpan, oz);
    uvs.push(uCoord, 1);
    positions.push(ox, y0, oz);
    uvs.push(uCoord, 0);

    if (i < N) {
      const b = i * ptsPerRing;
      const nb = (i + 1) * ptsPerRing;
      for (let s = 0; s < ptsPerRing - 1; s++) {
        const a0 = b + s;
        const a1 = b + s + 1;
        const b0 = nb + s;
        const b1 = nb + s + 1;
        if (sideSign > 0) {
          indices.push(a0, a1, b0, a1, b1, b0);
        } else {
          indices.push(a0, b0, a1, a1, b0, b1);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildCatchFenceRibbon(samples, latOffset, uStart, uEnd, totalLength, mat) {
  const startIdx = Math.max(0, Math.floor(uStart * samples.count));
  const endIdx = Math.min(samples.count, Math.ceil(uEnd * samples.count));
  if (endIdx <= startIdx) return null;

  const sideSign = Math.sign(latOffset) || 1;
  const positions = [];
  const uvs = [];
  const indices = [];
  const segLen = (uEnd - uStart) * totalLength;
  const repeatU = Math.max(1, segLen / 2.6);

  // 3 vertical levels per slice: Armco top (1.15m), vertical top (3.25m), angled inward lip (3.78m, 0.34m inward)
  for (let i = startIdx; i <= endIdx; i++) {
    const idx = i % samples.count;
    const p = samples.pos[idx];
    const r = samples.right[idx];
    const uFrac = ((i - startIdx) / (endIdx - startIdx)) * repeatU;

    const baseLat = latOffset;
    const topLat = latOffset - sideSign * 0.34;

    positions.push(
      p.x + r.x * baseLat, p.y + 1.15, p.z + r.z * baseLat,
      p.x + r.x * baseLat, p.y + 3.25, p.z + r.z * baseLat,
      p.x + r.x * topLat, p.y + 3.78, p.z + r.z * topLat
    );
    uvs.push(uFrac, 0, uFrac, 0.78, uFrac, 1);

    if (i < endIdx) {
      const b = (i - startIdx) * 3;
      const nb = b + 3;
      for (let s = 0; s < 2; s++) {
        indices.push(b + s, b + s + 1, nb + s, b + s + 1, nb + s + 1, nb + s);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.4).normalize() },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorldPos;
      varying float vWave;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float w = sin(wp.x * 0.09 + uTime * 1.6) * 0.25 + cos(wp.z * 0.11 - uTime * 1.3) * 0.22;
        wp.y += w;
        vWave = w;
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      varying vec3 vWorldPos;
      varying float vWave;
      void main() {
        vec3 deep = vec3(0.01, 0.14, 0.28);
        vec3 shallow = vec3(0.02, 0.36, 0.44);
        vec3 skyCol = vec3(0.45, 0.72, 0.90);

        float nx = cos(vWorldPos.x * 0.22 + uTime * 2.1) * 0.08 + sin(vWorldPos.z * 0.31 + uTime * 1.5) * 0.06;
        float nz = sin(vWorldPos.z * 0.25 - uTime * 1.8) * 0.08 + cos(vWorldPos.x * 0.19 - uTime * 1.2) * 0.06;
        vec3 N = normalize(vec3(nx, 1.0, nz));
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.2);

        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 140.0) * 0.75;

        vec3 col = mix(deep, shallow, clamp(vWave * 1.5 + 0.5, 0.0, 1.0));
        col = mix(col, skyCol, clamp(fresnel * 0.55, 0.0, 0.65));
        col += vec3(1.0, 0.94, 0.8) * spec;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export function buildMonacoTrack(scene) {
  const rawSteps = 2400;
  const rawPts = [];
  const rawCum = new Float32Array(rawSteps + 1);
  for (let i = 0; i <= rawSteps; i++) {
    const p = evalCentripetal(TRACK_POINTS, i / rawSteps);
    rawPts.push(p);
    if (i > 0) rawCum[i] = rawCum[i - 1] + p.distanceTo(rawPts[i - 1]);
  }
  const totalLength = rawCum[rawSteps];

  const pos = [];
  const tan = [];
  const right = [];
  let cursor = 0;

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const target = (i / SAMPLE_COUNT) * totalLength;
    while (cursor < rawSteps - 1 && rawCum[cursor + 1] < target) cursor++;
    const segLen = Math.max(1e-6, rawCum[cursor + 1] - rawCum[cursor]);
    const f = (target - rawCum[cursor]) / segLen;
    const p = new THREE.Vector3().lerpVectors(rawPts[cursor], rawPts[cursor + 1], f);
    pos.push(p);
  }

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const pPrev = pos[(i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT];
    const pNext = pos[(i + 1) % SAMPLE_COUNT];
    const t = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
    tan.push(t);
    const r = new THREE.Vector3(-t.z, 0, t.x).normalize();
    right.push(r);
  }

  const samples = { count: SAMPLE_COUNT, pos, tan, right };

  const uAtPoint = (pt) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const d = pos[i].distanceToSquared(pt);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best / SAMPLE_COUNT;
  };

  const startU = uAtPoint(TRACK_POINTS[2]);
  const tunnelStart = uAtPoint(TRACK_POINTS[19]) - 0.006;
  const tunnelEnd = uAtPoint(TRACK_POINTS[21]) + 0.006;

  const drsZones = [
    { uStart: 0.012, uEnd: uAtPoint(TRACK_POINTS[3]) - 0.012 },
    { uStart: uAtPoint(TRACK_POINTS[21]) + 0.012, uEnd: uAtPoint(TRACK_POINTS[23]) - 0.008 },
  ];

  // Track surface & curbs
  const asphaltTex = makeAsphaltTextures();
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: asphaltTex.map,
    roughnessMap: asphaltTex.roughnessMap,
    bumpMap: asphaltTex.bumpMap,
    bumpScale: 0.04,
    roughness: 0.78,
    metalness: 0.05,
    envMapIntensity: 0.7,
  });
  scene.add(buildRibbon(samples, -HALF_WIDTH, HALF_WIDTH, 0.0, asphaltMat));

  const curbMat = new THREE.MeshStandardMaterial({
    map: makeCurbTexture(),
    roughness: 0.65,
    metalness: 0.04,
    envMapIntensity: 0.65,
  });
  scene.add(buildRibbon(samples, -HALF_WIDTH - 1.05, -HALF_WIDTH + 0.05, 0.025, curbMat));
  scene.add(buildRibbon(samples, HALF_WIDTH - 0.05, HALF_WIDTH + 1.05, 0.025, curbMat));

  // Safety barriers: Triple-Beam Corrugated Armco Steel Guardrails
  const armcoTex = makeArmcoTextures();
  const barrierMat = new THREE.MeshStandardMaterial({
    map: armcoTex.map,
    bumpMap: armcoTex.bumpMap,
    bumpScale: 0.08,
    roughnessMap: armcoTex.roughnessMap,
    roughness: 0.35,
    metalness: 0.75,
  });
  scene.add(buildWallRibbon(samples, -HALF_WIDTH - 1.15, 1.15, 0.45, barrierMat));
  scene.add(buildWallRibbon(samples, HALF_WIDTH + 1.15, 1.15, 0.45, barrierMat));

  // Vertical Steel I-Beam Support Posts every 2.5m (single InstancedMesh)
  const postDummy = new THREE.Object3D();
  const iBeamSpecs = [];
  const postStepU = 2.5 / totalLength;
  for (let u = 0; u < 1; u += postStepU) {
    if (u >= tunnelStart && u <= tunnelEnd) continue;
    const idx = Math.floor(u * SAMPLE_COUNT) % SAMPLE_COUNT;
    const p = pos[idx];
    const r = right[idx];
    for (const side of [-1, 1]) {
      iBeamSpecs.push({
        x: p.x + r.x * side * (HALF_WIDTH + 1.38),
        y: p.y,
        z: p.z + r.z * side * (HALF_WIDTH + 1.38),
        yaw: Math.atan2(-side * r.x, -side * r.z),
      });
    }
  }
  if (iBeamSpecs.length) {
    const iBeamMat = new THREE.MeshStandardMaterial({
      color: 0x9aa3ae,
      roughness: 0.38,
      metalness: 0.75,
    });
    const iBeamIM = new THREE.InstancedMesh(makeIBeamPostGeometry(), iBeamMat, iBeamSpecs.length);
    iBeamIM.castShadow = true;
    iBeamIM.receiveShadow = true;
    iBeamSpecs.forEach((spPost, i) => {
      postDummy.position.set(spPost.x, spPost.y, spPost.z);
      postDummy.rotation.set(0, spPost.yaw, 0);
      postDummy.scale.set(1, 1, 1);
      postDummy.updateMatrix();
      iBeamIM.setMatrixAt(i, postDummy.matrix);
    });
    iBeamIM.instanceMatrix.needsUpdate = true;
    iBeamIM.computeBoundingSphere();
    scene.add(iBeamIM);
  }

  // FIA Catch-Fencing & Cranked Steel Fence Poles along Spectator & Harbor Sections
  const fenceTex = makeCatchFenceTextures();
  const catchFenceMat = new THREE.MeshStandardMaterial({
    map: fenceTex.map,
    alphaMap: fenceTex.alphaMap,
    transparent: true,
    alphaTest: 0.14,
    depthWrite: false,
    roughness: 0.45,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });
  const catchFenceZones = [
    { uStart: 0.0, uEnd: 0.145, sides: [-1, 1] },
    { uStart: 0.20, uEnd: 0.36, sides: [-1, 1] },
    { uStart: Math.min(0.88, tunnelEnd + 0.008), uEnd: 0.895, sides: [-1, 1] },
    { uStart: 0.895, uEnd: 1.0, sides: [-1, 1] },
  ];
  const fencePoleSpecs = [];
  const fencePoleStepU = 5.0 / totalLength;
  for (const zone of catchFenceZones) {
    for (const side of zone.sides) {
      const fenceMesh = buildCatchFenceRibbon(
        samples,
        side * (HALF_WIDTH + 1.25),
        zone.uStart,
        zone.uEnd,
        totalLength,
        catchFenceMat
      );
      if (fenceMesh) scene.add(fenceMesh);

      for (let u = zone.uStart; u <= zone.uEnd; u += fencePoleStepU) {
        const idx = Math.floor(u * SAMPLE_COUNT) % SAMPLE_COUNT;
        const p = pos[idx];
        const r = right[idx];
        fencePoleSpecs.push({
          x: p.x + r.x * side * (HALF_WIDTH + 1.28),
          y: p.y,
          z: p.z + r.z * side * (HALF_WIDTH + 1.28),
          yaw: Math.atan2(-side * r.x, -side * r.z),
        });
      }
    }
  }
  if (fencePoleSpecs.length) {
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xa5aeb8,
      roughness: 0.36,
      metalness: 0.78,
    });
    const fencePoleIM = new THREE.InstancedMesh(makeCatchFencePoleGeometry(), poleMat, fencePoleSpecs.length);
    fencePoleIM.castShadow = true;
    fencePoleSpecs.forEach((fp, i) => {
      postDummy.position.set(fp.x, fp.y, fp.z);
      postDummy.rotation.set(0, fp.yaw, 0);
      postDummy.scale.set(1, 1, 1);
      postDummy.updateMatrix();
      fencePoleIM.setMatrixAt(i, postDummy.matrix);
    });
    fencePoleIM.instanceMatrix.needsUpdate = true;
    fencePoleIM.computeBoundingSphere();
    scene.add(fencePoleIM);
  }

  // Cushioned Tecpro Impact Barriers at Sharp Corner Run-Offs (InstancedMesh)
  const tecproCorners = [
    { u: uAtPoint(TRACK_POINTS[4]), side: -1, count: 6, blueTheme: false }, // Sainte-Devote
    { u: uAtPoint(TRACK_POINTS[9]), side: -1, count: 5, blueTheme: true },  // Casino Square
    { u: uAtPoint(TRACK_POINTS[12]), side: -1, count: 5, blueTheme: false }, // Mirabeau
    { u: uAtPoint(TRACK_POINTS[15]), side: -1, count: 6, blueTheme: true },  // Fairmont Hairpin
    { u: uAtPoint(TRACK_POINTS[23]), side: -1, count: 7, blueTheme: false }, // Nouvelle Chicane entry
    { u: uAtPoint(TRACK_POINTS[24]), side: 1, count: 5, blueTheme: true },   // Nouvelle Chicane harbor wall
    { u: uAtPoint(TRACK_POINTS[27]), side: -1, count: 6, blueTheme: false }, // Piscine
    { u: uAtPoint(TRACK_POINTS[31]), side: -1, count: 6, blueTheme: false }, // La Rascasse
    { u: uAtPoint(TRACK_POINTS[33]), side: -1, count: 5, blueTheme: true },  // Anthony Noghes
  ];
  const tecproSpecs = [];
  const blockStepU = 2.2 / totalLength;
  for (const tc of tecproCorners) {
    const startBlockU = tc.u - (tc.count * 0.5) * blockStepU;
    for (let k = 0; k < tc.count; k++) {
      const u = ((startBlockU + k * blockStepU) % 1 + 1) % 1;
      const idx = Math.floor(u * SAMPLE_COUNT) % SAMPLE_COUNT;
      const p = pos[idx];
      const r = right[idx];
      const colHex =
        k % 2 === 1 ? 0xf2efe6 : tc.blueTheme ? 0x0057b8 : 0xe10600;
      tecproSpecs.push({
        x: p.x + r.x * tc.side * (HALF_WIDTH + 0.72),
        y: p.y,
        z: p.z + r.z * tc.side * (HALF_WIDTH + 0.72),
        yaw: Math.atan2(-tc.side * r.x, -tc.side * r.z),
        col: colHex,
      });
    }
  }
  if (tecproSpecs.length) {
    const tecproMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.58,
      metalness: 0.05,
    });
    const tecproIM = new THREE.InstancedMesh(makeTecproBlockGeometry(), tecproMat, tecproSpecs.length);
    const tcColor = new THREE.Color();
    tecproIM.castShadow = true;
    tecproIM.receiveShadow = true;
    tecproSpecs.forEach((tp, i) => {
      postDummy.position.set(tp.x, tp.y, tp.z);
      postDummy.rotation.set(0, tp.yaw, 0);
      postDummy.scale.set(1, 1, 1);
      postDummy.updateMatrix();
      tecproIM.setMatrixAt(i, postDummy.matrix);
      tecproIM.setColorAt(i, tcColor.setHex(tp.col));
    });
    tecproIM.instanceMatrix.needsUpdate = true;
    if (tecproIM.instanceColor) tecproIM.instanceColor.needsUpdate = true;
    tecproIM.computeBoundingSphere();
    scene.add(tecproIM);
  }

  // Marshal Braking Distance Marker Boards (150, 100, 50m before major corners)
  const brakingZones = [
    { cornerU: uAtPoint(TRACK_POINTS[4]), side: -1 },  // Into Sainte-Devote
    { cornerU: uAtPoint(TRACK_POINTS[12]), side: -1 }, // Into Mirabeau
    { cornerU: uAtPoint(TRACK_POINTS[23]), side: -1 }, // Into Nouvelle Chicane
    { cornerU: uAtPoint(TRACK_POINTS[31]), side: -1 }, // Into La Rascasse
  ];
  const distBoardBuckets = { '150': [], '100': [], '50': [] };
  const boardPostSpecs = [];
  for (const bz of brakingZones) {
    for (const [label, metersBack] of [['150', 150], ['100', 100], ['50', 50]]) {
      const u = ((bz.cornerU - metersBack / totalLength) % 1 + 1) % 1;
      if (u >= tunnelStart && u <= tunnelEnd) continue;
      const idx = Math.floor(u * SAMPLE_COUNT) % SAMPLE_COUNT;
      const p = pos[idx];
      const r = right[idx];
      const t = tan[idx];
      const bx = p.x + r.x * bz.side * (HALF_WIDTH + 1.48);
      const bzz = p.z + r.z * bz.side * (HALF_WIDTH + 1.48);
      const faceYaw = Math.atan2(-t.x, -t.z);
      distBoardBuckets[label].push({ x: bx, y: p.y + 1.82, z: bzz, yaw: faceYaw });
      boardPostSpecs.push({ x: bx, y: p.y + 0.9, z: bzz, yaw: faceYaw });
    }
  }
  if (boardPostSpecs.length) {
    const legGeo = new THREE.BoxGeometry(0.08, 1.85, 0.08);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x262c36, metalness: 0.7, roughness: 0.4 });
    const legIM = new THREE.InstancedMesh(legGeo, legMat, boardPostSpecs.length);
    boardPostSpecs.forEach((bp, i) => {
      postDummy.position.set(bp.x, bp.y, bp.z);
      postDummy.rotation.set(0, bp.yaw, 0);
      postDummy.scale.set(1, 1, 1);
      postDummy.updateMatrix();
      legIM.setMatrixAt(i, postDummy.matrix);
    });
    legIM.instanceMatrix.needsUpdate = true;
    legIM.computeBoundingSphere();
    scene.add(legIM);
  }
  const boardGeo = new THREE.BoxGeometry(1.45, 1.05, 0.08);
  for (const label of ['150', '100', '50']) {
    const specs = distBoardBuckets[label];
    if (!specs.length) continue;
    const bMat = new THREE.MeshStandardMaterial({
      map: makeDistanceBoardTexture(label),
      roughness: 0.4,
      metalness: 0.1,
    });
    const bIM = new THREE.InstancedMesh(boardGeo, bMat, specs.length);
    bIM.castShadow = true;
    specs.forEach((spBoard, i) => {
      postDummy.position.set(spBoard.x, spBoard.y, spBoard.z);
      postDummy.rotation.set(0, spBoard.yaw, 0);
      postDummy.scale.set(1, 1, 1);
      postDummy.updateMatrix();
      bIM.setMatrixAt(i, postDummy.matrix);
    });
    bIM.instanceMatrix.needsUpdate = true;
    bIM.computeBoundingSphere();
    scene.add(bIM);
  }

  // DRS zone green strips
  const drsMat = new THREE.MeshStandardMaterial({
    color: 0x22ff88,
    emissive: 0x16cc66,
    emissiveIntensity: 1.4,
    roughness: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  for (const z of drsZones) {
    const startIdx = Math.floor(z.uStart * SAMPLE_COUNT);
    const p = pos[startIdx % SAMPLE_COUNT];
    const r = right[startIdx % SAMPLE_COUNT];
    const t = tan[startIdx % SAMPLE_COUNT];
    const drsLine = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 1.9, 0.04, 0.65), drsMat);
    drsLine.position.set(p.x, p.y + 0.03, p.z);
    drsLine.rotation.y = Math.atan2(-t.x, -t.z);
    scene.add(drsLine);

    // DRS board on right barrier
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 1.1, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x0b1612, emissive: 0x10b981, emissiveIntensity: 0.8 })
    );
    board.position.set(p.x + r.x * (HALF_WIDTH + 1.5), p.y + 2.2, p.z + r.z * (HALF_WIDTH + 1.5));
    board.rotation.y = Math.atan2(-t.x, -t.z);
    scene.add(board);
  }

  // Start / Finish chequered strip & painted grid boxes
  const startIdx = Math.round(startU * SAMPLE_COUNT) % SAMPLE_COUNT;
  const sp = pos[startIdx];
  const st = tan[startIdx];
  const sr = right[startIdx];
  const startYaw = Math.atan2(-st.x, -st.z);

  const sfStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_WIDTH * 1.9, 3.2),
    new THREE.MeshStandardMaterial({
      map: makeStartFinishTexture(),
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  sfStrip.rotation.order = 'YXZ';
  sfStrip.rotation.y = startYaw;
  sfStrip.rotation.x = -Math.PI / 2;
  sfStrip.position.set(sp.x, sp.y + 0.03, sp.z);
  sfStrip.receiveShadow = true;
  scene.add(sfStrip);

  // Painted starting grid boxes (slots 0..7)
  const gridMat = new THREE.MeshBasicMaterial({
    color: 0xf2efe6,
    transparent: true,
    opacity: 0.72,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  for (let slot = 0; slot < 8; slot++) {
    const gu = (startU - 0.004 - slot * 0.0035 + 1) % 1;
    const gIdx = Math.round(gu * SAMPLE_COUNT) % SAMPLE_COUNT;
    const gp = pos[gIdx];
    const gr = right[gIdx];
    const gt = tan[gIdx];
    const side = slot % 2 ? 1 : -1;
    const box = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.4), gridMat);
    box.rotation.order = 'YXZ';
    box.rotation.y = Math.atan2(-gt.x, -gt.z);
    box.rotation.x = -Math.PI / 2;
    box.position.set(gp.x + gr.x * side * 2.3, gp.y + 0.025, gp.z + gr.z * side * 2.3);
    scene.add(box);
  }

  // Custom High-Resolution Sponsor Textures (anisotropy = 16)
  const topCoolTex = makeTopCoolBannerTexture();
  const esLumutTex = makeEsLumutJuniBannerTexture();

  const gantryTrimMat = new THREE.MeshStandardMaterial({ color: 0x161a23, metalness: 0.55, roughness: 0.35 });
  const topCoolFaceMat = new THREE.MeshStandardMaterial({
    map: topCoolTex,
    roughness: 0.36,
    metalness: 0.14,
  });
  const topCoolGantryMats = [
    gantryTrimMat,
    gantryTrimMat,
    gantryTrimMat,
    gantryTrimMat,
    topCoolFaceMat,
    topCoolFaceMat,
  ];
  const esLumutFaceMat = new THREE.MeshStandardMaterial({
    map: esLumutTex,
    roughness: 0.38,
    metalness: 0.10,
  });
  const esLumutBoardMats = [
    gantryTrimMat,
    gantryTrimMat,
    gantryTrimMat,
    gantryTrimMat,
    esLumutFaceMat,
    esLumutFaceMat,
  ];

  // Start gantry bridge + 5 red lights + TOP COOL title sponsor banner
  const gantryGroup = new THREE.Group();
  gantryGroup.position.copy(sp);
  gantryGroup.rotation.y = startYaw;

  const pylonMat = new THREE.MeshStandardMaterial({ color: 0x1e2430, metalness: 0.7, roughness: 0.35 });
  const leftPylon = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7.6, 1.0), pylonMat);
  leftPylon.position.set(-(HALF_WIDTH + 1.6), 3.8, 0);
  const rightPylon = leftPylon.clone();
  rightPylon.position.x = HALF_WIDTH + 1.6;
  const beam = new THREE.Mesh(new THREE.BoxGeometry((HALF_WIDTH + 1.8) * 2, 1.2, 1.2), pylonMat);
  beam.position.set(0, 7.2, 0);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(15.6, 1.26, 1.32), topCoolGantryMats);
  banner.position.set(0, 7.24, 0);
  banner.castShadow = true;
  gantryGroup.add(leftPylon, rightPylon, beam, banner);

  const gantryLights = [];
  const lightGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.25, 16);
  lightGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const lm = new THREE.Mesh(
      lightGeo,
      new THREE.MeshStandardMaterial({
        color: 0x2a0808,
        emissive: 0xff1e00,
        emissiveIntensity: 0.1,
        roughness: 0.2,
      })
    );
    lm.position.set((i - 2) * 1.15, 6.18, 0.55);
    gantryGroup.add(lm);
    gantryLights.push(lm);
  }
  scene.add(gantryGroup);

  // Secondary Overhead Track Sponsor Bridges (TOP COOL)
  const secondaryBridgeUs = [
    uAtPoint(TRACK_POINTS[7]),  // Beau Rivage climb into Casino Square
    uAtPoint(TRACK_POINTS[26]), // Port Hercule harbor straight
  ];
  for (const bu of secondaryBridgeUs) {
    const bIdx = Math.round(bu * SAMPLE_COUNT) % SAMPLE_COUNT;
    const bp = pos[bIdx];
    const bt = tan[bIdx];
    const bridgeGroup = new THREE.Group();
    bridgeGroup.position.copy(bp);
    bridgeGroup.rotation.y = Math.atan2(-bt.x, -bt.z);

    const bLeft = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7.4, 0.9), pylonMat);
    bLeft.position.set(-(HALF_WIDTH + 1.55), 3.7, 0);
    const bRight = bLeft.clone();
    bRight.position.x = HALF_WIDTH + 1.55;
    const bBeam = new THREE.Mesh(new THREE.BoxGeometry((HALF_WIDTH + 1.75) * 2, 1.0, 1.05), pylonMat);
    bBeam.position.set(0, 7.15, 0);
    const bBanner = new THREE.Mesh(new THREE.BoxGeometry(15.2, 1.32, 1.24), topCoolGantryMats);
    bBanner.position.set(0, 7.2, 0);
    bBanner.castShadow = true;
    bridgeGroup.add(bLeft, bRight, bBeam, bBanner);
    scene.add(bridgeGroup);
  }

  // Monaco Tunnel (sculpted ribbed concrete arch + twin continuous ceiling LED strips + wall reflectors)
  const tunStartIdx = Math.floor(tunnelStart * SAMPLE_COUNT);
  const tunEndIdx = Math.ceil(tunnelEnd * SAMPLE_COUNT);

  const makeTunnelConcreteTex = () => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#363d49';
    g.fillRect(0, 0, 512, 512);
    // Subtle concrete aggregate noise & panel formwork lines
    for (let i = 0; i < 3200; i++) {
      const x = (i * 73) % 512;
      const y = (i * 137) % 512;
      const v = 46 + ((i * 29) % 24);
      g.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
      g.fillRect(x, y, 2, 2);
    }
    g.fillStyle = 'rgba(18, 22, 28, 0.45)';
    for (let y = 0; y < 512; y += 128) g.fillRect(0, y, 512, 4);
    for (let x = 0; x < 512; x += 64) g.fillRect(x, 0, 2, 512);
    // Lower tunnel concrete safety-wall band (lighter painted curb-wall skirt)
    g.fillStyle = '#4f5764';
    g.fillRect(0, 0, 48, 512);
    g.fillRect(464, 0, 48, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };

  const tunShellMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: makeTunnelConcreteTex(),
    roughness: 0.82,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const tunHousingMat = new THREE.MeshStandardMaterial({
    color: 0x151921,
    roughness: 0.45,
    metalness: 0.65,
    side: THREE.DoubleSide,
  });
  const tunStripMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffebb8,
    emissiveIntensity: 3.6,
    roughness: 0.15,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const tunPositions = [];
  const tunUvs = [];
  const tunIndices = [];
  const tunArchSteps = 16;
  const tunArchW = HALF_WIDTH + 1.55;
  const tunArchH = 6.45;
  let tVert = 0;

  // Helper to append a continuous quad-strip ribbon along tunnel samples
  const buildTunnelRibbon = (latA, yA, latB, yB) => {
    const rPos = [];
    const rIdx = [];
    let rv = 0;
    for (let i = tunStartIdx; i <= tunEndIdx; i++) {
      const idx = i % SAMPLE_COUNT;
      const p = pos[idx];
      const r = right[idx];
      rPos.push(
        p.x + r.x * latA, p.y + yA, p.z + r.z * latA,
        p.x + r.x * latB, p.y + yB, p.z + r.z * latB
      );
      if (i > tunStartIdx) {
        rIdx.push(rv - 2, rv - 1, rv, rv - 1, rv + 1, rv);
      }
      rv += 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
    geo.setIndex(rIdx);
    geo.computeVertexNormals();
    return geo;
  };

  for (let i = tunStartIdx; i <= tunEndIdx; i++) {
    const idx = i % SAMPLE_COUNT;
    const p = pos[idx];
    const r = right[idx];
    const vCoord = (i - tunStartIdx) * 0.22;
    for (let a = 0; a <= tunArchSteps; a++) {
      const frac = a / tunArchSteps;
      const ang = frac * Math.PI;
      const rx = Math.cos(ang) * tunArchW;
      const ry = Math.sin(ang) * tunArchH - 0.15;
      tunPositions.push(p.x - r.x * rx, p.y + ry, p.z - r.z * rx);
      tunUvs.push(frac, vCoord);
    }
    if (i > tunStartIdx) {
      const prevRow = tVert - (tunArchSteps + 1);
      for (let a = 0; a < tunArchSteps; a++) {
        tunIndices.push(
          prevRow + a, prevRow + a + 1, tVert + a,
          prevRow + a + 1, tVert + a + 1, tVert + a
        );
      }
    }
    tVert += tunArchSteps + 1;
  }
  const tunGeo = new THREE.BufferGeometry();
  tunGeo.setAttribute('position', new THREE.Float32BufferAttribute(tunPositions, 3));
  tunGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tunUvs, 2));
  tunGeo.setIndex(tunIndices);
  tunGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(tunGeo, tunShellMat));

  // Twin Continuous Glowing LED Ceiling Light Strips + Dark Aluminum Mount Housings (Left & Right Lanes)
  scene.add(new THREE.Mesh(buildTunnelRibbon(-3.95, 5.69, -3.35, 5.81), tunHousingMat));
  scene.add(new THREE.Mesh(buildTunnelRibbon(3.35, 5.81, 3.95, 5.69), tunHousingMat));
  scene.add(new THREE.Mesh(buildTunnelRibbon(-3.81, 5.65, -3.49, 5.74), tunStripMat));
  scene.add(new THREE.Mesh(buildTunnelRibbon(3.49, 5.74, 3.81, 5.65), tunStripMat));

  // Structural Concrete Arch Ribs along Tunnel Interior (InstancedMesh)
  const makeTunnelArchRibGeometry = () => {
    const segs = 16;
    const outerW = tunArchW + 0.02;
    const outerH = tunArchH + 0.02;
    const innerW = tunArchW - 0.36;
    const innerH = tunArchH - 0.34;
    const halfD = 0.24;
    const rPos = [];
    const rIdx = [];

    // Helper to push quad
    const pushQuad = (a, b, c, d) => {
      const base = rPos.length / 3;
      rPos.push(...a, ...b, ...c, ...d);
      rIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI;
      const a1 = ((s + 1) / segs) * Math.PI;
      const ox0 = Math.cos(a0) * outerW, oy0 = Math.sin(a0) * outerH - 0.15;
      const ox1 = Math.cos(a1) * outerW, oy1 = Math.sin(a1) * outerH - 0.15;
      const ix0 = Math.cos(a0) * innerW, iy0 = Math.sin(a0) * innerH - 0.15;
      const ix1 = Math.cos(a1) * innerW, iy1 = Math.sin(a1) * innerH - 0.15;

      // Inner soffit face (visible from road)
      pushQuad([ix0, iy0, halfD], [ix1, iy1, halfD], [ix1, iy1, -halfD], [ix0, iy0, -halfD]);
      // Front face (+Z)
      pushQuad([ox0, oy0, halfD], [ox1, oy1, halfD], [ix1, iy1, halfD], [ix0, iy0, halfD]);
      // Back face (-Z)
      pushQuad([ix0, iy0, -halfD], [ix1, iy1, -halfD], [ox1, oy1, -halfD], [ox0, oy0, -halfD]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
    geo.setIndex(rIdx);
    geo.computeVertexNormals();
    return geo;
  };

  const ribSpecs = [];
  for (let i = tunStartIdx; i <= tunEndIdx; i += 3) {
    const idx = i % SAMPLE_COUNT;
    const isPortal = i === tunStartIdx || i + 3 > tunEndIdx;
    ribSpecs.push({
      p: pos[idx],
      t: tan[idx],
      scaleZ: isPortal ? 2.1 : 1.0,
    });
  }
  if (ribSpecs.length) {
    const ribMat = new THREE.MeshStandardMaterial({
      color: 0x464f5e,
      roughness: 0.72,
      metalness: 0.12,
      side: THREE.DoubleSide,
    });
    const ribIM = new THREE.InstancedMesh(makeTunnelArchRibGeometry(), ribMat, ribSpecs.length);
    ribSpecs.forEach((rb, k) => {
      postDummy.position.copy(rb.p);
      postDummy.rotation.order = 'YXZ';
      postDummy.rotation.set(
        Math.asin(THREE.MathUtils.clamp(rb.t.y, -1, 1)),
        Math.atan2(-rb.t.x, -rb.t.z),
        0
      );
      postDummy.scale.set(1, 1, rb.scaleZ);
      postDummy.updateMatrix();
      ribIM.setMatrixAt(k, postDummy.matrix);
    });
    ribIM.instanceMatrix.needsUpdate = true;
    ribIM.computeBoundingSphere();
    scene.add(ribIM);
    postDummy.rotation.order = 'XYZ';
    postDummy.scale.set(1, 1, 1);
  }

  // Thin Amber (Right) & Cool-White (Left) Side Wall Reflector Markers (InstancedMesh)
  const leftReflectorSpecs = [];
  const rightReflectorSpecs = [];
  for (let i = tunStartIdx + 1; i < tunEndIdx; i += 2) {
    const idx = i % SAMPLE_COUNT;
    const p = pos[idx];
    const r = right[idx];
    const t = tan[idx];
    const yaw = Math.atan2(-t.x, -t.z);
    leftReflectorSpecs.push({
      x: p.x - r.x * (HALF_WIDTH + 1.32),
      y: p.y + 1.12,
      z: p.z - r.z * (HALF_WIDTH + 1.32),
      yaw,
    });
    rightReflectorSpecs.push({
      x: p.x + r.x * (HALF_WIDTH + 1.32),
      y: p.y + 1.12,
      z: p.z + r.z * (HALF_WIDTH + 1.32),
      yaw,
    });
  }
  if (leftReflectorSpecs.length) {
    const reflGeo = new THREE.BoxGeometry(0.10, 0.15, 0.96);
    const whiteReflMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xd9f2ff,
      emissiveIntensity: 2.6,
      roughness: 0.2,
    });
    const amberReflMat = new THREE.MeshStandardMaterial({
      color: 0xffd28a,
      emissive: 0xff9a18,
      emissiveIntensity: 2.8,
      roughness: 0.2,
    });
    const leftReflIM = new THREE.InstancedMesh(reflGeo, whiteReflMat, leftReflectorSpecs.length);
    const rightReflIM = new THREE.InstancedMesh(reflGeo, amberReflMat, rightReflectorSpecs.length);
    leftReflectorSpecs.forEach((rf, k) => {
      postDummy.position.set(rf.x, rf.y, rf.z);
      postDummy.rotation.set(0, rf.yaw, 0);
      postDummy.scale.set(1, 1, 1);
      postDummy.updateMatrix();
      leftReflIM.setMatrixAt(k, postDummy.matrix);
    });
    rightReflectorSpecs.forEach((rf, k) => {
      postDummy.position.set(rf.x, rf.y, rf.z);
      postDummy.rotation.set(0, rf.yaw, 0);
      postDummy.scale.set(1, 1, 1);
      postDummy.updateMatrix();
      rightReflIM.setMatrixAt(k, postDummy.matrix);
    });
    leftReflIM.instanceMatrix.needsUpdate = true;
    rightReflIM.instanceMatrix.needsUpdate = true;
    leftReflIM.computeBoundingSphere();
    rightReflIM.computeBoundingSphere();
    scene.add(leftReflIM, rightReflIM);
  }

  // Overhead Tunnel Jet-Fan Ventilation Pods along Center Apex (InstancedMesh)
  const fanGeo = new THREE.CylinderGeometry(0.42, 0.42, 2.2, 14);
  fanGeo.rotateX(Math.PI / 2);
  const fanMat = new THREE.MeshStandardMaterial({ color: 0x1b212b, metalness: 0.68, roughness: 0.36 });
  const fanCount = 4;
  const fanIM = new THREE.InstancedMesh(fanGeo, fanMat, fanCount);
  for (let f = 0; f < fanCount; f++) {
    const frac = (f + 0.5) / fanCount;
    const fIdx = Math.round(THREE.MathUtils.lerp(tunStartIdx, tunEndIdx, frac)) % SAMPLE_COUNT;
    const fp = pos[fIdx];
    const ft = tan[fIdx];
    postDummy.position.set(fp.x, fp.y + 5.72, fp.z);
    postDummy.rotation.set(0, Math.atan2(-ft.x, -ft.z), 0);
    postDummy.scale.set(1, 1, 1);
    postDummy.updateMatrix();
    fanIM.setMatrixAt(f, postDummy.matrix);
  }
  fanIM.instanceMatrix.needsUpdate = true;
  fanIM.computeBoundingSphere();
  scene.add(fanIM);

  // 2 Lightweight Interior Fill Lights (no shadow casting for 60 FPS lock)
  for (const frac of [0.33, 0.67]) {
    const lIdx = Math.round(THREE.MathUtils.lerp(tunStartIdx, tunEndIdx, frac)) % SAMPLE_COUNT;
    const lp = pos[lIdx];
    const fillLight = new THREE.PointLight(0xffe4b8, 22, 105, 1.35);
    fillLight.position.set(lp.x, lp.y + 4.9, lp.z);
    scene.add(fillLight);
  }

  // Explicit Port Hercule harbor water zone (shoreline seawall at x = 732 + NE/SE coves)
  const HARBOR_EDGE_X = 732;
  const isInsideHarborWater = (x, z, margin = 0) => {
    if (x >= HARBOR_EDGE_X - margin) return true;
    if (x >= 680 - margin && z <= -390 + margin) return true;
    if (x >= 560 - margin && z >= 195 - margin) return true;
    if (x >= 500 - margin && (z <= -620 + margin || z >= 340 - margin)) return true;
    return false;
  };

  // Mainland coastal terrain (strictly west of Port Hercule harbor water, elevated above water level)
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(2300, 3600),
    new THREE.MeshStandardMaterial({ color: 0x3b4d38, roughness: 0.95, metalness: 0.0 })
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.set(-650, -0.55, -100);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Mediterranean Port Hercule water (strictly inside harbor basin & eastern seafront)
  const waterMaterial = createWaterMaterial();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2500, 3600, 96, 96), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.set(1750, -1.6, -100);
  scene.add(water);

  // Solid urban quay platform matching the exact land-vs-harbor coastline
  const quayShape = new THREE.Shape();
  quayShape.moveTo(-160, 620);
  quayShape.lineTo(680, 620);
  quayShape.lineTo(680, 390);
  quayShape.lineTo(HARBOR_EDGE_X, 390);
  quayShape.lineTo(HARBOR_EDGE_X, -195);
  quayShape.lineTo(560, -195);
  quayShape.lineTo(560, -340);
  quayShape.lineTo(-160, -340);
  quayShape.closePath();

  const quayGeo = new THREE.ExtrudeGeometry(quayShape, { depth: 2.8, bevelEnabled: false });
  quayGeo.rotateX(-Math.PI / 2);
  quayGeo.translate(0, -3.05, 0);
  const quay = new THREE.Mesh(
    quayGeo,
    new THREE.MeshStandardMaterial({ color: 0x9b9282, roughness: 0.9, metalness: 0.04 })
  );
  quay.receiveShadow = true;
  scene.add(quay);

  // Solid concrete/stone harbor seawall promenade deck separating track/land from Port Hercule
  const promenadeMat = new THREE.MeshStandardMaterial({ color: 0xbcb3a2, roughness: 0.84, metalness: 0.04 });
  const copingMat = new THREE.MeshStandardMaterial({ color: 0xd2cab9, roughness: 0.78 });

  const promenadeDeck = new THREE.Mesh(new THREE.BoxGeometry(20, 2.9, 585), promenadeMat);
  promenadeDeck.position.set(722, -1.47, -97.5);
  promenadeDeck.receiveShadow = true;
  scene.add(promenadeDeck);

  const eastCoping = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.75, 585), copingMat);
  eastCoping.position.set(730.8, 0.25, -97.5);
  eastCoping.receiveShadow = true;
  eastCoping.castShadow = true;
  scene.add(eastCoping);

  const neCopingA = new THREE.Mesh(new THREE.BoxGeometry(52, 0.75, 2.4), copingMat);
  neCopingA.position.set(706, 0.25, -390);
  const neCopingB = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.75, 230), copingMat);
  neCopingB.position.set(680, 0.25, -505);
  const seCopingA = new THREE.Mesh(new THREE.BoxGeometry(172, 0.75, 2.4), copingMat);
  seCopingA.position.set(646, 0.25, 195);
  const seCopingB = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.75, 145), copingMat);
  seCopingB.position.set(560, 0.25, 267.5);
  scene.add(neCopingA, neCopingB, seCopingA, seCopingB);

  // Track clearance helper (prevents any prop/building from overlapping track)
  const nearestSample = (x, z) => {
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < SAMPLE_COUNT; k += 4) {
      const dx = x - pos[k].x;
      const dz = z - pos[k].z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return { idx: best, distSq: bd };
  };

  // --- Shared Futuristic Architectural Materials (5 Bright, Contrasting Luxury Palettes) ---
  const whiteRibbonTex = makeZahaCompositeTextures();
  const silverSkyTex = makeCurtainWallTextures('silverSky');
  const champagneIvoryTex = makeCurtainWallTextures('champagneIvory');
  const pearlTealTex = makeCurtainWallTextures('pearlTeal');
  const coralMarinaTex = makeCurtainWallTextures('coralMarina');
  const helipadTex = makeHelipadTexture();

  const makeTowerMat = (tex, roughness, metalness, clearcoat = 0.65, envInt = 0.85, emsHex = 0xffffff, emsInt = 0.36) =>
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: tex.map,
      roughnessMap: tex.roughnessMap,
      emissive: new THREE.Color(emsHex),
      emissiveMap: tex.emissiveMap,
      emissiveIntensity: emsInt,
      roughness,
      metalness,
      clearcoat,
      clearcoatRoughness: 0.12,
      envMapIntensity: envInt,
      side: THREE.FrontSide,
    });

  // 0: Sleek Pearlescent White & Ribbon Glass
  const whiteRibbonMat = makeTowerMat(whiteRibbonTex, 0.32, 0.42, 0.7, 0.78, 0x9eeeff, 0.38);
  // 1: Bright Silver-Sky & Ice-Blue Curtain Wall
  const silverSkyMat = makeTowerMat(silverSkyTex, 0.24, 0.60, 0.8, 0.95);
  // 2: Warm Champagne Gold & Ivory Limestone
  const champagneIvoryMat = makeTowerMat(champagneIvoryTex, 0.30, 0.50, 0.65, 0.86);
  // 3: Pearl Gray & Frosted Teal Glass
  const pearlTealMat = makeTowerMat(pearlTealTex, 0.28, 0.46, 0.72, 0.88);
  // 4: Modern Coral-Terracotta & White Marina Lofts
  const coralMarinaMat = makeTowerMat(coralMarinaTex, 0.34, 0.40, 0.5, 0.78);

  const towerPaletteMats = [
    whiteRibbonMat,
    silverSkyMat,
    champagneIvoryMat,
    pearlTealMat,
    coralMarinaMat,
  ];
  const makePaletteBuckets = () => [[], [], [], [], []];

  const frameMetalMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.28,
    metalness: 0.64,
    side: THREE.FrontSide,
  });

  const ledCyanMat = new THREE.MeshStandardMaterial({
    color: 0xb8f6ff,
    emissive: 0x38e8ff,
    emissiveIntensity: 2.0,
    roughness: 0.2,
  });

  const ledWarmMat = new THREE.MeshStandardMaterial({
    color: 0xfff4dc,
    emissive: 0xffd580,
    emissiveIntensity: 1.75,
    roughness: 0.2,
  });

  const helipadMat = new THREE.MeshStandardMaterial({
    map: helipadTex,
    roughness: 0.65,
    metalness: 0.2,
  });

  // --- Futuristic Shenzhen, Abu Dhabi & Mediterranean Skyline (4 Archetypes x 5 Contrasting Palettes) ---
  // Archetype A: Tapered Diagrid Supertalls (Etihad / Ping An)
  const taperedLowBuckets = makePaletteBuckets();
  const taperedHighBuckets = makePaletteBuckets();
  const taperedFinsSpecs = [];
  // Archetype B: Twisted Helix & Curved Sail Towers (Cayan / Burj Al Arab / Shenzhen Bay)
  const helixBuckets = makePaletteBuckets();
  const sailBuckets = makePaletteBuckets();
  // Archetype C: Cantilevered Sky-Bridge & Luxury Retail Podium Complexes
  const podiumBuckets = makePaletteBuckets();
  const twinTowerBuckets = makePaletteBuckets();
  const skybridgeBuckets = makePaletteBuckets();
  // Archetype D: Zaha Hadid Fluid Organic Pavilions & Marina Lofts
  const pavilionBuckets = makePaletteBuckets();
  // Architectural LED strips, crown spires & helipads
  const ledCyanSpecs = [];
  const ledWarmSpecs = [];
  const helipadSpecs = [];

  const BUILDING_GROUND_Y = -1.0;
  let lastLeftPal = -1;
  let lastRightPal = -1;
  let lastGlobalPal = -1;
  const pickContrastingPalette = (sideKey, candidates, seed) => {
    const prevSide = sideKey < 0 ? lastLeftPal : lastRightPal;
    const filtered = candidates.filter((p) => p !== prevSide && p !== lastGlobalPal);
    const pool = filtered.length ? filtered : candidates.filter((p) => p !== prevSide);
    const chosen = pool[(seed >>> 0) % pool.length];
    if (sideKey < 0) lastLeftPal = chosen;
    else lastRightPal = chosen;
    lastGlobalPal = chosen;
    return chosen;
  };

  for (let i = 0; i < 168; i++) {
    const idx = Math.floor((i / 168) * SAMPLE_COUNT);
    const p = pos[idx];
    const r = right[idx];
    const side = i % 2 === 0 ? -1 : 1;

    const dist = 27 + ((i * 37) % 60);
    const bx = p.x + r.x * side * dist;
    const bz = p.z + r.z * side * dist;
    const nearHarbor = bx > 580 && bx < 712 && bz > -375 && bz < 180;
    const w = 15 + (i % 4) * 3.5;
    const d = 14 + ((i * 3) % 4) * 3.5;

    // Select archetype cleanly while reserving waterfront promenade plots for organic pavilions
    const isComplex = i % 7 === 0 && dist > 32;
    const isPavilion = !isComplex && ((nearHarbor && i % 2 === 0) || i % 11 === 0);
    const footprintPad = isComplex ? Math.max(w, d) * 1.15 : isPavilion ? Math.max(w, d) * 0.75 : Math.max(w, d) * 0.55;

    // Enforce strict >=12m setback from Port Hercule harbor water edge
    if (isInsideHarborWater(bx, bz, 12 + footprintPad)) continue;

    const near = nearestSample(bx, bz);
    const minDistSq = isComplex ? 680 : 475;
    if (near.distSq < minDistSq) continue; // strict track centerline clearance

    const nearT = tan[near.idx];
    const nearR = right[near.idx];
    const roadYaw = Math.atan2(-nearT.x, -nearT.z);
    const trackY = Math.max(0, pos[near.idx].y);

    if (isPavilion) {
      // Archetype D: Zaha Hadid-style fluid organic pavilion / Marina Lofts grounded to y = -1.0
      const pavH = trackY + 9 + (i % 4) * 2.5 - BUILDING_GROUND_Y;
      const pw = w * 1.28;
      const pd = d * 1.18;
      const palIdx = pickContrastingPalette(side, nearHarbor ? [0, 4, 3] : [0, 3, 4], i * 3 + 1);
      pavilionBuckets[palIdx].push({ x: bx, y: BUILDING_GROUND_Y, z: bz, w: pw, h: pavH, d: pd, yaw: roadYaw });
      // Subtle glowing cyan cove LED eave ring near roofline
      ledCyanSpecs.push({
        x: bx,
        y: BUILDING_GROUND_Y + pavH * 0.92,
        z: bz,
        w: pw * 0.88,
        h: 0.36,
        d: pd * 0.68,
        yaw: roadYaw,
      });
    } else if (isComplex) {
      // Archetype C: Wide glass retail podium + twin towers + glowing mid-level cantilevered skybridge
      const podiumTopH = trackY + 8.5 - BUILDING_GROUND_Y;
      const pw = w * 1.95;
      const pd = d * 1.05;
      const podiumPal = pickContrastingPalette(side, [0, 2, 4, 3], i * 5 + 2);
      podiumBuckets[podiumPal].push({ x: bx, y: BUILDING_GROUND_Y, z: bz, w: pw, h: podiumTopH, d: pd, yaw: roadYaw });

      const towerStories = 28 + ((i * 11) % 24);
      const tH = trackY + towerStories - BUILDING_GROUND_Y;
      const spanOffset = pw * 0.29;
      const cosY = Math.cos(roadYaw);
      const sinY = Math.sin(roadYaw);
      const lx = bx - cosY * spanOffset;
      const lz = bz + sinY * spanOffset;
      const rx = bx + cosY * spanOffset;
      const rz = bz - sinY * spanOffset;

      if (!isInsideHarborWater(lx, lz, 12 + w * 0.45) && !isInsideHarborWater(rx, rz, 12 + w * 0.45)) {
        const twW = w * 0.68;
        const twD = d * 0.68;
        const twChoices = [0, 1, 2, 3].filter((pIdx) => pIdx !== podiumPal);
        const twPal = twChoices[(i * 7) % twChoices.length];
        const sbPal = [1, 2, 3].find((pIdx) => pIdx !== twPal) ?? 1;
        twinTowerBuckets[twPal].push({ x: lx, y: BUILDING_GROUND_Y, z: lz, w: twW, h: tH, d: twD, yaw: roadYaw });
        twinTowerBuckets[twPal].push({ x: rx, y: BUILDING_GROUND_Y, z: rz, w: twW, h: tH * 0.94, d: twD, yaw: roadYaw });

        // Glowing glass skybridge linking the twin towers
        const bridgeY = BUILDING_GROUND_Y + tH * 0.58;
        skybridgeBuckets[sbPal].push({
          x: bx,
          y: bridgeY,
          z: bz,
          w: spanOffset * 1.85,
          h: 3.6,
          d: twD * 0.64,
          yaw: roadYaw,
        });
        ledCyanSpecs.push({
          x: bx,
          y: bridgeY - 1.95,
          z: bz,
          w: spanOffset * 1.82,
          h: 0.32,
          d: twD * 0.56,
          yaw: roadYaw,
        });
        // Helipad on higher twin crown
        helipadSpecs.push({
          x: lx,
          y: BUILDING_GROUND_Y + tH + 0.14,
          z: lz,
          rad: Math.min(twW, twD) * 0.34,
          yaw: roadYaw,
        });
      }
    } else if (i % 3 === 0) {
      // Archetype A: Sculpted Tapered Glass Supertall + external diagonal/corner fins + spire + helipad
      const stories = i % 6 === 0 ? 44 + ((i * 13) % 28) : 26 + ((i * 11) % 18);
      const h = trackY + stories - BUILDING_GROUND_Y;
      const spec = { x: bx, y: BUILDING_GROUND_Y, z: bz, w, h, d, yaw: roadYaw };
      const palIdx = pickContrastingPalette(side, h < 38 ? [0, 1, 2, 3, 4] : [0, 1, 2, 3], i * 7 + 3);

      if (h < 38) taperedLowBuckets[palIdx].push(spec);
      else taperedHighBuckets[palIdx].push(spec);

      taperedFinsSpecs.push(spec);

      // Crown perimeter LED accent + illuminated spire tip
      const ledBucket = i % 2 === 0 ? ledCyanSpecs : ledWarmSpecs;
      ledBucket.push({
        x: bx,
        y: BUILDING_GROUND_Y + h * 0.985,
        z: bz,
        w: w * 0.56,
        h: 0.48,
        d: d * 0.56,
        yaw: roadYaw,
      });
      ledBucket.push({
        x: bx,
        y: BUILDING_GROUND_Y + h * 1.15,
        z: bz,
        w: 0.38,
        h: h * 0.08,
        d: 0.38,
        yaw: roadYaw,
      });
      if (i % 6 === 0) {
        helipadSpecs.push({
          x: bx,
          y: BUILDING_GROUND_Y + h + 0.15,
          z: bz,
          rad: Math.min(w, d) * 0.24,
          yaw: roadYaw,
        });
      }
    } else {
      // Archetype B: Smooth Curved Sail & Twisted Helix Glass Skyscrapers
      const isHelix = i % 2 === 0;
      const stories = 24 + ((i * 17) % 34);
      const h = trackY + stories - BUILDING_GROUND_Y;
      const spec = { x: bx, y: BUILDING_GROUND_Y, z: bz, w, h, d, yaw: roadYaw };
      const candidates = (nearHarbor || stories < 38) ? [0, 1, 2, 3, 4] : [0, 1, 2, 3];
      const palIdx = pickContrastingPalette(side, candidates, i * 11 + 5);

      if (isHelix) helixBuckets[palIdx].push(spec);
      else sailBuckets[palIdx].push(spec);

      // Vertical glowing architectural light strip facing circuit
      const stripX = bx + (nearR.x * (-side)) * (w * 0.36);
      const stripZ = bz + (nearR.z * (-side)) * (d * 0.36);
      const ledBucket = isHelix ? ledCyanSpecs : ledWarmSpecs;
      ledBucket.push({
        x: stripX,
        y: BUILDING_GROUND_Y + h * 0.54,
        z: stripZ,
        w: 0.36,
        h: h * 0.82,
        d: 0.36,
        yaw: roadYaw,
      });
    }
  }

  const dummy = new THREE.Object3D();

  const spawnTowerBatch = (specs, geo, mat, cast = true) => {
    if (!specs.length) return;
    const im = new THREE.InstancedMesh(geo, mat, specs.length);
    im.castShadow = cast;
    im.receiveShadow = true;
    specs.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    scene.add(im);
  };

  const taperedLowGeo = makeTaperedDiagridTowerGeo(2.5, 2.2);
  const taperedHighGeo = makeTaperedDiagridTowerGeo(2.5, 3.6);
  const helixGeo = makeTwistedHelixTowerGeo(3.0, 2.8);
  const sailGeo = makeCurvedSailTowerGeo(3.0, 2.8);
  const podiumGeo = makeChamferedBoxGeo(4.0, 1.0);
  const twinGeo = makeChamferedBoxGeo(2.5, 3.0);
  const pavilionGeo = makeOrganicPavilionGeo(2.5, 1.4);
  const sbGeo = new THREE.BoxGeometry(1, 1, 1);

  for (let p = 0; p < 5; p++) {
    const mat = towerPaletteMats[p];
    spawnTowerBatch(taperedLowBuckets[p], taperedLowGeo, mat);
    spawnTowerBatch(taperedHighBuckets[p], taperedHighGeo, mat);
    spawnTowerBatch(helixBuckets[p], helixGeo, mat);
    spawnTowerBatch(sailBuckets[p], sailGeo, mat);
    spawnTowerBatch(podiumBuckets[p], podiumGeo, mat);
    spawnTowerBatch(twinTowerBuckets[p], twinGeo, mat);
    spawnTowerBatch(pavilionBuckets[p], pavilionGeo, mat);
    if (skybridgeBuckets[p].length) {
      const sbIM = new THREE.InstancedMesh(sbGeo, mat, skybridgeBuckets[p].length);
      sbIM.castShadow = true;
      skybridgeBuckets[p].forEach((sb, i) => {
        dummy.position.set(sb.x, sb.y, sb.z);
        dummy.rotation.set(0, sb.yaw, 0);
        dummy.scale.set(sb.w, sb.h, sb.d);
        dummy.updateMatrix();
        sbIM.setMatrixAt(i, dummy.matrix);
      });
      sbIM.instanceMatrix.needsUpdate = true;
      sbIM.computeBoundingSphere();
      scene.add(sbIM);
    }
  }
  spawnTowerBatch(taperedFinsSpecs, makeTaperedFinsGeo(), frameMetalMat, false);

  // Glowing Architectural LED Accent Strips & Spires
  const spawnLedBatch = (specs, mat) => {
    if (!specs.length) return;
    const ledGeo = new THREE.BoxGeometry(1, 1, 1);
    const ledIM = new THREE.InstancedMesh(ledGeo, mat, specs.length);
    specs.forEach((l, i) => {
      dummy.position.set(l.x, l.y, l.z);
      dummy.rotation.set(0, l.yaw, 0);
      dummy.scale.set(l.w, l.h, l.d);
      dummy.updateMatrix();
      ledIM.setMatrixAt(i, dummy.matrix);
    });
    ledIM.instanceMatrix.needsUpdate = true;
    ledIM.computeBoundingSphere();
    scene.add(ledIM);
  };
  spawnLedBatch(ledCyanSpecs, ledCyanMat);
  spawnLedBatch(ledWarmSpecs, ledWarmMat);

  // Rooftop Helipads
  if (helipadSpecs.length) {
    const hpGeo = new THREE.CylinderGeometry(1, 1.05, 0.35, 20);
    const hpIM = new THREE.InstancedMesh(hpGeo, helipadMat, helipadSpecs.length);
    hpIM.receiveShadow = true;
    helipadSpecs.forEach((hp, i) => {
      dummy.position.set(hp.x, hp.y, hp.z);
      dummy.rotation.set(0, hp.yaw, 0);
      dummy.scale.set(hp.rad, 1, hp.rad);
      dummy.updateMatrix();
      hpIM.setMatrixAt(i, dummy.matrix);
    });
    hpIM.instanceMatrix.needsUpdate = true;
    hpIM.computeBoundingSphere();
    scene.add(hpIM);
  }

  const cTmp = new THREE.Color();

  // --- Landmark: Monte Carlo Casino at Casino Square (TRACK_POINTS[9]) ---
  const casU = uAtPoint(TRACK_POINTS[9]);
  const casIdx = Math.round(casU * SAMPLE_COUNT) % SAMPLE_COUNT;
  const casP = pos[casIdx];
  const casR = right[casIdx];
  const casPos = new THREE.Vector3(casP.x - casR.x * 38, casP.y - 1.2, casP.z - casR.z * 38);
  if (nearestSample(casPos.x, casPos.z).distSq > 500 && !isInsideHarborWater(casPos.x, casPos.z, 38)) {
    const casino = new THREE.Group();
    casino.position.copy(casPos);
    casino.rotation.y = Math.atan2(casP.x - casPos.x, casP.z - casPos.z);

    const casTex = makeCasinoFacadeTextures();
    const casWallMat = new THREE.MeshStandardMaterial({
      map: casTex.map,
      roughnessMap: casTex.roughnessMap,
      roughness: 0.9,
      metalness: 0.15,
      side: THREE.FrontSide,
    });
    const casStoneMat = new THREE.MeshStandardMaterial({ color: 0xe7dcc4, roughness: 0.78 });
    const casCopperMat = new THREE.MeshStandardMaterial({ color: 0x4b8a77, roughness: 0.42, metalness: 0.45 });
    const casGoldMat = new THREE.MeshStandardMaterial({ color: 0xd8b24a, roughness: 0.25, metalness: 0.85 });
    const casSlateMat = new THREE.MeshStandardMaterial({ color: 0x2c3542, roughness: 0.55, metalness: 0.2 });

    // Full-depth stone foundation extending cleanly down to y = -1.0
    const casLocalGroundY = BUILDING_GROUND_Y - casPos.y;
    const plinthH = 2.2 - casLocalGroundY;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(52, plinthH, 30), casStoneMat);
    plinth.position.y = casLocalGroundY + plinthH * 0.5;
    plinth.castShadow = true;
    plinth.receiveShadow = true;

    const mainHall = new THREE.Mesh(new THREE.BoxGeometry(46, 15, 24), casWallMat);
    mainHall.position.y = 9.7;
    mainHall.castShadow = true;
    mainHall.receiveShadow = true;

    const mansard = new THREE.Mesh(new THREE.BoxGeometry(43, 3.6, 21), casSlateMat);
    mansard.position.y = 19.0;

    // Classical front portico with fluted columns & triangular pediment
    const portico = new THREE.Mesh(new THREE.BoxGeometry(18, 12, 5.5), casStoneMat);
    portico.position.set(0, 8.2, 13.0);
    const colGeo = new THREE.CylinderGeometry(0.45, 0.55, 10.5, 12);
    for (let c = -2; c <= 2; c++) {
      const colMesh = new THREE.Mesh(colGeo, casStoneMat);
      colMesh.position.set(c * 3.4, 7.5, 15.9);
      colMesh.castShadow = true;
      casino.add(colMesh);
    }
    const pediment = new THREE.Mesh(new THREE.ConeGeometry(10.5, 3.6, 4), casStoneMat);
    pediment.rotation.y = Math.PI / 4;
    pediment.scale.set(1.25, 1, 0.45);
    pediment.position.set(0, 15.8, 13.6);

    const marquee = new THREE.Mesh(
      new THREE.BoxGeometry(15, 0.9, 4.2),
      new THREE.MeshStandardMaterial({ color: 0x1a1d24, emissive: 0xd8b24a, emissiveIntensity: 0.45, roughness: 0.35 })
    );
    marquee.position.set(0, 4.8, 16.5);

    // Twin copper-domed Belle Epoque corner pavilions
    const towerGeo = new THREE.CylinderGeometry(4.2, 4.5, 18, 14);
    const domeGeo = new THREE.SphereGeometry(4.4, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const spireGeo = new THREE.ConeGeometry(0.45, 3.4, 8);
    [-19.5, 19.5].forEach((tx) => {
      const tw = new THREE.Mesh(towerGeo, casStoneMat);
      tw.position.set(tx, 11.2, 10.5);
      tw.castShadow = true;
      const dm = new THREE.Mesh(domeGeo, casCopperMat);
      dm.position.set(tx, 20.0, 10.5);
      const sp = new THREE.Mesh(spireGeo, casGoldMat);
      sp.position.set(tx, 25.4, 10.5);
      casino.add(tw, dm, sp);
    });

    casino.add(plinth, mainHall, mansard, portico, pediment, marquee);
    scene.add(casino);
  }

  // Shared GPU animation uniforms (driven by engine.ts tick at 60 FPS, zero CPU loops)
  const envTime = { value: 0 };
  const playerPosUniform = { value: new THREE.Vector3() };

  // --- Palm Trees, Landscaped Marble Planters, Coastal Shrubs & Bougainvillea Hedges ---
  const palmSpecs = [];
  const cypressSpecs = [];
  const planterSpecs = [];
  const decoPlanterSpecs = [];

  // Harbor promenade palms & bougainvillea planters (along eastern Port Hercule seawall promenade, >=14m inland)
  for (let z = -340; z <= 130; z += 24) {
    const px = 718;
    if (!isInsideHarborWater(px, z, 12) && nearestSample(px, z).distSq > 260) {
      palmSpecs.push({ x: px, y: -0.05, z, s: 0.94 + ((Math.abs(z) % 5) * 0.05) });
      if (Math.abs(z) % 48 === 0) {
        decoPlanterSpecs.push({ x: px - 3.2, y: -0.05, z: z + 11, yaw: Math.PI * 0.5, s: 1.05 });
      }
    }
  }
  // Circuit & Casino Square palms + hillside cypress trees + landscaped corner bougainvillea planters
  for (let i = 0; i < 126; i++) {
    const idx = Math.floor((i / 126) * SAMPLE_COUNT);
    const p = pos[idx];
    const r = right[idx];
    const t = tan[idx];
    const side = i % 2 === 0 ? -1 : 1;
    const isPalm = i % 2 === 0;
    const dist = isPalm ? 14.2 + (i % 3) * 1.4 : 17.0 + (i % 5) * 4.5;
    const tx = p.x + r.x * side * dist;
    const tz = p.z + r.z * side * dist;
    if (isInsideHarborWater(tx, tz, 12)) continue;
    const near = nearestSample(tx, tz);
    if (near.distSq < 190) continue; // strictly outside Armco barriers
    const nearY = pos[near.idx].y;
    const ty = nearY > 0.6 ? nearY - 0.15 : -0.25;
    if (ty > 0.2) {
      planterSpecs.push({ x: tx, topY: ty + 0.15, rad: isPalm ? 1.45 : 1.75 });
    }
    if (isPalm) {
      palmSpecs.push({ x: tx, y: ty, z: tz, s: 0.88 + (i % 4) * 0.12 });
    } else {
      cypressSpecs.push({ x: tx, y: ty, z: tz, s: 0.85 + (i % 5) * 0.15 });
    }

    // Add sleek modern marble planters with manicured shrubs & bougainvillea along outside corners
    if (i % 3 === 1) {
      const bx = p.x + r.x * -side * 15.2;
      const bz = p.z + r.z * -side * 15.2;
      if (!isInsideHarborWater(bx, bz, 12)) {
        const nearB = nearestSample(bx, bz);
        if (nearB.distSq >= 205) {
          const nearBY = pos[nearB.idx].y;
          decoPlanterSpecs.push({
            x: bx,
            y: nearBY > 0.6 ? nearBY - 0.12 : -0.22,
            z: bz,
            yaw: Math.atan2(t.x, t.z),
            s: 0.92 + (i % 3) * 0.12,
          });
        }
      }
    }
  }

  if (planterSpecs.length) {
    const planterGeo = new THREE.CylinderGeometry(1, 1.12, 1, 12);
    const planterMat = new THREE.MeshStandardMaterial({ color: 0xcbc2b1, roughness: 0.82 });
    const planterIM = new THREE.InstancedMesh(planterGeo, planterMat, planterSpecs.length);
    planterIM.receiveShadow = true;
    planterIM.castShadow = true;
    planterSpecs.forEach((pl, i) => {
      const h = pl.topY - BUILDING_GROUND_Y;
      dummy.position.set(pl.x, BUILDING_GROUND_Y + h * 0.5, pl.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(pl.rad, h, pl.rad);
      dummy.updateMatrix();
      planterIM.setMatrixAt(i, dummy.matrix);
    });
    planterIM.instanceMatrix.needsUpdate = true;
    planterIM.computeBoundingSphere();
    scene.add(planterIM);
  }

  if (palmSpecs.length) {
    const trunkMat = new THREE.MeshStandardMaterial({ map: makePalmTrunkTexture(), roughness: 0.88 });
    const frondTex = makePalmFrondTexture();
    const frondMat = new THREE.MeshStandardMaterial({
      map: frondTex.map,
      alphaMap: frondTex.alphaMap,
      alphaTest: 0.4,
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.68,
    });
    frondMat.customProgramCacheKey = () => 'monaco_palm_breeze_v1';
    frondMat.onBeforeCompile = (shader) => {
      shader.uniforms.uEnvTime = envTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uEnvTime;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 palmOrigin = vec3(0.0);
          #ifdef USE_INSTANCING
            palmOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          float palmPhase = fract(sin(dot(palmOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
          float tipFlex = clamp(length(position.xz) * 0.28, 0.0, 1.25);
          float breeze = sin(uEnvTime * 1.65 + palmPhase + position.x * 0.45 + position.z * 0.35);
          float gust = cos(uEnvTime * 0.85 + palmPhase * 1.7) * 0.55;
          transformed.y += (breeze + gust) * 0.14 * tipFlex * tipFlex;
          transformed.xz += vec2(breeze, gust) * 0.07 * tipFlex;`
        );
    };

    const trunkIM = new THREE.InstancedMesh(makePalmTrunkGeometry(), trunkMat, palmSpecs.length);
    const crownIM = new THREE.InstancedMesh(makePalmCrownGeometry(), frondMat, palmSpecs.length);
    trunkIM.castShadow = true;
    crownIM.castShadow = true;

    const palmTints = [0xf8fff0, 0xe8ffd6, 0xd8f8c4, 0xf2ffe6];
    palmSpecs.forEach((pt, i) => {
      const h = 7.6 * pt.s;
      const yaw = (i * 1.73) % (Math.PI * 2);
      dummy.position.set(pt.x, pt.y, pt.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(pt.s, h, pt.s);
      dummy.updateMatrix();
      trunkIM.setMatrixAt(i, dummy.matrix);

      // Crown anchored cleanly onto top of curved trunk
      const topBendX = Math.sin(Math.PI * 0.78) * 0.14 * pt.s;
      dummy.position.set(pt.x + Math.cos(yaw) * topBendX, pt.y + h - 0.14, pt.z - Math.sin(yaw) * topBendX);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(pt.s);
      dummy.updateMatrix();
      crownIM.setMatrixAt(i, dummy.matrix);
      crownIM.setColorAt(i, cTmp.setHex(palmTints[i % palmTints.length]));
    });
    trunkIM.instanceMatrix.needsUpdate = true;
    crownIM.instanceMatrix.needsUpdate = true;
    if (crownIM.instanceColor) crownIM.instanceColor.needsUpdate = true;
    trunkIM.computeBoundingSphere();
    crownIM.computeBoundingSphere();
    scene.add(trunkIM, crownIM);
  }

  // Landscaped Corner & Promenade Marble Planters with Shrubs & Magenta/Crimson Bougainvillea
  if (decoPlanterSpecs.length) {
    const stoneBoxGeo = mergeBoxParts([
      { w: 4.4, h: 0.65, d: 1.5, x: 0, y: 0.325, z: 0 },
      { w: 4.65, h: 0.14, d: 1.72, x: 0, y: 0.66, z: 0 },
    ]);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.75, metalness: 0.05 });
    const stoneIM = new THREE.InstancedMesh(stoneBoxGeo, stoneMat, decoPlanterSpecs.length);
    stoneIM.castShadow = true;
    stoneIM.receiveShadow = true;

    const plinthGeo = new THREE.BoxGeometry(4.4, 1, 1.5);
    const plinthIM = new THREE.InstancedMesh(plinthGeo, stoneMat, decoPlanterSpecs.length);

    const hedgeGeo = new THREE.IcosahedronGeometry(1, 2);
    const hedgeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
    const shrubCount = decoPlanterSpecs.length * 4;
    const shrubIM = new THREE.InstancedMesh(hedgeGeo, hedgeMat, shrubCount);
    shrubIM.castShadow = true;
    shrubIM.receiveShadow = true;

    const bloomGeo = new THREE.IcosahedronGeometry(1, 1);
    const bloomMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 });
    const bloomCount = decoPlanterSpecs.length * 6;
    const bloomIM = new THREE.InstancedMesh(bloomGeo, bloomMat, bloomCount);

    const greenShades = [0x225a2c, 0x2d7034, 0x3b843c, 0x1c4b25];
    const bloomPalette = [0xd91b6b, 0xe11d48, 0xc026d3, 0xf43f5e];

    decoPlanterSpecs.forEach((dp, i) => {
      const hSub = Math.max(0.4, dp.y - BUILDING_GROUND_Y);
      dummy.position.set(dp.x, BUILDING_GROUND_Y + hSub * 0.5, dp.z);
      dummy.rotation.set(0, dp.yaw, 0);
      dummy.scale.set(dp.s, hSub, dp.s);
      dummy.updateMatrix();
      plinthIM.setMatrixAt(i, dummy.matrix);

      dummy.position.set(dp.x, dp.y, dp.z);
      dummy.rotation.set(0, dp.yaw, 0);
      dummy.scale.setScalar(dp.s);
      dummy.updateMatrix();
      stoneIM.setMatrixAt(i, dummy.matrix);

      const cosY = Math.cos(dp.yaw);
      const sinY = Math.sin(dp.yaw);
      for (let k = 0; k < 4; k++) {
        const lx = (-1.35 + k * 0.9) * dp.s;
        const lz = ((k % 2 === 0) ? -0.14 : 0.14) * dp.s;
        const rx = dp.x + lx * cosY + lz * sinY;
        const rz = dp.z - lx * sinY + lz * cosY;
        const sRad = (0.58 + ((i + k) % 3) * 0.11) * dp.s;
        dummy.position.set(rx, dp.y + 0.88 * dp.s, rz);
        dummy.rotation.set(0, (i + k) * 0.7, 0);
        dummy.scale.set(sRad * 1.15, sRad * 0.88, sRad);
        dummy.updateMatrix();
        shrubIM.setMatrixAt(i * 4 + k, dummy.matrix);
        shrubIM.setColorAt(i * 4 + k, cTmp.setHex(greenShades[(i + k) % greenShades.length]));
      }

      for (let b = 0; b < 6; b++) {
        const lx = (-1.55 + b * 0.62) * dp.s;
        const lz = ((b % 2 === 0) ? 0.28 : -0.26) * dp.s;
        const rx = dp.x + lx * cosY + lz * sinY;
        const rz = dp.z - lx * sinY + lz * cosY;
        const bRad = (0.24 + ((i + b) % 2) * 0.08) * dp.s;
        dummy.position.set(rx, dp.y + (1.06 + (b % 3) * 0.13) * dp.s, rz);
        dummy.rotation.set(b * 0.5, i + b, 0);
        dummy.scale.set(bRad * 1.2, bRad * 0.9, bRad);
        dummy.updateMatrix();
        bloomIM.setMatrixAt(i * 6 + b, dummy.matrix);
        bloomIM.setColorAt(i * 6 + b, cTmp.setHex(bloomPalette[(i + b) % bloomPalette.length]));
      }
    });

    plinthIM.instanceMatrix.needsUpdate = true;
    stoneIM.instanceMatrix.needsUpdate = true;
    shrubIM.instanceMatrix.needsUpdate = true;
    bloomIM.instanceMatrix.needsUpdate = true;
    if (shrubIM.instanceColor) shrubIM.instanceColor.needsUpdate = true;
    if (bloomIM.instanceColor) bloomIM.instanceColor.needsUpdate = true;
    plinthIM.computeBoundingSphere();
    stoneIM.computeBoundingSphere();
    shrubIM.computeBoundingSphere();
    bloomIM.computeBoundingSphere();
    scene.add(plinthIM, stoneIM, shrubIM, bloomIM);
  }

  if (cypressSpecs.length) {
    const cypGeo = new THREE.ConeGeometry(1.35, 7.2, 10);
    cypGeo.translate(0, 3.6, 0);
    const cypMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
    const cypIM = new THREE.InstancedMesh(cypGeo, cypMat, cypressSpecs.length);
    cypIM.castShadow = true;
    cypIM.receiveShadow = true;
    const cypTones = [0x2a4f2d, 0x325b33, 0x244428, 0x3b6738];
    cypressSpecs.forEach((c, i) => {
      dummy.position.set(c.x, c.y, c.z);
      dummy.rotation.set(0, i * 0.8, 0);
      dummy.scale.set(c.s, c.s, c.s);
      dummy.updateMatrix();
      cypIM.setMatrixAt(i, dummy.matrix);
      cypIM.setColorAt(i, cTmp.setHex(cypTones[i % cypTones.length]));
    });
    cypIM.instanceMatrix.needsUpdate = true;
    if (cypIM.instanceColor) cypIM.instanceColor.needsUpdate = true;
    cypIM.computeBoundingSphere();
    scene.add(cypIM);
  }

  // --- Streetlamps along Circuit Perimeter & Harbor Promenade (Strictly >=12m from water) ---
  const lampSpecs = [];
  for (let i = 0; i < 68; i++) {
    const idx = Math.floor((i / 68) * SAMPLE_COUNT);
    const u = idx / SAMPLE_COUNT;
    if (u >= tunnelStart && u <= tunnelEnd) continue;
    const p = pos[idx];
    const r = right[idx];
    const t = tan[idx];
    const side = i % 2 === 0 ? 1 : -1;
    const lx = p.x + r.x * side * (HALF_WIDTH + 2.3);
    const lz = p.z + r.z * side * (HALF_WIDTH + 2.3);
    if (isInsideHarborWater(lx, lz, 12)) continue;
    if (nearestSample(lx, lz).distSq < 112) continue;
    lampSpecs.push({
      x: lx,
      y: p.y,
      z: lz,
      yaw: Math.atan2(-side * r.x, -side * r.z),
      armBias: Math.atan2(t.x, t.z),
    });
  }
  if (lampSpecs.length) {
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.14, 5.4, 7);
    poleGeo.translate(0, 2.7, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1c222a, metalness: 0.72, roughness: 0.35 });
    const bulbGeo = new THREE.SphereGeometry(0.24, 8, 6);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff3cf,
      emissive: 0xffd27a,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    const poleIM = new THREE.InstancedMesh(poleGeo, poleMat, lampSpecs.length);
    const bulbIM = new THREE.InstancedMesh(bulbGeo, bulbMat, lampSpecs.length);
    const elevatedLamps = lampSpecs.filter((l) => l.y > 0.25);
    lampSpecs.forEach((l, i) => {
      dummy.position.set(l.x, l.y, l.z);
      dummy.rotation.set(0, l.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleIM.setMatrixAt(i, dummy.matrix);

      dummy.position.set(l.x + Math.sin(l.yaw) * 0.45, l.y + 5.45, l.z + Math.cos(l.yaw) * 0.45);
      dummy.updateMatrix();
      bulbIM.setMatrixAt(i, dummy.matrix);
    });
    poleIM.instanceMatrix.needsUpdate = true;
    bulbIM.instanceMatrix.needsUpdate = true;
    poleIM.computeBoundingSphere();
    bulbIM.computeBoundingSphere();
    scene.add(poleIM, bulbIM);

    if (elevatedLamps.length) {
      const footGeo = new THREE.CylinderGeometry(0.24, 0.34, 1, 7);
      const footMat = new THREE.MeshStandardMaterial({ color: 0x7a7f87, roughness: 0.85 });
      const footIM = new THREE.InstancedMesh(footGeo, footMat, elevatedLamps.length);
      elevatedLamps.forEach((l, i) => {
        const fh = l.y - BUILDING_GROUND_Y;
        dummy.position.set(l.x, BUILDING_GROUND_Y + fh * 0.5, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, fh, 1);
        dummy.updateMatrix();
        footIM.setMatrixAt(i, dummy.matrix);
      });
      footIM.instanceMatrix.needsUpdate = true;
      footIM.computeBoundingSphere();
      scene.add(footIM);
    }
  }

  // --- Grandstand Bleachers + Enthusiastic Animated Cheering Crowds & Team Flags ---
  const grandstandSpots = [
    { u: (startU + 0.015) % 1, side: 1, dist: 19 },
    { u: uAtPoint(TRACK_POINTS[4]), side: -1, dist: 21 },
    { u: uAtPoint(TRACK_POINTS[25]), side: 1, dist: 19 },
    { u: uAtPoint(TRACK_POINTS[27]), side: 1, dist: 19 },
    { u: uAtPoint(TRACK_POINTS[29]), side: 1, dist: 19 },
    { u: uAtPoint(TRACK_POINTS[31]), side: -1, dist: 20 },
  ];
  const gsSteelMat = new THREE.MeshStandardMaterial({ color: 0x27303d, metalness: 0.65, roughness: 0.4 });
  const gsConcreteMat = new THREE.MeshStandardMaterial({ color: 0x737982, roughness: 0.85 });
  const gsCanopyMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.5, side: THREE.DoubleSide });
  const topCoolFasciaTex = topCoolTex.clone();
  topCoolFasciaTex.wrapS = THREE.RepeatWrapping;
  topCoolFasciaTex.repeat.set(3, 1);
  topCoolFasciaTex.needsUpdate = true;
  const esLumutFasciaTex = esLumutTex.clone();
  esLumutFasciaTex.wrapS = THREE.RepeatWrapping;
  esLumutFasciaTex.repeat.set(3, 1);
  esLumutFasciaTex.needsUpdate = true;

  const gsTrimMat = new THREE.MeshStandardMaterial({ color: 0x161a23, roughness: 0.45 });
  const topCoolFasciaFace = new THREE.MeshStandardMaterial({ map: topCoolFasciaTex, roughness: 0.38, metalness: 0.12 });
  const esLumutFasciaFace = new THREE.MeshStandardMaterial({ map: esLumutFasciaTex, roughness: 0.38, metalness: 0.1 });
  const topCoolFasciaMats = [gsTrimMat, gsTrimMat, gsTrimMat, gsTrimMat, topCoolFasciaFace, topCoolFasciaFace];
  const esLumutFasciaMats = [gsTrimMat, gsTrimMat, gsTrimMat, gsTrimMat, esLumutFasciaFace, esLumutFasciaFace];
  const crowdCoords = [];

  for (let gsIdx = 0; gsIdx < grandstandSpots.length; gsIdx++) {
    const spot = grandstandSpots[gsIdx];
    const idx = Math.round(spot.u * SAMPLE_COUNT) % SAMPLE_COUNT;
    const p = pos[idx];
    const r = right[idx];
    const t = tan[idx];
    const gx = p.x + r.x * spot.side * spot.dist;
    const gz = p.z + r.z * spot.side * spot.dist;
    if (isInsideHarborWater(gx, gz, 25)) continue;
    if (nearestSample(gx, gz).distSq < 280) continue;

    const gsGroup = new THREE.Group();
    gsGroup.position.set(gx, p.y, gz);
    gsGroup.rotation.y = Math.atan2(-spot.side * r.x, -spot.side * r.z);

    // Grounded concrete foundation sub-base reaching down to y = -1.0
    const gsBaseH = p.y + 0.35 - BUILDING_GROUND_Y;
    const gsSubBase = new THREE.Mesh(new THREE.BoxGeometry(26, gsBaseH, 9.2), gsConcreteMat);
    gsSubBase.position.set(0, BUILDING_GROUND_Y - p.y + gsBaseH * 0.5, -3.1);
    gsSubBase.receiveShadow = true;
    gsSubBase.castShadow = true;
    gsGroup.add(gsSubBase);

    // 5 stepped concrete seating tiers
    for (let tier = 0; tier < 5; tier++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(26, 0.85, 1.8), gsConcreteMat);
      step.position.set(0, 0.7 + tier * 1.15, -tier * 1.55);
      step.castShadow = true;
      step.receiveShadow = true;
      gsGroup.add(step);

      // Register world positions for spectator crowd instances (seated/cheering flush on step)
      for (let s = -11.6; s <= 11.6; s += 1.05) {
        const localV = new THREE.Vector3(s, 1.12 + tier * 1.15, -tier * 1.55 + 0.12);
        localV.applyAxisAngle(new THREE.Vector3(0, 1, 0), gsGroup.rotation.y);
        crowdCoords.push({
          x: gx + localV.x,
          y: p.y + localV.y,
          z: gz + localV.z,
          yaw: gsGroup.rotation.y,
          hasFlag: ((Math.round((s + 12) * 3) + tier) % 4 === 0),
        });
      }
    }

    // Rear support pillars & overhead white canopy + sponsor fascia banner
    for (let px = -11; px <= 11; px += 11) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 9.2, 0.55), gsSteelMat);
      post.position.set(px, 4.6, -7.2);
      gsGroup.add(post);
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(27, 0.22, 9.2), gsCanopyMat);
    canopy.position.set(0, 8.8, -3.2);
    canopy.rotation.x = 0.12;
    canopy.castShadow = true;
    const fascia = new THREE.Mesh(
      new THREE.BoxGeometry(27, 1.05, 0.36),
      gsIdx % 2 === 1 ? esLumutFasciaMats : topCoolFasciaMats
    );
    fascia.position.set(0, 8.2, 1.3);
    gsGroup.add(canopy, fascia);
    scene.add(gsGroup);

    void t;
  }

  if (crowdCoords.length) {
    const injectCrowdCheerShader = (mat, key, isFlag = false) => {
      mat.customProgramCacheKey = () => key;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uEnvTime = envTime;
        shader.uniforms.uPlayerPos = playerPosUniform;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>\nuniform float uEnvTime;\nuniform vec3 uPlayerPos;`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vec3 fanOrigin = vec3(0.0);
            #ifdef USE_INSTANCING
              fanOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            #endif
            float fanPhase = fract(sin(dot(fanOrigin.xz, vec2(19.13, 91.7))) * 29431.7) * 6.2831;
            float dCar = length(fanOrigin.xz - uPlayerPos.xz);
            float hype = 1.0 + 1.4 * smoothstep(75.0, 14.0, dCar);
            float cheerBounce = abs(sin(uEnvTime * (3.5 + hype * 1.2) + fanPhase)) * 0.14 * hype;
            transformed.y += cheerBounce;
            ${
              isFlag
                ? `
            float clothMask = smoothstep(0.04, 0.25, position.x);
            transformed.z += sin(uEnvTime * 9.5 + fanPhase + position.x * 5.4) * 0.22 * clothMask * hype;
            transformed.y += cos(uEnvTime * 8.0 + fanPhase + position.x * 4.2) * 0.06 * clothMask * hype;`
                : `
            float armMask = smoothstep(0.32, 0.62, position.y);
            transformed.y += sin(uEnvTime * 7.8 + fanPhase) * 0.065 * armMask * hype;`
            }`
          );
      };
    };

    const torsoGeo = makeSpectatorTorsoArmsGeometry();
    const torsoMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 });
    injectCrowdCheerShader(torsoMat, 'monaco_crowd_torso_v1', false);

    const headGeo = new THREE.SphereGeometry(0.16, 10, 8);
    headGeo.translate(0, 0.88, 0);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 });
    injectCrowdCheerShader(headMat, 'monaco_crowd_head_v1', false);

    const torsoIM = new THREE.InstancedMesh(torsoGeo, torsoMat, crowdCoords.length);
    const headIM = new THREE.InstancedMesh(headGeo, headMat, crowdCoords.length);

    const flagSpecs = crowdCoords.filter((c) => c.hasFlag);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, side: THREE.DoubleSide });
    injectCrowdCheerShader(flagMat, 'monaco_crowd_flag_v1', true);
    const flagIM = flagSpecs.length
      ? new THREE.InstancedMesh(makeCrowdFlagGeometry(), flagMat, flagSpecs.length)
      : null;

    const crowdPalette = [0xe10600, 0xf2efe6, 0x00d2be, 0x3b82f6, 0xffc83d, 0xff8000, 0x10b981, 0x1e293b];
    const headPalette = [0xf2c9ac, 0xd8a17e, 0x8d5524, 0xe10600, 0x00d2be, 0x3b82f6, 0xffc83d];

    crowdCoords.forEach((spSpec, i) => {
      const sy = 0.92 + (i % 3) * 0.09;
      dummy.position.set(spSpec.x, spSpec.y, spSpec.z);
      dummy.rotation.set(0, spSpec.yaw, 0);
      dummy.scale.set(1, sy, 1);
      dummy.updateMatrix();
      torsoIM.setMatrixAt(i, dummy.matrix);
      headIM.setMatrixAt(i, dummy.matrix);
      torsoIM.setColorAt(i, cTmp.setHex(crowdPalette[(i * 7) % crowdPalette.length]));
      headIM.setColorAt(i, cTmp.setHex(headPalette[(i * 5) % headPalette.length]));
    });
    torsoIM.instanceMatrix.needsUpdate = true;
    headIM.instanceMatrix.needsUpdate = true;
    if (torsoIM.instanceColor) torsoIM.instanceColor.needsUpdate = true;
    if (headIM.instanceColor) headIM.instanceColor.needsUpdate = true;
    torsoIM.computeBoundingSphere();
    headIM.computeBoundingSphere();
    scene.add(torsoIM, headIM);

    if (flagIM) {
      flagSpecs.forEach((fs, i) => {
        dummy.position.set(fs.x + 0.25, fs.y + 0.32, fs.z);
        dummy.rotation.set(0, fs.yaw + ((i % 3) - 1) * 0.25, 0);
        dummy.scale.setScalar(1.0);
        dummy.updateMatrix();
        flagIM.setMatrixAt(i, dummy.matrix);
        flagIM.setColorAt(i, cTmp.setHex(crowdPalette[(i * 3) % crowdPalette.length]));
      });
      flagIM.instanceMatrix.needsUpdate = true;
      if (flagIM.instanceColor) flagIM.instanceColor.needsUpdate = true;
      flagIM.computeBoundingSphere();
      scene.add(flagIM);
    }
  }

  // --- Armco Barrier & Corner Run-Off Sponsor Boards (ES LUMUT JUNI + TOP COOL + Circuit Sponsors) ---
  const bannerBuckets = [[], [], [], []];
  for (let i = 0; i < 68; i++) {
    const idx = Math.floor((i / 68) * SAMPLE_COUNT);
    const u = idx / SAMPLE_COUNT;
    if (u >= tunnelStart && u <= tunnelEnd) continue;
    const p = pos[idx];
    const r = right[idx];
    const side = i % 2 === 0 ? 1 : -1;
    const bx = p.x + r.x * side * (HALF_WIDTH + 1.16);
    const bz = p.z + r.z * side * (HALF_WIDTH + 1.16);
    // Prioritize ES LUMUT JUNI (buckets 0 & 2 -> ~50% + harbor/braking zones) and TOP COOL (bucket 1)
    const bucketIdx = i % 4 === 0 ? 0 : i % 4 === 1 ? 1 : i % 4 === 2 ? 0 : 3;
    bannerBuckets[bucketIdx].push({
      x: bx,
      y: p.y + 1.48,
      z: bz,
      yaw: Math.atan2(-side * r.x, -side * r.z),
    });
  }
  // Extra dedicated ES LUMUT JUNI & TOP COOL billboards along braking zones, chicanes & harbor straight
  const highlightBoardSpots = [
    { u: (uAtPoint(TRACK_POINTS[4]) - 0.009 + 1) % 1, side: -1, bucket: 0 }, // Sainte-Devote braking run-off
    { u: uAtPoint(TRACK_POINTS[4]), side: -1, bucket: 0 },                    // Sainte-Devote apex wall
    { u: uAtPoint(TRACK_POINTS[9]), side: -1, bucket: 1 },                    // Casino Square run-off
    { u: uAtPoint(TRACK_POINTS[12]), side: -1, bucket: 0 },                   // Mirabeau braking run-off
    { u: uAtPoint(TRACK_POINTS[15]), side: -1, bucket: 0 },                   // Fairmont Hairpin outer wall
    { u: uAtPoint(TRACK_POINTS[22]), side: 1, bucket: 0 },                    // Harbor straight exit tunnel
    { u: uAtPoint(TRACK_POINTS[23]), side: -1, bucket: 0 },                   // Nouvelle Chicane braking run-off
    { u: uAtPoint(TRACK_POINTS[24]), side: 1, bucket: 1 },                    // Nouvelle Chicane harbor barrier
    { u: uAtPoint(TRACK_POINTS[27]), side: -1, bucket: 0 },                   // Piscine chicane run-off
    { u: uAtPoint(TRACK_POINTS[31]), side: -1, bucket: 0 },                   // La Rascasse corner run-off
    { u: uAtPoint(TRACK_POINTS[33]), side: -1, bucket: 1 },                   // Anthony Noghes wall
  ];
  for (const hb of highlightBoardSpots) {
    const idx = Math.round(hb.u * SAMPLE_COUNT) % SAMPLE_COUNT;
    const p = pos[idx];
    const r = right[idx];
    const t = tan[idx];
    const bx = p.x + r.x * hb.side * (HALF_WIDTH + 1.38);
    const bz = p.z + r.z * hb.side * (HALF_WIDTH + 1.38);
    // Angle slightly toward oncoming drivers (-t) for maximum legibility
    const wallYaw = Math.atan2(-hb.side * r.x, -hb.side * r.z);
    const driverYaw = Math.atan2(-t.x, -t.z);
    const blendYaw = Math.atan2(
      Math.sin(wallYaw) * 0.72 + Math.sin(driverYaw) * 0.28,
      Math.cos(wallYaw) * 0.72 + Math.cos(driverYaw) * 0.28
    );
    bannerBuckets[hb.bucket].push({
      x: bx,
      y: p.y + 2.20,
      z: bz,
      yaw: blendYaw,
      elevated: true,
    });
  }

  const spawnBanners = (specs, mats) => {
    if (!specs.length) return;
    const bGeo = new THREE.BoxGeometry(6.8, 1.35, 0.14);
    const im = new THREE.InstancedMesh(bGeo, mats, specs.length);
    im.castShadow = true;
    specs.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(1, b.elevated ? 1.15 : 0.88, 1);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    scene.add(im);
  };
  const monacoGpFace = new THREE.MeshStandardMaterial({
    map: makeSponsorBannerTexture('#121722', '#e10600', 'MONACO GP', 'MONTE-CARLO STREET CIRCUIT'),
    roughness: 0.42,
    metalness: 0.12,
  });
  const portHerculeFace = new THREE.MeshStandardMaterial({
    map: makeSponsorBannerTexture('#0b2228', '#d8b24a', 'PORT HERCULE', 'PRINCIPAUTÉ DE MONACO'),
    roughness: 0.42,
    metalness: 0.12,
  });

  spawnBanners(bannerBuckets[0], esLumutBoardMats);
  spawnBanners(bannerBuckets[1], topCoolGantryMats);
  spawnBanners(bannerBuckets[2], [gantryTrimMat, gantryTrimMat, gantryTrimMat, gantryTrimMat, portHerculeFace, portHerculeFace]);
  spawnBanners(bannerBuckets[3], [gantryTrimMat, gantryTrimMat, gantryTrimMat, gantryTrimMat, monacoGpFace, monacoGpFace]);

  // --- Port Hercule Moored Superyachts (Strictly inside deep harbor water) ---
  const yachtHullGeo = makeYachtHullGeometry();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.25, metalness: 0.18 });
  const navyHullMat = new THREE.MeshStandardMaterial({ color: 0x16293d, roughness: 0.28, metalness: 0.25 });
  const teakMat = new THREE.MeshStandardMaterial({ color: 0x8f6239, roughness: 0.72, metalness: 0.05 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x101c28, roughness: 0.08, metalness: 0.45 });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0xe6e8ed, roughness: 0.3, metalness: 0.65 });

  for (let y = 0; y < 8; y++) {
    const yx = 772 + (y % 2) * 44;
    const yz = -260 + y * 58;
    if (!isInsideHarborWater(yx, yz, -16)) continue;

    const yacht = new THREE.Group();
    const hull = new THREE.Mesh(yachtHullGeo, y % 3 === 0 ? navyHullMat : hullMat);
    hull.position.y = 0.0;
    hull.castShadow = true;

    const teakDeck = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.22, 18.0), teakMat);
    teakDeck.position.set(0, 2.75, -1.8);

    const mainCabin = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.2, 14.5), hullMat);
    mainCabin.position.set(0, 3.85, -1.2);
    mainCabin.castShadow = true;

    const mainGlass = new THREE.Mesh(new THREE.BoxGeometry(6.35, 0.95, 12.6), glassMat);
    mainGlass.position.set(0, 4.05, -0.7);

    const upperDeck = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.7, 9.2), hullMat);
    upperDeck.position.set(0, 5.75, -1.8);
    upperDeck.castShadow = true;

    const bridgeGlass = new THREE.Mesh(new THREE.BoxGeometry(4.95, 0.75, 7.6), glassMat);
    bridgeGlass.position.set(0, 5.95, -1.2);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 4.4, 8), mastMat);
    mast.position.set(0, 8.7, -1.6);

    const radomeL = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), hullMat);
    radomeL.position.set(-1.1, 7.1, -2.8);
    const radomeR = radomeL.clone();
    radomeR.position.x = 1.1;

    yacht.add(hull, teakDeck, mainCabin, mainGlass, upperDeck, bridgeGlass, mast, radomeL, radomeR);
    const sc = 0.9 + (y % 3) * 0.16;
    yacht.scale.setScalar(sc);
    yacht.position.set(yx, -1.45, yz);
    yacht.rotation.y = -0.35 + (y % 3) * 0.14;
    scene.add(yacht);
  }

  // --- Trackside Repair Coins / Aero-Repair Tokens (14 glowing golden-cyan pickups) ---
  const tokenSpots = [
    { u: (startU + 0.055) % 1, lat: -2.4 }, // Sainte Devote exit
    { u: (startU + 0.115) % 1, lat: 2.2 },  // Beau Rivage climb
    { u: (startU + 0.180) % 1, lat: -1.8 }, // Massenet sweep
    { u: (startU + 0.245) % 1, lat: 2.5 },  // Casino Square exit
    { u: (startU + 0.310) % 1, lat: -2.2 }, // Mirabeau approach
    { u: (startU + 0.380) % 1, lat: 2.4 },  // Fairmont Hairpin exit
    { u: (startU + 0.445) % 1, lat: -2.1 }, // Portier apex
    { u: (startU + 0.515) % 1, lat: 0.0 },  // Monaco Tunnel racing line
    { u: (startU + 0.585) % 1, lat: -2.4 }, // Tunnel exit / Chicane braking
    { u: (startU + 0.655) % 1, lat: 2.2 },  // Nouvelle Chicane exit
    { u: (startU + 0.725) % 1, lat: -2.0 }, // Tabac corner exit
    { u: (startU + 0.795) % 1, lat: 2.3 },  // Piscine complex
    { u: (startU + 0.865) % 1, lat: -2.2 }, // La Rascasse exit
    { u: (startU + 0.935) % 1, lat: 1.8 },  // Anthony Noghes exit
  ];

  const coinOuterGeo = new THREE.TorusGeometry(0.62, 0.095, 12, 28);
  const coinCoreGeo = new THREE.CylinderGeometry(0.49, 0.49, 0.10, 24);
  coinCoreGeo.rotateX(Math.PI / 2);
  const wrenchBarV = new THREE.BoxGeometry(0.14, 0.54, 0.16);
  const wrenchBarH = new THREE.BoxGeometry(0.54, 0.14, 0.16);
  const coinGroundGeo = new THREE.RingGeometry(0.55, 0.78, 28);
  coinGroundGeo.rotateX(-Math.PI / 2);

  const coinGoldMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    emissive: 0xd97706,
    emissiveIntensity: 0.75,
    metalness: 0.85,
    roughness: 0.18,
  });
  const coinCyanMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00d2be,
    emissiveIntensity: 1.45,
    metalness: 0.35,
    roughness: 0.15,
  });
  const coinGroundMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const repairTokens = tokenSpots.map((sp, i) => {
    const idx = Math.round(sp.u * SAMPLE_COUNT) % SAMPLE_COUNT;
    const p = pos[idx];
    const r = right[idx];
    const lat = THREE.MathUtils.clamp(sp.lat, -(HALF_WIDTH - 2.6), HALF_WIDTH - 2.6);
    const tx = p.x + r.x * lat;
    const ty = p.y;
    const tz = p.z + r.z * lat;

    const group = new THREE.Group();
    group.position.set(tx, ty, tz);

    const core = new THREE.Group();
    core.position.y = 0.82;
    core.rotation.y = i * 0.7;

    const outer = new THREE.Mesh(coinOuterGeo, coinGoldMat);
    const disc = new THREE.Mesh(coinCoreGeo, coinCyanMat);
    const barV = new THREE.Mesh(wrenchBarV, coinGoldMat);
    const barH = new THREE.Mesh(wrenchBarH, coinGoldMat);
    core.add(outer, disc, barV, barH);

    const groundRing = new THREE.Mesh(coinGroundGeo, coinGroundMat);
    groundRing.position.y = 0.04;

    group.add(core, groundRing);
    scene.add(group);

    return {
      group,
      core,
      groundRing,
      basePos: new THREE.Vector3(tx, ty, tz),
      u: sp.u,
      phase: i * 0.65,
      cooldown: 0,
      active: true,
    };
  });

  // Checkpoints (checkpoints[0] MUST align with startFinishLine.u)
  const checkpoints = [
    { u: startU, name: 'Start / Finish' },
    { u: uAtPoint(TRACK_POINTS[4]), name: 'Sainte Devote' },
    { u: uAtPoint(TRACK_POINTS[9]), name: 'Casino Square' },
    { u: uAtPoint(TRACK_POINTS[15]), name: 'Fairmont Hairpin' },
    { u: uAtPoint(TRACK_POINTS[18]), name: 'Portier' },
    { u: uAtPoint(TRACK_POINTS[20]), name: 'Monaco Tunnel' },
    { u: uAtPoint(TRACK_POINTS[24]), name: 'Nouvelle Chicane' },
    { u: uAtPoint(TRACK_POINTS[27]), name: 'Piscine' },
    { u: uAtPoint(TRACK_POINTS[31]), name: 'La Rascasse' },
  ];

  const trackCurve = {
    userData: {
      samples,
      length: totalLength,
      halfWidth: HALF_WIDTH,
      waterMaterial,
      asphaltMaterial: asphaltMat,
      curbMaterial: curbMat,
      tunnel: { uStart: tunnelStart, uEnd: tunnelEnd },
      envTime,
      playerPos: playerPosUniform,
    },
  };

  return {
    trackCurve,
    startFinishLine: { u: startU, lights: gantryLights },
    drsZones,
    checkpoints,
    repairTokens,
    weather: 'cerah',
    weatherGrip: 1.0,
    weatherBrake: 1.0,
    weatherTraction: 1.0,
  };
}
