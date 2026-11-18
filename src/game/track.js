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

function makeAsphaltTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#1c1f25';
  g.fillRect(0, 0, 512, 512);

  // Fine asphalt grain
  for (let i = 0; i < 16000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 20 + Math.floor(Math.random() * 26);
    g.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
    g.fillRect(x, y, 2, 2);
  }

  // Darker rubbered racing groove
  const groove = g.createLinearGradient(0, 0, 512, 0);
  groove.addColorStop(0.0, 'rgba(0,0,0,0)');
  groove.addColorStop(0.28, 'rgba(8,10,14,0.28)');
  groove.addColorStop(0.5, 'rgba(5,7,10,0.4)');
  groove.addColorStop(0.72, 'rgba(8,10,14,0.28)');
  groove.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = groove;
  g.fillRect(0, 0, 512, 512);

  // Crisp track boundary white lines
  g.fillStyle = '#e8e4da';
  g.fillRect(10, 0, 7, 512);
  g.fillRect(495, 0, 7, 512);

  // Subtle center lane seam
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(254, 0, 4, 512);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 280);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeCurbTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 256; y += 64) {
    g.fillStyle = (y / 64) % 2 === 0 ? '#e10600' : '#f2efe6';
    g.fillRect(0, y, 128, 64);
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

function makeBarrierTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#c9cdd4';
  g.fillRect(0, 0, 512, 128);
  // Armco horizontal corrugation
  g.fillStyle = '#8b93a0';
  g.fillRect(0, 26, 512, 14);
  g.fillRect(0, 82, 512, 14);
  // Monaco red & white accent stripe
  g.fillStyle = '#e10600';
  g.fillRect(0, 0, 256, 20);
  g.fillStyle = '#f2efe6';
  g.fillRect(256, 0, 256, 20);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(260, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeApartmentFacadeTextures() {
  const W = 512;
  const H = 512;
  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const ag = alb.getContext('2d');

  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const rg = rgh.getContext('2d');

  const bmp = document.createElement('canvas');
  bmp.width = W; bmp.height = H;
  const bg = bmp.getContext('2d');

  // Neutral-warm plaster base (tinted per-instance via setColorAt)
  ag.fillStyle = '#efeae0';
  ag.fillRect(0, 0, W, H);
  rg.fillStyle = 'rgb(220,220,220)';
  rg.fillRect(0, 0, W, H);
  bg.fillStyle = 'rgb(148,148,148)';
  bg.fillRect(0, 0, W, H);

  // Subtle stucco grain
  for (let i = 0; i < 6000; i++) {
    const x = (i * 73) % W;
    const y = (i * 137) % H;
    const v = 228 + (i % 24);
    ag.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
    ag.fillRect(x, y, 2, 2);
  }

  const cols = 4;
  const rows = 4;
  const colW = W / cols;
  const rowH = H / rows;

  for (let r = 0; r < rows; r++) {
    const ry = r * rowH;

    // Horizontal stone cornice moulding per floor
    ag.fillStyle = '#dfd8ca';
    ag.fillRect(0, ry, W, 10);
    ag.fillStyle = 'rgba(40,35,28,0.22)';
    ag.fillRect(0, ry + 10, W, 4);
    bg.fillStyle = 'rgb(220,220,220)';
    bg.fillRect(0, ry, W, 10);
    bg.fillStyle = 'rgb(110,110,110)';
    bg.fillRect(0, ry + 10, W, 4);

    for (let c = 0; c < cols; c++) {
      const cx = c * colW;
      const wx = cx + 28;
      const wy = ry + 26;
      const ww = colW - 56;
      const wh = rowH - 42;

      // Louvered Mediterranean shutters flanking window
      ag.fillStyle = '#4f5d4e';
      ag.fillRect(wx - 15, wy, 14, wh);
      ag.fillRect(wx + ww + 1, wy, 14, wh);
      ag.fillStyle = 'rgba(0,0,0,0.22)';
      for (let sy = wy + 4; sy < wy + wh - 2; sy += 6) {
        ag.fillRect(wx - 14, sy, 12, 2);
        ag.fillRect(wx + ww + 2, sy, 12, 2);
      }
      rg.fillStyle = 'rgb(175,175,175)';
      rg.fillRect(wx - 15, wy, 14, wh);
      rg.fillRect(wx + ww + 1, wy, 14, wh);
      bg.fillStyle = 'rgb(175,175,175)';
      bg.fillRect(wx - 15, wy, 14, wh);
      bg.fillRect(wx + ww + 1, wy, 14, wh);

      // Stone window surround & sill
      ag.fillStyle = '#f6f2ea';
      ag.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      ag.fillStyle = '#d4ccb8';
      ag.fillRect(wx - 7, wy + wh + 2, ww + 14, 7);
      bg.fillStyle = 'rgb(205,205,205)';
      bg.fillRect(wx - 7, wy + wh + 2, ww + 14, 7);

      // Glass interior + diagonal Mediterranean sky glint
      const glassGrad = ag.createLinearGradient(wx, wy, wx + ww, wy + wh);
      glassGrad.addColorStop(0, '#27435a');
      glassGrad.addColorStop(0.45, '#192c3e');
      glassGrad.addColorStop(1, '#101a26');
      ag.fillStyle = glassGrad;
      ag.fillRect(wx, wy, ww, wh);
      ag.fillStyle = 'rgba(170, 220, 255, 0.28)';
      ag.beginPath();
      ag.moveTo(wx + 3, wy + 3);
      ag.lineTo(wx + ww * 0.62, wy + 3);
      ag.lineTo(wx + 3, wy + wh * 0.55);
      ag.closePath();
      ag.fill();

      // Mullion crossbars
      ag.fillStyle = '#ebe5d8';
      ag.fillRect(wx + ww * 0.5 - 2, wy, 4, wh);
      ag.fillRect(wx, wy + wh * 0.48 - 2, ww, 4);

      // Low roughness on glass panes for sunlight reflections
      rg.fillStyle = 'rgb(26,26,26)';
      rg.fillRect(wx, wy, ww, wh);
      bg.fillStyle = 'rgb(52,52,52)';
      bg.fillRect(wx, wy, ww, wh);

      // Wrought-iron Juliet balcony across lower third of window
      const balY = wy + wh * 0.62;
      const balH = wh * 0.38;
      ag.fillStyle = '#1b1f26';
      ag.fillRect(wx - 6, balY, ww + 12, 3);
      ag.fillRect(wx - 6, balY + balH - 3, ww + 12, 3);
      for (let bx = wx - 4; bx <= wx + ww + 4; bx += 7) {
        ag.fillRect(bx, balY, 2, balH);
      }
      rg.fillStyle = 'rgb(96,96,96)';
      rg.fillRect(wx - 6, balY, ww + 12, 3);
      bg.fillStyle = 'rgb(230,230,230)';
      bg.fillRect(wx - 6, balY, ww + 12, 3);
    }
  }

  const map = new THREE.CanvasTexture(alb);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rgh);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bmp);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = 8;

  return { map, roughnessMap, bumpMap };
}

function makeHotelFacadeTextures() {
  const W = 512;
  const H = 512;
  const alb = document.createElement('canvas');
  alb.width = W; alb.height = H;
  const ag = alb.getContext('2d');

  const rgh = document.createElement('canvas');
  rgh.width = W; rgh.height = H;
  const rg = rgh.getContext('2d');

  const bmp = document.createElement('canvas');
  bmp.width = W; bmp.height = H;
  const bg = bmp.getContext('2d');

  // Belle Epoque dressed limestone
  ag.fillStyle = '#f2ede2';
  ag.fillRect(0, 0, W, H);
  rg.fillStyle = 'rgb(212,212,212)';
  rg.fillRect(0, 0, W, H);
  bg.fillStyle = 'rgb(150,150,150)';
  bg.fillRect(0, 0, W, H);

  const cols = 4;
  const rows = 4;
  const colW = W / cols;
  const rowH = H / rows;

  // Vertical classical pilasters
  for (let c = 0; c <= cols; c++) {
    const px = c * colW - 8;
    ag.fillStyle = '#e4dccb';
    ag.fillRect(px, 0, 16, H);
    bg.fillStyle = 'rgb(215,215,215)';
    bg.fillRect(px, 0, 16, H);
  }

  for (let r = 0; r < rows; r++) {
    const ry = r * rowH;

    // Carved floor belt & gilt accent line
    ag.fillStyle = '#dad0bc';
    ag.fillRect(0, ry, W, 12);
    ag.fillStyle = '#c5a04b';
    ag.fillRect(0, ry + 11, W, 2);
    rg.fillStyle = 'rgb(75,75,75)';
    rg.fillRect(0, ry + 11, W, 2);
    bg.fillStyle = 'rgb(230,230,230)';
    bg.fillRect(0, ry, W, 12);

    for (let c = 0; c < cols; c++) {
      const cx = c * colW;
      const wx = cx + 22;
      const wy = ry + 24;
      const ww = colW - 44;
      const wh = rowH - 40;

      // Arched Belle Epoque window recess
      ag.fillStyle = '#d3c9b5';
      ag.fillRect(wx - 4, wy - 4, ww + 8, wh + 6);

      const gGrad = ag.createLinearGradient(wx, wy, wx + ww, wy + wh);
      gGrad.addColorStop(0, '#3a6280');
      gGrad.addColorStop(0.5, '#1d374e');
      gGrad.addColorStop(1, '#0f1e2c');
      ag.fillStyle = gGrad;
      ag.beginPath();
      ag.arc(wx + ww * 0.5, wy + ww * 0.34, ww * 0.5, Math.PI, 0);
      ag.lineTo(wx + ww, wy + wh);
      ag.lineTo(wx, wy + wh);
      ag.closePath();
      ag.fill();

      // Warm hotel suite reflection highlight
      ag.fillStyle = 'rgba(255, 232, 185, 0.22)';
      ag.fillRect(wx + 4, wy + wh * 0.45, ww - 8, wh * 0.48);

      // Fine bronze window mullions
      ag.fillStyle = '#c9b382';
      ag.fillRect(wx + ww * 0.5 - 1.5, wy + 8, 3, wh - 8);
      ag.fillRect(wx, wy + wh * 0.45, ww, 3);

      // Balustrade balcony
      const by = wy + wh * 0.68;
      ag.fillStyle = '#e7dfd0';
      ag.fillRect(wx - 8, by, ww + 16, 4);
      ag.fillRect(wx - 8, wy + wh - 2, ww + 16, 6);
      for (let bx = wx - 4; bx <= wx + ww + 4; bx += 9) {
        ag.fillRect(bx, by + 4, 4, wy + wh - by - 6);
      }

      rg.fillStyle = 'rgb(22,22,22)';
      rg.fillRect(wx, wy + 8, ww, wh * 0.6);
      bg.fillStyle = 'rgb(50,50,50)';
      bg.fillRect(wx, wy + 8, ww, wh * 0.6);
      bg.fillStyle = 'rgb(235,235,235)';
      bg.fillRect(wx - 8, by, ww + 16, wy + wh - by + 4);
    }
  }

  const map = new THREE.CanvasTexture(alb);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rgh);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bmp);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = 8;

  return { map, roughnessMap, bumpMap };
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

function makeTerracottaRoofTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#a84b2c';
  g.fillRect(0, 0, 256, 256);

  const cols = 16;
  const rows = 12;
  const cw = 256 / cols;
  const rh = 256 / rows;
  const tones = ['#b85432', '#9e4326', '#c6613c', '#ad4c2d', '#8e3b20'];

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      g.fillStyle = tones[(r * 7 + col * 3) % tones.length];
      g.fillRect(col * cw, r * rh, cw - 1, rh - 2);
      g.fillStyle = 'rgba(20, 8, 4, 0.28)';
      g.fillRect(col * cw, (r + 1) * rh - 2, cw, 2);
      g.fillRect((col + 1) * cw - 2, r * rh, 2, rh);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeAwningTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = (x / 32) % 2 === 0 ? '#b91c1c' : '#f4efe6';
    g.fillRect(x, 0, 32, 128);
  }
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(0, 108, 256, 20);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePalmTrunkTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#735a40';
  g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 14) {
    g.fillStyle = '#533e2b';
    g.fillRect(0, y, 128, 5);
    g.fillStyle = '#8b7154';
    g.fillRect(0, y + 5, 128, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePalmFrondTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);

  // Central rachis rib
  g.strokeStyle = '#6c8c38';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(128, 254);
  g.lineTo(128, 8);
  g.stroke();

  // Feathered palm leaflets
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    const y = 242 - t * 224;
    const span = Math.sin(Math.pow(t, 0.72) * Math.PI) * 116;
    const tipY = y - 18 - (1 - t) * 14;
    g.fillStyle = i % 2 === 0 ? '#3f7e2f' : '#4f913b';

    g.beginPath();
    g.moveTo(128, y);
    g.quadraticCurveTo(128 - span * 0.55, y - 16, 128 - span, tipY);
    g.quadraticCurveTo(128 - span * 0.5, y - 4, 128, y + 6);
    g.fill();

    g.beginPath();
    g.moveTo(128, y);
    g.quadraticCurveTo(128 + span * 0.55, y - 16, 128 + span, tipY);
    g.quadraticCurveTo(128 + span * 0.5, y - 4, 128, y + 6);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeSponsorBannerTexture(primary, accent, title, sub) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = primary;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = accent;
  g.fillRect(0, 0, 28, 128);
  g.fillRect(484, 0, 28, 128);
  g.fillRect(0, 108, 512, 20);
  g.fillStyle = '#f8f5ec';
  g.font = '900 42px sans-serif';
  g.textAlign = 'center';
  g.fillText(title, 256, 60);
  g.fillStyle = accent;
  g.font = '700 20px sans-serif';
  g.fillText(sub, 256, 92);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeTiledBuildingGeo(uRepeat, vRepeat) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const uv = geo.attributes.uv;
  // Faces 0..5 (4 vertices each): +X, -X, +Y, -Y, +Z, -Z
  for (let face = 0; face < 6; face++) {
    const base = face * 4;
    if (face === 2 || face === 3) {
      for (let v = 0; v < 4; v++) uv.setXY(base + v, 0.02, 0.96);
    } else {
      for (let v = 0; v < 4; v++) {
        uv.setXY(base + v, uv.getX(base + v) * uRepeat, uv.getY(base + v) * vRepeat);
      }
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function makeHipRoofGeometry() {
  const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  geo.rotateY(Math.PI / 4);
  geo.translate(0, 0.5, 0);
  return geo;
}

function makePalmTrunkGeometry() {
  const radialSegs = 7;
  const heightSegs = 7;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let yIdx = 0; yIdx <= heightSegs; yIdx++) {
    const t = yIdx / heightSegs;
    const cy = t;
    const bendX = Math.sin(t * Math.PI * 0.85) * 0.09;
    const rad = THREE.MathUtils.lerp(0.42, 0.22, t);
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
  const positions = [];
  const uvs = [];
  const indices = [];
  let vertOffset = 0;

  const tiers = [
    { count: 6, pitch: 0.22, droop: 1.45, len: 3.7, width: 1.45, phase: 0 },
    { count: 4, pitch: 0.65, droop: 0.85, len: 2.8, width: 1.2, phase: 0.45 },
  ];

  const segs = 5;
  for (const tier of tiers) {
    for (let f = 0; f < tier.count; f++) {
      const yaw = (f / tier.count) * Math.PI * 2 + tier.phase;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const r = t * tier.len;
        const y = t * Math.sin(tier.pitch) * tier.len - t * t * tier.droop;
        const hw = tier.width * 0.5 * Math.sin(Math.min(1, t * 1.1) * Math.PI * 0.85 + 0.15);

        // Left & right edges perpendicular to frond direction
        const lx = cosY * r - sinY * hw;
        const lz = sinY * r + cosY * hw;
        const rx = cosY * r + sinY * hw;
        const rz = sinY * r - cosY * hw;

        positions.push(lx, y, lz, rx, y, rz);
        uvs.push(0, 1 - t, 1, 1 - t);
      }
      for (let s = 0; s < segs; s++) {
        const a = vertOffset + s * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      vertOffset += (segs + 1) * 2;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
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

  const inner = latOffset - Math.sign(latOffset) * (thickness * 0.5);
  const outer = latOffset + Math.sign(latOffset) * (thickness * 0.5);

  for (let i = 0; i <= N; i++) {
    const idx = i % N;
    const p = samples.pos[idx];
    const r = samples.right[idx];
    const v = i / N;

    const ix = p.x + r.x * inner;
    const iz = p.z + r.z * inner;
    const ox = p.x + r.x * outer;
    const oz = p.z + r.z * outer;
    const y0 = p.y - 0.15;
    const y1 = p.y + height;

    // 4 vertices per cross section: inner-bot, inner-top, outer-top, outer-bot
    positions.push(
      ix, y0, iz,
      ix, y1, iz,
      ox, y1, oz,
      ox, y0, oz
    );
    uvs.push(v, 0, v, 1, v, 1, v, 0);

    if (i < N) {
      const b = i * 4;
      const nb = (i + 1) * 4;
      // inner face
      indices.push(b, b + 1, nb, b + 1, nb + 1, nb);
      // top cap
      indices.push(b + 1, b + 2, nb + 1, b + 2, nb + 2, nb + 1);
      // outer face
      indices.push(b + 2, b + 3, nb + 2, b + 3, nb + 3, nb + 2);
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
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: makeAsphaltTexture(),
    roughness: 0.78,
    metalness: 0.06,
  });
  scene.add(buildRibbon(samples, -HALF_WIDTH, HALF_WIDTH, 0.0, asphaltMat));

  const curbMat = new THREE.MeshStandardMaterial({
    map: makeCurbTexture(),
    roughness: 0.65,
    metalness: 0.04,
  });
  scene.add(buildRibbon(samples, -HALF_WIDTH - 1.05, -HALF_WIDTH + 0.05, 0.025, curbMat));
  scene.add(buildRibbon(samples, HALF_WIDTH - 0.05, HALF_WIDTH + 1.05, 0.025, curbMat));

  // Safety barriers
  const barrierMat = new THREE.MeshStandardMaterial({
    map: makeBarrierTexture(),
    roughness: 0.45,
    metalness: 0.35,
  });
  scene.add(buildWallRibbon(samples, -HALF_WIDTH - 1.15, 1.15, 0.45, barrierMat));
  scene.add(buildWallRibbon(samples, HALF_WIDTH + 1.15, 1.15, 0.45, barrierMat));

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

  // Start gantry bridge + 5 red lights
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
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(11, 0.95, 1.28),
    new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.4, metalness: 0.2 })
  );
  banner.position.set(0, 7.25, 0);
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
    lm.position.set((i - 2) * 1.15, 6.25, 0.55);
    gantryGroup.add(lm);
    gantryLights.push(lm);
  }
  scene.add(gantryGroup);

  // Monaco Tunnel (arched concrete shell + warm ceiling light strips)
  const tunStartIdx = Math.floor(tunnelStart * SAMPLE_COUNT);
  const tunEndIdx = Math.ceil(tunnelEnd * SAMPLE_COUNT);
  const tunShellMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f38,
    roughness: 0.85,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const tunLightMat = new THREE.MeshStandardMaterial({
    color: 0xffe4b5,
    emissive: 0xffb84d,
    emissiveIntensity: 2.2,
  });
  const tunPositions = [];
  const tunIndices = [];
  let tVert = 0;
  for (let i = tunStartIdx; i <= tunEndIdx; i += 2) {
    const idx = i % SAMPLE_COUNT;
    const p = pos[idx];
    const r = right[idx];
    const t = tan[idx];
    const archSteps = 7;
    for (let a = 0; a <= archSteps; a++) {
      const ang = (a / archSteps) * Math.PI;
      const rx = Math.cos(ang) * (HALF_WIDTH + 1.5);
      const ry = Math.sin(ang) * 6.4;
      tunPositions.push(p.x - r.x * rx, p.y + ry, p.z - r.z * rx);
    }
    if (i > tunStartIdx) {
      const prevRow = tVert - (archSteps + 1);
      for (let a = 0; a < archSteps; a++) {
        tunIndices.push(
          prevRow + a, prevRow + a + 1, tVert + a,
          prevRow + a + 1, tVert + a + 1, tVert + a
        );
      }
    }
    tVert += archSteps + 1;

    if (i % 6 === 0) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 1.4), tunLightMat);
      lamp.position.set(p.x, p.y + 5.95, p.z);
      lamp.rotation.y = Math.atan2(-t.x, -t.z);
      scene.add(lamp);
    }
  }
  const tunGeo = new THREE.BufferGeometry();
  tunGeo.setAttribute('position', new THREE.Float32BufferAttribute(tunPositions, 3));
  tunGeo.setIndex(tunIndices);
  tunGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(tunGeo, tunShellMat));

  // Ground terrain & Mediterranean Port Hercule water
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(3600, 3600),
    new THREE.MeshStandardMaterial({ color: 0x3b4d38, roughness: 0.95, metalness: 0.0 })
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.set(320, -2.4, -120);
  terrain.receiveShadow = true;
  scene.add(terrain);

  const waterMaterial = createWaterMaterial();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2200, 96, 96), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.set(860, -1.6, -20);
  scene.add(water);

  // Harbor seawall quay & promenade coping
  const quay = new THREE.Mesh(
    new THREE.BoxGeometry(690, 3.0, 760),
    new THREE.MeshStandardMaterial({ color: 0x9b9282, roughness: 0.9, metalness: 0.04 })
  );
  quay.position.set(380, -1.55, -140);
  quay.receiveShadow = true;
  scene.add(quay);

  const coping = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.35, 760),
    new THREE.MeshStandardMaterial({ color: 0xc9c0b0, roughness: 0.8 })
  );
  coping.position.set(724, -0.05, -140);
  coping.receiveShadow = true;
  scene.add(coping);

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

  // --- Shared Architectural Materials & Geometries ---
  const aptTex = makeApartmentFacadeTextures();
  const aptMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: aptTex.map,
    roughnessMap: aptTex.roughnessMap,
    bumpMap: aptTex.bumpMap,
    bumpScale: 0.18,
    roughness: 0.95,
    metalness: 0.08,
  });

  const hotelTex = makeHotelFacadeTextures();
  const hotelMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: hotelTex.map,
    roughnessMap: hotelTex.roughnessMap,
    bumpMap: hotelTex.bumpMap,
    bumpScale: 0.22,
    roughness: 0.92,
    metalness: 0.14,
  });

  const roofMat = new THREE.MeshStandardMaterial({
    map: makeTerracottaRoofTexture(),
    roughness: 0.78,
    metalness: 0.04,
  });

  const terraceMat = new THREE.MeshStandardMaterial({
    color: 0xcbc2b2,
    roughness: 0.82,
    metalness: 0.05,
  });

  const awningMat = new THREE.MeshStandardMaterial({
    map: makeAwningTexture(),
    roughness: 0.85,
    side: THREE.DoubleSide,
  });

  // --- Mediterranean City Skyline (Apartments, Luxury Hotels, Setbacks & Roofs) ---
  const aptLowSpecs = [];
  const aptMidSpecs = [];
  const hotelSpecs = [];
  const roofSpecs = [];
  const awningSpecs = [];

  const aptPalette = [0xf2e6d4, 0xe8c499, 0xdfa78b, 0xdfd9ca, 0xcad6c5, 0xead4b4, 0xd8b29b];
  const hotelPalette = [0xf7f2e8, 0xebe3d3, 0xe7dfd5, 0xf2e9dc];

  for (let i = 0; i < 168; i++) {
    const idx = Math.floor((i / 168) * SAMPLE_COUNT);
    const p = pos[idx];
    const r = right[idx];
    const side = i % 2 === 0 ? -1 : 1;

    // Keep Port Hercule harbor vista open along the eastern seafront
    if (side === 1 && p.x > 520 && p.z > -370 && p.z < 140) continue;

    const dist = 25 + ((i * 37) % 62);
    const bx = p.x + r.x * side * dist;
    const bz = p.z + r.z * side * dist;
    const near = nearestSample(bx, bz);
    if (near.distSq < 460) continue; // strict >=21.4m track centerline clearance

    const nearT = tan[near.idx];
    const roadYaw = Math.atan2(-nearT.x, -nearT.z);
    const baseY = Math.max(-1.5, pos[near.idx].y - 1.4);
    const w = 15 + (i % 4) * 4;
    const d = 14 + ((i * 3) % 4) * 4;

    if (i % 5 === 0) {
      // Luxury multi-tiered hotel with upper setback & rooftop terrace
      const h1 = 22 + ((i * 11) % 16);
      const h2 = 11 + ((i * 7) % 10);
      const col = hotelPalette[i % hotelPalette.length];
      hotelSpecs.push({ x: bx, y: baseY, z: bz, w, h: h1, d, yaw: roadYaw, col });
      hotelSpecs.push({
        x: bx,
        y: baseY + h1,
        z: bz,
        w: w * 0.74,
        h: h2,
        d: d * 0.74,
        yaw: roadYaw,
        col,
      });
      roofSpecs.push({
        type: 'terrace',
        x: bx,
        y: baseY + h1 + h2,
        z: bz,
        w: w * 0.78,
        h: 1.1,
        d: d * 0.78,
        yaw: roadYaw,
      });
    } else {
      // Classic Riviera apartment block + pitched terracotta roof
      const isMid = i % 3 !== 0;
      const h = isMid ? 20 + ((i * 13) % 18) : 13 + ((i * 9) % 8);
      const col = aptPalette[i % aptPalette.length];
      const target = isMid ? aptMidSpecs : aptLowSpecs;
      target.push({ x: bx, y: baseY, z: bz, w, h, d, yaw: roadYaw, col });
      roofSpecs.push({
        type: 'hip',
        x: bx,
        y: baseY + h,
        z: bz,
        w: w + 0.9,
        h: 2.8 + (i % 3) * 0.6,
        d: d + 0.9,
        yaw: roadYaw,
      });
    }

    // Track-facing ground-floor storefront awning for street-front buildings
    if (dist < 42 && i % 2 === 0) {
      const toRoadX = pos[near.idx].x - bx;
      const toRoadZ = pos[near.idx].z - bz;
      const len = Math.hypot(toRoadX, toRoadZ) || 1;
      const ax = bx + (toRoadX / len) * (w * 0.52);
      const az = bz + (toRoadZ / len) * (d * 0.52);
      if (nearestSample(ax, az).distSq > 200) {
        awningSpecs.push({
          x: ax,
          y: baseY + 3.8,
          z: az,
          w: Math.min(w, d) * 0.72,
          yaw: Math.atan2(toRoadX, toRoadZ),
        });
      }
    }
  }

  const dummy = new THREE.Object3D();
  const cTmp = new THREE.Color();

  const spawnInstancedBuildings = (specs, geo, mat) => {
    if (!specs.length) return;
    const im = new THREE.InstancedMesh(geo, mat, specs.length);
    im.castShadow = true;
    im.receiveShadow = true;
    specs.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      im.setColorAt(i, cTmp.setHex(b.col));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    scene.add(im);
  };

  spawnInstancedBuildings(aptLowSpecs, makeTiledBuildingGeo(1.5, 1.0), aptMat);
  spawnInstancedBuildings(aptMidSpecs, makeTiledBuildingGeo(2.0, 1.75), aptMat);
  spawnInstancedBuildings(hotelSpecs, makeTiledBuildingGeo(2.0, 1.5), hotelMat);

  // Sloped Terracotta Roofs & Rooftop Terraces
  const hipSpecs = roofSpecs.filter((r) => r.type === 'hip');
  const terSpecs = roofSpecs.filter((r) => r.type === 'terrace');
  if (hipSpecs.length) {
    const hipIM = new THREE.InstancedMesh(makeHipRoofGeometry(), roofMat, hipSpecs.length);
    hipIM.castShadow = true;
    hipIM.receiveShadow = true;
    hipSpecs.forEach((r, i) => {
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(0, r.yaw, 0);
      dummy.scale.set(r.w, r.h, r.d);
      dummy.updateMatrix();
      hipIM.setMatrixAt(i, dummy.matrix);
    });
    hipIM.instanceMatrix.needsUpdate = true;
    hipIM.computeBoundingSphere();
    scene.add(hipIM);
  }
  if (terSpecs.length) {
    const terGeo = new THREE.BoxGeometry(1, 1, 1);
    terGeo.translate(0, 0.5, 0);
    const terIM = new THREE.InstancedMesh(terGeo, terraceMat, terSpecs.length);
    terIM.receiveShadow = true;
    terSpecs.forEach((r, i) => {
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(0, r.yaw, 0);
      dummy.scale.set(r.w, r.h, r.d);
      dummy.updateMatrix();
      terIM.setMatrixAt(i, dummy.matrix);
    });
    terIM.instanceMatrix.needsUpdate = true;
    terIM.computeBoundingSphere();
    scene.add(terIM);
  }

  // Ground-floor Storefront Awnings
  if (awningSpecs.length) {
    const awnGeo = new THREE.BoxGeometry(1, 0.14, 2.5);
    const awnIM = new THREE.InstancedMesh(awnGeo, awningMat, awningSpecs.length);
    awnIM.castShadow = true;
    awningSpecs.forEach((a, i) => {
      dummy.position.set(a.x, a.y, a.z);
      dummy.rotation.set(0.32, a.yaw, 0);
      dummy.scale.set(a.w, 1, 1);
      dummy.updateMatrix();
      awnIM.setMatrixAt(i, dummy.matrix);
    });
    awnIM.instanceMatrix.needsUpdate = true;
    awnIM.computeBoundingSphere();
    scene.add(awnIM);
  }

  // --- Landmark: Monte Carlo Casino at Casino Square (TRACK_POINTS[9]) ---
  const casU = uAtPoint(TRACK_POINTS[9]);
  const casIdx = Math.round(casU * SAMPLE_COUNT) % SAMPLE_COUNT;
  const casP = pos[casIdx];
  const casR = right[casIdx];
  const casPos = new THREE.Vector3(casP.x - casR.x * 38, casP.y - 1.2, casP.z - casR.z * 38);
  if (nearestSample(casPos.x, casPos.z).distSq > 500) {
    const casino = new THREE.Group();
    casino.position.copy(casPos);
    casino.rotation.y = Math.atan2(casP.x - casPos.x, casP.z - casPos.z);

    const casTex = makeCasinoFacadeTextures();
    const casWallMat = new THREE.MeshStandardMaterial({
      map: casTex.map,
      roughnessMap: casTex.roughnessMap,
      roughness: 0.9,
      metalness: 0.15,
    });
    const casStoneMat = new THREE.MeshStandardMaterial({ color: 0xe7dcc4, roughness: 0.78 });
    const casCopperMat = new THREE.MeshStandardMaterial({ color: 0x4b8a77, roughness: 0.42, metalness: 0.45 });
    const casGoldMat = new THREE.MeshStandardMaterial({ color: 0xd8b24a, roughness: 0.25, metalness: 0.85 });
    const casSlateMat = new THREE.MeshStandardMaterial({ color: 0x2c3542, roughness: 0.55, metalness: 0.2 });

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(52, 2.2, 30), casStoneMat);
    plinth.position.y = 1.1;
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

  // --- Palm Trees & Mediterranean Cypress Greenery (InstancedMesh) ---
  const palmSpecs = [];
  const cypressSpecs = [];

  // Harbor promenade palms (along eastern Port Hercule seawall)
  for (let z = -340; z <= 130; z += 26) {
    const px = 718;
    if (nearestSample(px, z).distSq > 260) {
      palmSpecs.push({ x: px, y: -0.05, z, s: 0.92 + ((Math.abs(z) % 5) * 0.05) });
    }
  }
  // Circuit & Casino Square palms + hillside cypress trees
  for (let i = 0; i < 110; i++) {
    const idx = Math.floor((i / 110) * SAMPLE_COUNT);
    const p = pos[idx];
    const r = right[idx];
    const side = i % 2 === 0 ? -1 : 1;
    const isPalm = i % 2 === 0;
    const dist = isPalm ? 13.8 + (i % 3) * 1.4 : 16.5 + (i % 5) * 4.5;
    const tx = p.x + r.x * side * dist;
    const tz = p.z + r.z * side * dist;
    const near = nearestSample(tx, tz);
    if (near.distSq < 185) continue; // strictly outside Armco barriers
    const ty = Math.max(-1.4, pos[near.idx].y - 0.15);
    if (isPalm) {
      palmSpecs.push({ x: tx, y: ty, z: tz, s: 0.85 + (i % 4) * 0.12 });
    } else {
      cypressSpecs.push({ x: tx, y: ty, z: tz, s: 0.85 + (i % 5) * 0.15 });
    }
  }

  if (palmSpecs.length) {
    const trunkMat = new THREE.MeshStandardMaterial({ map: makePalmTrunkTexture(), roughness: 0.9 });
    const frondMat = new THREE.MeshStandardMaterial({
      map: makePalmFrondTexture(),
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.72,
    });
    const trunkIM = new THREE.InstancedMesh(makePalmTrunkGeometry(), trunkMat, palmSpecs.length);
    const crownIM = new THREE.InstancedMesh(makePalmCrownGeometry(), frondMat, palmSpecs.length);
    trunkIM.castShadow = true;
    crownIM.castShadow = true;

    palmSpecs.forEach((pt, i) => {
      const h = 7.4 * pt.s;
      const yaw = (i * 1.73) % (Math.PI * 2);
      dummy.position.set(pt.x, pt.y, pt.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(pt.s, h, pt.s);
      dummy.updateMatrix();
      trunkIM.setMatrixAt(i, dummy.matrix);

      // Crown sits at top of curved trunk
      const topBendX = Math.sin(Math.PI * 0.85) * 0.09 * pt.s;
      dummy.position.set(pt.x + Math.cos(yaw) * topBendX, pt.y + h - 0.2, pt.z - Math.sin(yaw) * topBendX);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(pt.s);
      dummy.updateMatrix();
      crownIM.setMatrixAt(i, dummy.matrix);
    });
    trunkIM.instanceMatrix.needsUpdate = true;
    crownIM.instanceMatrix.needsUpdate = true;
    trunkIM.computeBoundingSphere();
    crownIM.computeBoundingSphere();
    scene.add(trunkIM, crownIM);
  }

  if (cypressSpecs.length) {
    const cypGeo = new THREE.ConeGeometry(1.35, 7.2, 8);
    cypGeo.translate(0, 3.9, 0);
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

  // --- Streetlamps along Circuit Perimeter & Harbor Promenade ---
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
  }

  // --- Grandstand Bleachers + Instanced Colorful Spectator Crowds ---
  const grandstandSpots = [
    { u: (startU + 0.015) % 1, side: 1, dist: 19 },
    { u: uAtPoint(TRACK_POINTS[4]), side: -1, dist: 21 },
    { u: uAtPoint(TRACK_POINTS[25]), side: 1, dist: 19 },
    { u: uAtPoint(TRACK_POINTS[27]), side: 1, dist: 19 },
    { u: uAtPoint(TRACK_POINTS[31]), side: -1, dist: 20 },
  ];
  const gsSteelMat = new THREE.MeshStandardMaterial({ color: 0x27303d, metalness: 0.65, roughness: 0.4 });
  const gsConcreteMat = new THREE.MeshStandardMaterial({ color: 0x737982, roughness: 0.85 });
  const gsCanopyMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.5, side: THREE.DoubleSide });
  const gsTrimMat = new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.45 });
  const crowdCoords = [];

  for (const spot of grandstandSpots) {
    const idx = Math.round(spot.u * SAMPLE_COUNT) % SAMPLE_COUNT;
    const p = pos[idx];
    const r = right[idx];
    const t = tan[idx];
    const gx = p.x + r.x * spot.side * spot.dist;
    const gz = p.z + r.z * spot.side * spot.dist;
    if (nearestSample(gx, gz).distSq < 280) continue;

    const gsGroup = new THREE.Group();
    gsGroup.position.set(gx, p.y, gz);
    gsGroup.rotation.y = Math.atan2(-spot.side * r.x, -spot.side * r.z);

    // 5 stepped concrete seating tiers
    for (let tier = 0; tier < 5; tier++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(26, 0.85, 1.8), gsConcreteMat);
      step.position.set(0, 0.7 + tier * 1.15, -tier * 1.55);
      step.castShadow = true;
      step.receiveShadow = true;
      gsGroup.add(step);

      // Register world positions for spectator crowd instances
      for (let s = -11.5; s <= 11.5; s += 1.25) {
        const localV = new THREE.Vector3(s, 1.35 + tier * 1.15, -tier * 1.55 + 0.1);
        localV.applyAxisAngle(new THREE.Vector3(0, 1, 0), gsGroup.rotation.y);
        crowdCoords.push({
          x: gx + localV.x,
          y: p.y + localV.y,
          z: gz + localV.z,
          yaw: gsGroup.rotation.y,
        });
      }
    }

    // Rear support pillars & overhead white canopy + red fascia banner
    for (let px = -11; px <= 11; px += 11) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 9.2, 0.55), gsSteelMat);
      post.position.set(px, 4.6, -7.2);
      gsGroup.add(post);
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(27, 0.22, 9.2), gsCanopyMat);
    canopy.position.set(0, 8.8, -3.2);
    canopy.rotation.x = 0.12;
    canopy.castShadow = true;
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(27, 0.7, 0.35), gsTrimMat);
    fascia.position.set(0, 8.2, 1.3);
    gsGroup.add(canopy, fascia);
    scene.add(gsGroup);

    // Keep track tangent referenced cleanly (no unused warning)
    void t;
  }

  if (crowdCoords.length) {
    const specGeo = new THREE.CylinderGeometry(0.24, 0.32, 0.85, 6);
    const specMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 });
    const crowdIM = new THREE.InstancedMesh(specGeo, specMat, crowdCoords.length);
    const crowdPalette = [0xe10600, 0xf2efe6, 0x00d2be, 0x3b82f6, 0xffc83d, 0x1e293b, 0xff784f];
    crowdCoords.forEach((spSpec, i) => {
      dummy.position.set(spSpec.x, spSpec.y, spSpec.z);
      dummy.rotation.set(0, spSpec.yaw, 0);
      dummy.scale.set(1, 0.9 + (i % 3) * 0.1, 1);
      dummy.updateMatrix();
      crowdIM.setMatrixAt(i, dummy.matrix);
      crowdIM.setColorAt(i, cTmp.setHex(crowdPalette[(i * 7) % crowdPalette.length]));
    });
    crowdIM.instanceMatrix.needsUpdate = true;
    if (crowdIM.instanceColor) crowdIM.instanceColor.needsUpdate = true;
    crowdIM.computeBoundingSphere();
    scene.add(crowdIM);
  }

  // --- Armco Barrier Sponsor Banners ---
  const bannerA = [];
  const bannerB = [];
  for (let i = 0; i < 44; i++) {
    const idx = Math.floor((i / 44) * SAMPLE_COUNT);
    const u = idx / SAMPLE_COUNT;
    if (u >= tunnelStart && u <= tunnelEnd) continue;
    const p = pos[idx];
    const r = right[idx];
    const t = tan[idx];
    const side = i % 2 === 0 ? 1 : -1;
    const bx = p.x + r.x * side * (HALF_WIDTH + 1.15);
    const bz = p.z + r.z * side * (HALF_WIDTH + 1.15);
    const spec = {
      x: bx,
      y: p.y + 1.55,
      z: bz,
      yaw: Math.atan2(-side * r.x, -side * r.z),
      tYaw: Math.atan2(t.x, t.z),
    };
    if (i % 2 === 0) bannerA.push(spec);
    else bannerB.push(spec);
  }

  const spawnBanners = (specs, tex) => {
    if (!specs.length) return;
    const bGeo = new THREE.BoxGeometry(6.8, 0.95, 0.14);
    const bMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.48, metalness: 0.1 });
    const im = new THREE.InstancedMesh(bGeo, bMat, specs.length);
    specs.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    scene.add(im);
  };
  spawnBanners(bannerA, makeSponsorBannerTexture('#121722', '#e10600', 'MONACO GP', 'MONTE-CARLO STREET CIRCUIT'));
  spawnBanners(bannerB, makeSponsorBannerTexture('#0b2228', '#d8b24a', 'PORT HERCULE', 'PRINCIPAUTÉ DE MONACO'));

  // --- Port Hercule Moored Superyachts (Multi-deck Composite Hulls) ---
  const yachtHullGeo = makeYachtHullGeometry();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.25, metalness: 0.18 });
  const navyHullMat = new THREE.MeshStandardMaterial({ color: 0x16293d, roughness: 0.28, metalness: 0.25 });
  const teakMat = new THREE.MeshStandardMaterial({ color: 0x8f6239, roughness: 0.72, metalness: 0.05 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x101c28, roughness: 0.08, metalness: 0.45 });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0xe6e8ed, roughness: 0.3, metalness: 0.65 });

  for (let y = 0; y < 8; y++) {
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
    yacht.position.set(768 + (y % 2) * 44, -1.45, -260 + y * 58);
    yacht.rotation.y = -0.35 + (y % 3) * 0.14;
    scene.add(yacht);
  }

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
      tunnel: { uStart: tunnelStart, uEnd: tunnelEnd },
    },
  };

  return {
    trackCurve,
    startFinishLine: { u: startU, lights: gantryLights },
    drsZones,
    checkpoints,
  };
}
