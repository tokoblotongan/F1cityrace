// ============================================================================
// carPhysics.js — Monaco GP: Street Circuit Challenge
// Broadcast-grade sculpted F1 car geometry (lofted nose, undercut sidepods,
// monocoque tub, cockpit steering wheel + telemetry LCD, titanium Halo,
// double-wishbone carbon suspension, multi-element front wing, animated DRS
// rear wing, central exhaust, blinking FIA rain light, Pirelli-style rounded
// slicks with glowing brake discs, and clearcoat procedural liveries) +
// downforce-scaled F1 vehicle dynamics calibrated with aiRacer.js.
// ============================================================================

import * as THREE from 'three';

const TOP_SPEED = 86;               // m/s (~310 km/h, ~340 km/h with DRS)
const G = 9.81;
const A0 = 1.7 * G;                 // low-speed mechanical grip
const A1 = (3.1 * G) / (TOP_SPEED * TOP_SPEED); // downforce grip slope

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const _fwd = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();

// Team livery metadata keyed by hex color from aiRacer.js / engine.ts
const LIVERY_INFO = new Map([
  [0xe10600, { num: '01', accent: '#f5f2eb', stripe: '#151821', compound: 0xe10600, helm: 0xfacc15 }],
  [0x00d2be, { num: '63', accent: '#12161e', stripe: '#f2efe6', compound: 0xe10600, helm: 0x00d2be }],
  [0xff8000, { num: '04', accent: '#151a24', stripe: '#38bdf8', compound: 0xfacc15, helm: 0xff8000 }],
  [0x006f62, { num: '14', accent: '#c4f000', stripe: '#0b1814', compound: 0xe10600, helm: 0x3b82f6 }],
  [0x3b82f6, { num: '23', accent: '#f2efe6', stripe: '#ef4444', compound: 0xfacc15, helm: 0xf2efe6 }],
  [0xfacc15, { num: '27', accent: '#14171f', stripe: '#e10600', compound: 0xe10600, helm: 0xef4444 }],
  [0xa855f7, { num: '10', accent: '#f5f2eb', stripe: '#22d3ee', compound: 0xfacc15, helm: 0xa855f7 }],
  [0xf472b6, { num: '31', accent: '#151924', stripe: '#38bdf8', compound: 0xe10600, helm: 0xf472b6 }],
]);

// Offscreen HTMLCanvasElement caches (safe across React StrictMode / scene remounts)
let cachedShadowCanvas = null;
let cachedTireShadowCanvas = null;
let cachedCarbonCanvas = null;
let cachedSteerCanvas = null;
const cachedLiveryCanvases = new Map();

function getContactShadowCanvas() {
  if (cachedShadowCanvas) return cachedShadowCanvas;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.save();
  g.translate(64, 128);
  g.scale(1, 2.02);
  const grad = g.createRadialGradient(0, 0, 14, 0, 0, 61);
  grad.addColorStop(0, 'rgba(0,0,0,0.88)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.52)');
  grad.addColorStop(0.85, 'rgba(0,0,0,0.16)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(-64, -64, 128, 128);
  g.restore();
  cachedShadowCanvas = c;
  return c;
}

function getTireContactCanvas() {
  if (cachedTireShadowCanvas) return cachedTireShadowCanvas;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  g.save();
  g.translate(32, 64);
  g.scale(1, 2.0);
  const grad = g.createRadialGradient(0, 0, 6, 0, 0, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.95)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.58)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(-32, -32, 64, 64);
  g.restore();
  cachedTireShadowCanvas = c;
  return c;
}

function getCarbonWeaveCanvas() {
  if (cachedCarbonCanvas) return cachedCarbonCanvas;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#15181f';
  g.fillRect(0, 0, 64, 64);
  const cell = 8;
  for (let y = 0; y < 64; y += cell) {
    for (let x = 0; x < 64; x += cell) {
      const diag = ((x / cell + y / cell) % 2) === 0;
      g.fillStyle = diag ? '#222733' : '#101319';
      g.fillRect(x, y, cell - 1, cell - 1);
      g.fillStyle = diag ? '#2d3342' : '#191d26';
      g.fillRect(x + 1, y + 1, cell - 3, 2);
    }
  }
  cachedCarbonCanvas = c;
  return c;
}

function getSteeringWheelCanvas() {
  if (cachedSteerCanvas) return cachedSteerCanvas;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#090d14';
  g.fillRect(0, 0, 128, 64);
  // Shift LED bar across top
  const leds = ['#22ff88', '#22ff88', '#22ff88', '#ff2d1a', '#ff2d1a', '#3b82f6', '#3b82f6'];
  leds.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(10 + i * 16, 4, 12, 5);
  });
  // Gear + speed readout
  g.fillStyle = '#00d2be';
  g.fillRect(8, 14, 112, 2);
  g.fillStyle = '#f8f5ec';
  g.font = '900 26px monospace';
  g.textAlign = 'center';
  g.fillText('7  312', 64, 44);
  g.fillStyle = '#22ff88';
  g.font = '700 10px monospace';
  g.fillText('ERS 94%   DRS', 64, 58);
  cachedSteerCanvas = c;
  return c;
}

function getLiveryCanvas(colorHex, info) {
  if (cachedLiveryCanvases.has(colorHex)) return cachedLiveryCanvases.get(colorHex);
  const W = 512;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  const base = '#' + new THREE.Color(colorHex).getHexString();
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  // Dark carbon-trimmed underbelly (u = 0.5 -> bottom of lofted body)
  g.fillStyle = info.stripe;
  g.fillRect(0, H * 0.42, W, H * 0.16);

  // Centerline racing stripe along TOP ridge (u = 0 / 1)
  g.fillStyle = info.stripe;
  g.fillRect(0, 0, W, 24);
  g.fillRect(0, H - 24, W, 24);
  g.fillStyle = info.accent;
  g.fillRect(0, 24, W, 7);
  g.fillRect(0, H - 31, W, 7);

  // Dynamic diagonal speed slash along left & right flanks (u = 0.25 & u = 0.75)
  g.fillStyle = info.stripe;
  g.beginPath();
  g.moveTo(W * 0.36, 0);
  g.lineTo(W * 0.50, 0);
  g.lineTo(W * 0.62, H);
  g.lineTo(W * 0.48, H);
  g.closePath();
  g.fill();

  g.fillStyle = info.accent;
  g.beginPath();
  g.moveTo(W * 0.50, 0);
  g.lineTo(W * 0.53, 0);
  g.lineTo(W * 0.65, H);
  g.lineTo(W * 0.62, H);
  g.closePath();
  g.fill();

  // Car number on nose top (drawn across top seam so visible on nose cone) & side flanks
  g.fillStyle = info.accent;
  g.font = '900 44px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(info.num, W * 0.28, H * 0.25);
  g.fillText(info.num, W * 0.28, H * 0.75);
  g.font = '900 30px sans-serif';
  g.fillText(info.num, W * 0.34, 46);
  g.fillText(info.num, W * 0.34, H - 46);

  // Sponsor wordmarks along sidepod & engine flanks (u = 0.25 right, u = 0.75 left)
  [H * 0.25, H * 0.75].forEach((cy) => {
    g.save();
    g.translate(W * 0.76, cy);
    g.fillStyle = info.accent;
    g.font = '900 24px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('MONACO', 0, -11);
    g.font = '700 13px sans-serif';
    g.fillText('GRAND PRIX', 0, 11);
    g.restore();
  });

  cachedLiveryCanvases.set(colorHex, c);
  return c;
}

// Smooth lofted cross-section geometry generator (32+ radial segments, capped ends)
function makeLoftedGeometry(sections, radialSegs = 32) {
  const ringCount = sections.length;
  const stride = radialSegs + 1;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let s = 0; s < ringCount; s++) {
    const sec = sections[s];
    const vCoord = s / Math.max(1, ringCount - 1);
    for (let a = 0; a <= radialSegs; a++) {
      const uFrac = a / radialSegs;
      const theta = uFrac * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const x = (sec.cx || 0) + sinT * sec.rx;
      const ry = cosT >= 0 ? sec.ryTop : sec.ryBot;
      let y = sec.cy + cosT * ry;
      if (sec.minY !== undefined && y < sec.minY) y = sec.minY;
      positions.push(x, y, sec.z);
      uvs.push(uFrac, vCoord);
    }
  }

  for (let s = 0; s < ringCount - 1; s++) {
    for (let a = 0; a < radialSegs; a++) {
      const i0 = s * stride + a;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  // Front & rear endcaps
  const frontCenterIdx = positions.length / 3;
  const fSec = sections[0];
  positions.push(fSec.cx || 0, fSec.cy, fSec.z);
  uvs.push(0.5, 0);
  for (let a = 0; a < radialSegs; a++) {
    indices.push(frontCenterIdx, a, a + 1);
  }

  const backCenterIdx = positions.length / 3;
  const bSec = sections[ringCount - 1];
  const bBase = (ringCount - 1) * stride;
  positions.push(bSec.cx || 0, bSec.cy, bSec.z);
  uvs.push(0.5, 1);
  for (let a = 0; a < radialSegs; a++) {
    indices.push(backCenterIdx, bBase + a + 1, bBase + a);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Smooth Pirelli-style rounded slick tire via LatheGeometry (36 radial segments)
function makePirelliTireGeometry(width, outerRadius, rimRadius) {
  const hw = width * 0.5;
  const pts = [
    new THREE.Vector2(rimRadius, -hw * 0.92),
    new THREE.Vector2(rimRadius + 0.04, -hw * 1.03),
    new THREE.Vector2(outerRadius - 0.045, -hw * 1.04),
    new THREE.Vector2(outerRadius - 0.012, -hw * 0.88),
    new THREE.Vector2(outerRadius, -hw * 0.68),
    new THREE.Vector2(outerRadius, 0),
    new THREE.Vector2(outerRadius, hw * 0.68),
    new THREE.Vector2(outerRadius - 0.012, hw * 0.88),
    new THREE.Vector2(outerRadius - 0.045, hw * 1.04),
    new THREE.Vector2(rimRadius + 0.04, hw * 1.03),
    new THREE.Vector2(rimRadius, hw * 0.92),
  ];
  const geo = new THREE.LatheGeometry(pts, 36);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

function addSuspensionStrut(parent, p1, p2, radius, mat) {
  _dir.subVectors(p2, p1);
  const len = _dir.length();
  if (len < 1e-4) return;
  _dir.divideScalar(len);
  _mid.addVectors(p1, p2).multiplyScalar(0.5);
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), mat);
  strut.position.copy(_mid);
  strut.quaternion.setFromUnitVectors(_up, _dir);
  strut.castShadow = true;
  parent.add(strut);
}

export function createF1Car(colorHex = 0xe10600, isPlayer = false) {
  const car = new THREE.Group();
  car.userData.isPlayer = !!isPlayer;

  const info = LIVERY_INFO.get(colorHex) || {
    num: '22',
    accent: '#f2efe6',
    stripe: '#141821',
    compound: 0xe10600,
    helm: 0xf2efe6,
  };

  // --- Materials ---
  const liveryTex = new THREE.CanvasTexture(getLiveryCanvas(colorHex, info));
  liveryTex.colorSpace = THREE.SRGBColorSpace;
  liveryTex.anisotropy = 8;

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: liveryTex,
    metalness: 0.2,
    roughness: 0.34,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
    envMapIntensity: 0.72,
  });

  const solidPaintMat = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    metalness: 0.2,
    roughness: 0.32,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
    envMapIntensity: 0.72,
  });

  const carbonTex = new THREE.CanvasTexture(getCarbonWeaveCanvas());
  carbonTex.wrapS = THREE.RepeatWrapping;
  carbonTex.wrapT = THREE.RepeatWrapping;
  carbonTex.repeat.set(14, 14);
  carbonTex.colorSpace = THREE.SRGBColorSpace;
  carbonTex.anisotropy = 8;

  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: carbonTex,
    roughness: 0.45,
    metalness: 0.28,
  });

  const darkIntakeMat = new THREE.MeshStandardMaterial({
    color: 0x07090d,
    roughness: 0.9,
    metalness: 0.05,
  });

  const titaniumMat = new THREE.MeshStandardMaterial({
    color: 0x3a404a,
    roughness: 0.34,
    metalness: 0.78,
  });

  const exhaustMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2af,
    roughness: 0.24,
    metalness: 0.9,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x15171b,
    roughness: 0.86,
    metalness: 0.04,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x20252f,
    roughness: 0.28,
    metalness: 0.85,
  });

  const spokeMat = new THREE.MeshStandardMaterial({
    color: 0xcbd2dc,
    roughness: 0.24,
    metalness: 0.88,
  });

  const compoundMat = new THREE.MeshStandardMaterial({
    color: info.compound,
    roughness: 0.38,
    metalness: 0.12,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: info.accent,
    roughness: 0.36,
    metalness: 0.15,
  });

  // --- 1. Sculpted Venturi Floor, Edge Wings & Rear Diffuser ---
  const floorShape = new THREE.Shape();
  floorShape.moveTo(0, -2.05);
  floorShape.lineTo(0.26, -2.0);
  floorShape.lineTo(0.32, -1.15);
  floorShape.lineTo(0.88, -0.58);
  floorShape.lineTo(0.90, 0.95);
  floorShape.lineTo(0.74, 1.55);
  floorShape.lineTo(0.46, 2.15);
  floorShape.lineTo(-0.46, 2.15);
  floorShape.lineTo(-0.74, 1.55);
  floorShape.lineTo(-0.90, 0.95);
  floorShape.lineTo(-0.88, -0.58);
  floorShape.lineTo(-0.32, -1.15);
  floorShape.lineTo(-0.26, -2.0);
  floorShape.closePath();

  const floorGeo = new THREE.ExtrudeGeometry(floorShape, {
    depth: 0.045,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 16,
  });
  floorGeo.rotateX(Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, carbonMat);
  floor.position.set(0, 0.13, 0);
  floor.castShadow = true;
  floor.receiveShadow = true;
  car.add(floor);

  // Rear Venturi diffuser fins
  for (let d = -2; d <= 2; d++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.16, 0.42), carbonMat);
    fin.position.set(d * 0.16, 0.19, 2.02);
    fin.rotation.x = -0.24;
    car.add(fin);
  }

  // --- 2. Tapered Nose Cone & Monocoque Tub (-Z is forward) ---
  const noseGeo = makeLoftedGeometry([
    { z: -2.52, cy: 0.21, rx: 0.105, ryTop: 0.055, ryBot: 0.04 },
    { z: -2.22, cy: 0.25, rx: 0.155, ryTop: 0.085, ryBot: 0.06 },
    { z: -1.78, cy: 0.31, rx: 0.205, ryTop: 0.115, ryBot: 0.085 },
    { z: -1.22, cy: 0.38, rx: 0.255, ryTop: 0.155, ryBot: 0.125 },
    { z: -0.68, cy: 0.44, rx: 0.315, ryTop: 0.195, ryBot: 0.165 },
    { z: -0.36, cy: 0.46, rx: 0.34,  ryTop: 0.21,  ryBot: 0.18 },
  ], 32);
  const nose = new THREE.Mesh(noseGeo, paintMat);
  nose.castShadow = true;
  nose.receiveShadow = true;
  car.add(nose);

  // Monocoque cockpit tub sides + recessed cockpit cavity + headrest
  const tubLower = new THREE.Mesh(
    makeLoftedGeometry([
      { z: -0.45, cy: 0.31, rx: 0.35, ryTop: 0.16, ryBot: 0.16 },
      { z: -0.05, cy: 0.32, rx: 0.38, ryTop: 0.17, ryBot: 0.17 },
      { z:  0.35, cy: 0.34, rx: 0.34, ryTop: 0.19, ryBot: 0.18 },
      { z:  0.75, cy: 0.36, rx: 0.28, ryTop: 0.20, ryBot: 0.19 },
    ], 32),
    paintMat
  );
  tubLower.castShadow = true;
  car.add(tubLower);

  // Left & Right sculpted cockpit coaming rails
  [-1, 1].forEach((side) => {
    const railShape = new THREE.Shape();
    railShape.moveTo(-0.46, 0.44);
    railShape.lineTo(-0.18, 0.56);
    railShape.lineTo(0.24, 0.62);
    railShape.lineTo(0.28, 0.42);
    railShape.lineTo(-0.44, 0.36);
    railShape.closePath();
    const railGeo = new THREE.ExtrudeGeometry(railShape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.02,
      bevelSegments: 3,
    });
    railGeo.rotateY(-Math.PI / 2);
    const rail = new THREE.Mesh(railGeo, solidPaintMat);
    rail.position.set(side * 0.27 + 0.04, 0, 0);
    rail.castShadow = true;
    car.add(rail);
  });

  // Interior carbon cockpit floor & seat headrest
  const cockpitWell = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 0.72), darkIntakeMat);
  cockpitWell.position.set(0, 0.36, -0.08);
  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.22), carbonMat);
  headrest.position.set(0, 0.59, 0.18);
  car.add(cockpitWell, headrest);

  // --- 3. Sculpted Undercut Sidepods, Air Intakes, Engine Cover, Shark Fin & T-Cam ---
  [-1, 1].forEach((side) => {
    // Undercut sidepod lofted symmetrically then sculpted inward
    const podGeo = makeLoftedGeometry([
      { z: -0.34, cx: side * 0.49, cy: 0.41, rx: 0.25, ryTop: 0.17, ryBot: 0.14, minY: 0.22 },
      { z: -0.02, cx: side * 0.54, cy: 0.42, rx: 0.29, ryTop: 0.19, ryBot: 0.16, minY: 0.20 },
      { z:  0.46, cx: side * 0.51, cy: 0.40, rx: 0.27, ryTop: 0.18, ryBot: 0.16, minY: 0.17 },
      { z:  0.98, cx: side * 0.41, cy: 0.36, rx: 0.20, ryTop: 0.15, ryBot: 0.15, minY: 0.15 },
      { z:  1.48, cx: side * 0.26, cy: 0.32, rx: 0.13, ryTop: 0.12, ryBot: 0.12, minY: 0.15 },
      { z:  1.86, cx: side * 0.14, cy: 0.30, rx: 0.08, ryTop: 0.09, ryBot: 0.09, minY: 0.15 },
    ], 32);
    const pod = new THREE.Mesh(podGeo, paintMat);
    pod.castShadow = true;
    pod.receiveShadow = true;
    car.add(pod);

    // Dark sidepod radiator air intake mouth + carbon lip
    const inletLip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.23, 0.08), carbonMat);
    inletLip.position.set(side * 0.49, 0.44, -0.35);
    inletLip.rotation.y = side * -0.14;
    const inletDark = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.17, 0.05), darkIntakeMat);
    inletDark.position.set(side * 0.49, 0.44, -0.375);
    inletDark.rotation.y = side * -0.14;
    car.add(inletLip, inletDark);
  });

  // Tapered Roll-Hoop Airbox & Engine Cover (zero harsh flat top box!)
  const engGeo = makeLoftedGeometry([
    { z:  0.14, cy: 0.72, rx: 0.23, ryTop: 0.27, ryBot: 0.22 },
    { z:  0.45, cy: 0.68, rx: 0.23, ryTop: 0.26, ryBot: 0.22 },
    { z:  0.95, cy: 0.59, rx: 0.19, ryTop: 0.21, ryBot: 0.20 },
    { z:  1.45, cy: 0.48, rx: 0.14, ryTop: 0.15, ryBot: 0.15 },
    { z:  1.92, cy: 0.41, rx: 0.09, ryTop: 0.09, ryBot: 0.09 },
  ], 32);
  const engineCover = new THREE.Mesh(engGeo, paintMat);
  engineCover.castShadow = true;
  engineCover.receiveShadow = true;
  car.add(engineCover);

  // Dark airbox intake overhead behind helmet
  const airboxIntake = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.13, 0.12, 24),
    darkIntakeMat
  );
  airboxIntake.rotation.x = Math.PI / 2;
  airboxIntake.position.set(0, 0.87, 0.14);
  car.add(airboxIntake);

  // Dorsal shark fin
  const finShape = new THREE.Shape();
  finShape.moveTo(0.32, 0.94);
  finShape.lineTo(1.52, 0.86);
  finShape.lineTo(1.68, 0.56);
  finShape.lineTo(0.32, 0.70);
  finShape.closePath();
  const sharkFinGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.024,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
  });
  sharkFinGeo.rotateY(-Math.PI / 2);
  const sharkFin = new THREE.Mesh(sharkFinGeo, accentMat);
  sharkFin.position.set(0.012, 0, 0);
  sharkFin.castShadow = true;
  car.add(sharkFin);

  // T-Cam broadcast pod atop airbox
  const tcamStalk = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.14, 0.09), carbonMat);
  tcamStalk.position.set(0, 1.04, 0.30);
  const tcamBar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.075), carbonMat);
  tcamBar.position.set(0, 1.12, 0.30);
  const tcamAccent = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.08), solidPaintMat);
  tcamAccent.position.set(0, 1.13, 0.30);
  car.add(tcamStalk, tcamBar, tcamAccent);

  // --- 4. Multi-Element Curved Front Wing ---
  const fwGroup = new THREE.Group();
  const fwMainShape = new THREE.Shape();
  fwMainShape.moveTo(0, -0.26);
  fwMainShape.quadraticCurveTo(0.55, -0.22, 0.96, -0.06);
  fwMainShape.lineTo(0.96, 0.24);
  fwMainShape.quadraticCurveTo(0.50, 0.16, 0, 0.18);
  fwMainShape.quadraticCurveTo(-0.50, 0.16, -0.96, 0.24);
  fwMainShape.lineTo(-0.96, -0.06);
  fwMainShape.quadraticCurveTo(-0.55, -0.22, 0, -0.26);
  fwMainShape.closePath();

  const fwMainGeo = new THREE.ExtrudeGeometry(fwMainShape, {
    depth: 0.028,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.01,
    bevelSegments: 2,
    curveSegments: 20,
  });
  fwMainGeo.rotateX(Math.PI / 2);
  const fwMain = new THREE.Mesh(fwMainGeo, carbonMat);
  fwMain.position.set(0, 0.14, -2.42);
  fwMain.castShadow = true;
  fwGroup.add(fwMain);

  // Upper cascade wing flaps (painted & carbon layers)
  [-1, 1].forEach((side) => {
    for (let f = 0; f < 2; f++) {
      const flap = new THREE.Mesh(
        new THREE.BoxGeometry(0.74, 0.024, 0.14),
        f === 0 ? solidPaintMat : carbonMat
      );
      flap.position.set(side * 0.56, 0.18 + f * 0.042, -2.30 + f * 0.09);
      flap.rotation.x = 0.22 + f * 0.12;
      flap.rotation.y = side * -0.14;
      flap.castShadow = true;
      fwGroup.add(flap);
    }
    // Sculpted curved front wing endplate
    const epShape = new THREE.Shape();
    epShape.moveTo(-0.34, 0);
    epShape.lineTo(0.28, 0);
    epShape.quadraticCurveTo(0.32, 0.26, 0.14, 0.30);
    epShape.quadraticCurveTo(-0.18, 0.24, -0.34, 0.06);
    epShape.closePath();
    const epGeo = new THREE.ExtrudeGeometry(epShape, {
      depth: 0.024,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
    });
    epGeo.rotateY(-Math.PI / 2);
    const ep = new THREE.Mesh(epGeo, solidPaintMat);
    ep.position.set(side * 0.96 + 0.012, 0.11, -2.35);
    ep.castShadow = true;
    fwGroup.add(ep);
  });
  car.add(fwGroup);

  // --- 5. Titanium Halo, Cockpit Steering Wheel & Driver Helmet ---
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.27, 0.60, 0.14),
    new THREE.Vector3(-0.29, 0.77, -0.14),
    new THREE.Vector3(-0.18, 0.78, -0.45),
    new THREE.Vector3(0, 0.75, -0.58),
    new THREE.Vector3(0.18, 0.78, -0.45),
    new THREE.Vector3(0.29, 0.77, -0.14),
    new THREE.Vector3(0.27, 0.60, 0.14),
  ]);
  const haloRing = new THREE.Mesh(
    new THREE.TubeGeometry(haloCurve, 36, 0.028, 12, false),
    titaniumMat
  );
  haloRing.castShadow = true;
  const pillarCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.56, -0.64),
    new THREE.Vector3(0, 0.67, -0.60),
    new THREE.Vector3(0, 0.75, -0.57),
  ]);
  const haloPillar = new THREE.Mesh(
    new THREE.TubeGeometry(pillarCurve, 12, 0.024, 10, false),
    titaniumMat
  );
  car.add(haloRing, haloPillar);

  // F1 Steering wheel with glowing telemetry LCD screen inside cockpit
  const steerGroup = new THREE.Group();
  steerGroup.position.set(0, 0.59, -0.42);
  steerGroup.rotation.x = -0.35;
  const wheelBody = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.03), carbonMat);
  const steerTex = new THREE.CanvasTexture(getSteeringWheelCanvas());
  steerTex.colorSpace = THREE.SRGBColorSpace;
  const steerLcdMat = new THREE.MeshStandardMaterial({
    map: steerTex,
    emissiveMap: steerTex,
    emissive: 0xffffff,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  const wheelScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.065), steerLcdMat);
  wheelScreen.position.set(0, 0.015, 0.017);
  wheelScreen.rotation.y = Math.PI;
  steerGroup.add(wheelBody, wheelScreen);
  car.add(steerGroup);

  // Detailed Driver Helmet (32x24 sphere + curved wrap-around visor + aero spoiler)
  const helmet = new THREE.Group();
  const helmDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 32, 24),
    new THREE.MeshPhysicalMaterial({
      color: info.helm,
      roughness: 0.14,
      metalness: 0.25,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    })
  );
  const helmStripe = new THREE.Mesh(
    new THREE.TorusGeometry(0.176, 0.016, 8, 32),
    solidPaintMat
  );
  helmStripe.rotation.x = Math.PI / 2;
  helmStripe.position.y = 0.05;
  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.184, 0.184, 0.075, 24, 1, true, Math.PI * 0.68, Math.PI * 0.64),
    new THREE.MeshPhysicalMaterial({
      color: 0x09111a,
      roughness: 0.05,
      metalness: 0.92,
      clearcoat: 1.0,
      side: THREE.DoubleSide,
    })
  );
  visor.position.y = 0.015;
  const helmSpoiler = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.08), solidPaintMat);
  helmSpoiler.position.set(0, 0.08, 0.15);
  helmet.add(helmDome, helmStripe, visor, helmSpoiler);
  helmet.position.set(0, 0.68, -0.05);
  car.add(helmet);

  // --- 6. Double-Wishbone Carbon-Fiber Suspension Arms (All 4 Wheels) ---
  [-1, 1].forEach((side) => {
    // Front suspension (connects nose/monocoque to front wheel hub)
    const fHubTop = new THREE.Vector3(side * 0.77, 0.42, -1.62);
    const fHubBot = new THREE.Vector3(side * 0.77, 0.30, -1.62);
    addSuspensionStrut(car, new THREE.Vector3(side * 0.24, 0.44, -1.36), fHubTop, 0.018, carbonMat);
    addSuspensionStrut(car, new THREE.Vector3(side * 0.20, 0.43, -1.84), fHubTop, 0.018, carbonMat);
    addSuspensionStrut(car, new THREE.Vector3(side * 0.23, 0.26, -1.38), fHubBot, 0.018, carbonMat);
    addSuspensionStrut(car, new THREE.Vector3(side * 0.19, 0.26, -1.82), fHubBot, 0.018, carbonMat);
    addSuspensionStrut(car, new THREE.Vector3(side * 0.24, 0.48, -1.52), fHubBot, 0.014, carbonMat);

    // Rear suspension (connects gearbox structure to rear wheel hub)
    const rHubTop = new THREE.Vector3(side * 0.78, 0.42, 1.56);
    const rHubBot = new THREE.Vector3(side * 0.78, 0.30, 1.56);
    addSuspensionStrut(car, new THREE.Vector3(side * 0.18, 0.44, 1.28), rHubTop, 0.019, carbonMat);
    addSuspensionStrut(car, new THREE.Vector3(side * 0.13, 0.44, 1.78), rHubTop, 0.019, carbonMat);
    addSuspensionStrut(car, new THREE.Vector3(side * 0.17, 0.25, 1.30), rHubBot, 0.019, carbonMat);
    addSuspensionStrut(car, new THREE.Vector3(side * 0.13, 0.25, 1.76), rHubBot, 0.019, carbonMat);
    addSuspensionStrut(car, new THREE.Vector3(side * 0.16, 0.48, 1.66), rHubBot, 0.015, carbonMat);
  });

  // --- 7. Rear Wing Assembly, Animated DRS Flap, Central Exhaust & FIA Rain Light ---
  const rwPylonL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.56, 0.24), carbonMat);
  rwPylonL.position.set(-0.14, 0.66, 2.18);
  const rwPylonR = rwPylonL.clone();
  rwPylonR.position.x = 0.14;

  const rwBeam = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.045, 0.22), carbonMat);
  rwBeam.position.set(0, 0.52, 2.22);

  // Curved main rear wing plane
  const rwMain = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.05, 0.30), carbonMat);
  rwMain.position.set(0, 0.94, 2.22);
  rwMain.rotation.x = 0.14;
  rwMain.castShadow = true;

  // Sculpted Rear Wing Endplates
  const rweShape = new THREE.Shape();
  rweShape.moveTo(-0.26, 0);
  rweShape.lineTo(0.28, 0);
  rweShape.quadraticCurveTo(0.32, 0.42, 0.20, 0.56);
  rweShape.lineTo(-0.24, 0.54);
  rweShape.quadraticCurveTo(-0.30, 0.24, -0.26, 0);
  const rweGeo = new THREE.ExtrudeGeometry(rweShape, {
    depth: 0.028,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
  });
  rweGeo.rotateY(-Math.PI / 2);
  const rwPlateL = new THREE.Mesh(rweGeo, solidPaintMat);
  rwPlateL.position.set(-0.662, 0.60, 2.24);
  rwPlateL.castShadow = true;
  const rwPlateR = rwPlateL.clone();
  rwPlateR.position.x = 0.69;

  // Animated DRS Upper Flap (hinged at rear trailing edge so +rotation.x swings leading edge UP!)
  const drsFlap = new THREE.Group();
  drsFlap.position.set(0, 1.11, 2.38);
  const drsBlade = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.04, 0.24), solidPaintMat);
  drsBlade.position.set(0, 0, -0.11);
  drsBlade.rotation.x = 0.24;
  drsBlade.castShadow = true;
  drsFlap.add(drsBlade);

  car.add(rwPylonL, rwPylonR, rwBeam, rwMain, rwPlateL, rwPlateR, drsFlap);

  // Central Inconel Exhaust Tailpipe + Twin Wastegate Pipes
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.075, 0.34, 24), exhaustMat);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0, 0.42, 1.98);
  const exhaustInner = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 16), darkIntakeMat);
  exhaustInner.rotation.x = Math.PI / 2;
  exhaustInner.position.set(0, 0.42, 2.13);
  car.add(exhaust, exhaustInner);

  // Rear FIA Rain / ERS Light
  const rearLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.14, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x450000, emissive: 0xff1e00, emissiveIntensity: 0.4 })
  );
  rearLight.position.set(0, 0.34, 2.33);
  car.add(rearLight);

  // --- 8. 4 Pirelli-Style Wide Slick Wheels + Metallic Rims + Glowing Brake Discs ---
  const frontTireGeo = makePirelliTireGeometry(0.33, 0.36, 0.22);
  const rearTireGeo = makePirelliTireGeometry(0.41, 0.36, 0.22);
  const rimBarrelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.28, 32, 1, true);
  rimBarrelGeo.rotateZ(Math.PI / 2);
  const rimCoreGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.30, 16);
  rimCoreGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.04, 0.39, 0.025);
  const brakeDiscGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.036, 24);
  brakeDiscGeo.rotateZ(Math.PI / 2);
  const wheelNutGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.06, 12);
  wheelNutGeo.rotateZ(Math.PI / 2);

  const brakeDiscMats = [];
  const makeWheel = (isFront, side) => {
    const wg = new THREE.Group();
    const w = isFront ? 0.33 : 0.41;

    const tire = new THREE.Mesh(isFront ? frontTireGeo : rearTireGeo, tireMat);
    tire.castShadow = true;
    wg.add(tire);

    // Outer Pirelli colored compound ring on outer sidewall
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.012, 8, 36), compoundMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = side * (w * 0.505);
    wg.add(ring);

    // Metallic rim barrel, hub & 5 spokes
    const barrel = new THREE.Mesh(rimBarrelGeo, rimMat);
    const core = new THREE.Mesh(rimCoreGeo, rimMat);
    const nut = new THREE.Mesh(wheelNutGeo, compoundMat);
    nut.position.x = side * (w * 0.44);
    wg.add(barrel, core, nut);

    for (let s = 0; s < 5; s++) {
      const sp = new THREE.Mesh(spokeGeo, spokeMat);
      sp.position.x = side * (w * 0.36);
      sp.rotation.x = (s / 5) * Math.PI;
      wg.add(sp);
    }

    // Glowing brake disc inside wheel
    const discMat = new THREE.MeshStandardMaterial({
      color: 0x3b4049,
      emissive: 0xff3b08,
      emissiveIntensity: 0,
      roughness: 0.38,
      metalness: 0.78,
    });
    brakeDiscMats.push(discMat);
    const disc = new THREE.Mesh(brakeDiscGeo, discMat);
    disc.position.x = -side * 0.05;
    wg.add(disc);

    return wg;
  };

  const frontPivots = [];
  const wheels = [];
  const wheelCoords = [
    { x: -0.90, y: 0.355, z: -1.62, front: true, side: -1 },
    { x:  0.90, y: 0.355, z: -1.62, front: true, side:  1 },
    { x: -0.92, y: 0.355, z:  1.56, front: false, side: -1 },
    { x:  0.92, y: 0.355, z:  1.56, front: false, side:  1 },
  ];
  const tireShadowTex = new THREE.CanvasTexture(getTireContactCanvas());
  const tireShadowMat = new THREE.MeshBasicMaterial({
    map: tireShadowTex,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  for (const wc of wheelCoords) {
    const w = makeWheel(wc.front, wc.side);
    wheels.push(w);
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(wc.front ? 0.56 : 0.64, wc.front ? 0.92 : 0.98),
      tireShadowMat
    );
    patch.rotation.x = -Math.PI / 2;

    if (wc.front) {
      const pivot = new THREE.Group();
      pivot.position.set(wc.x, wc.y, wc.z);
      pivot.add(w);
      patch.position.set(0, -wc.y + 0.018, 0);
      pivot.add(patch);
      car.add(pivot);
      frontPivots.push(pivot);
    } else {
      w.position.set(wc.x, wc.y, wc.z);
      patch.position.set(wc.x, 0.018, wc.z);
      car.add(w, patch);
    }
  }

  // Enable real-time directional shadow casting across all car parts
  car.traverse((obj) => {
    if (obj.isMesh && obj.material !== tireShadowMat) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  // --- 9. Ground Oval Contact Shadow under Car Floor ---
  const shadowTex = new THREE.CanvasTexture(getContactShadowCanvas());
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.35, 5.15),
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.02;
  car.add(contactShadow);

  car.userData.parts = { helmet, drsFlap, wheels, frontPivots, rearLight, brakeDiscMats };
  car.userData.physics = {
    speed: 0,
    slip: 0,
    hit: 0,
    steerVis: 0,
    brakeHeat: 0,
    blinkT: 0,
    u: 0,
    lastIdx: 0,
    yaw: 0,
    initialized: false,
  };

  return car;
}

function findNearestIndex(posArr, x, z, hintIdx, N) {
  let best = hintIdx % N;
  let bestD = Infinity;
  const win = 40;
  for (let o = -win; o <= win; o++) {
    const idx = (hintIdx + o + N) % N;
    const dx = posArr[idx].x - x;
    const dz = posArr[idx].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = idx;
    }
  }
  if (bestD > 900) {
    for (let idx = 0; idx < N; idx++) {
      const dx = posArr[idx].x - x;
      const dz = posArr[idx].z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    }
  }
  return best;
}

function computeGearAndRpm(speed) {
  const kmh = speed * 3.6;
  const tops = [0, 82, 128, 174, 218, 258, 294, 326, 365];
  let gear = 1;
  for (let g = 1; g <= 8; g++) {
    if (kmh >= tops[g - 1] * 0.88) gear = g;
  }
  const low = gear === 1 ? 0 : tops[gear - 1] * 0.72;
  const high = tops[gear];
  const frac = clamp((kmh - low) / Math.max(10, high - low), 0, 1);
  const rpm = Math.round(4300 + frac * 7950);
  return { gear, rpm };
}

export function updateCarPhysics(car, controls, trackData, dt) {
  const P = car.userData.physics;
  const parts = car.userData.parts;
  const sd = trackData.trackCurve.userData.samples;
  const N = sd.count;
  const halfWidth = trackData.trackCurve.userData.halfWidth;

  if (controls?.reset || !P.initialized) {
    const resetIdx = P.initialized ? P.lastIdx : Math.round(trackData.startFinishLine.u * N) % N;
    const p = sd.pos[resetIdx];
    const t = sd.tan[resetIdx];
    car.position.set(p.x, p.y, p.z);
    P.speed = 0;
    P.slip = 0;
    P.hit = 0;
    P.steerVis = 0;
    P.brakeHeat = 0;
    P.lastIdx = resetIdx;
    P.u = resetIdx / N;
    P.yaw = Math.atan2(-t.x, -t.z);
    P.initialized = true;
    car.rotation.set(Math.asin(clamp(t.y, -1, 1)), P.yaw, 0);
  }

  const thr = clamp(controls?.throttle ?? 0, 0, 1);
  const brk = clamp(controls?.brake ?? 0, 0, 1);
  const steer = clamp(controls?.steer ?? 0, -1, 1);

  let inDrsZone = false;
  for (const z of trackData.drsZones) {
    if (P.u >= z.uStart && P.u <= z.uEnd) {
      inDrsZone = true;
      break;
    }
  }
  const drsAvailable = inDrsZone && P.speed > 24;
  const drsActive = !!(controls?.drs && drsAvailable && brk < 0.15);

  if (dt > 0) {
    // Longitudinal F1 powertrain + aero drag + braking
    const maxV = TOP_SPEED * (drsActive ? 1.1 : 1.0);
    const accelPower = thr * (30 - 0.18 * P.speed);
    const aeroDrag = 0.0032 * P.speed * P.speed + 0.12 * P.speed;
    const brakeForce = brk * 42;
    const rolling = 0.45;

    P.speed = clamp(P.speed + (accelPower - brakeForce - aeroDrag - rolling) * dt, 0, maxV);

    // Downforce-scaled steering & lateral grip
    const maxLatA = A0 + A1 * P.speed * P.speed;
    const steerRadiusScale = 1 / (1 + P.speed * 0.021);
    const maxYawRate = Math.min(2.35 * steerRadiusScale, maxLatA / Math.max(P.speed, 6));
    const yawDelta = steer * maxYawRate * dt * (P.speed > 0.5 ? Math.min(1, P.speed / 5) : 0);
    P.yaw = wrapAngle(P.yaw + yawDelta);

    const reqLatA = Math.abs(steer) * maxYawRate * P.speed;
    const isSlidingTarget = reqLatA > maxLatA * 0.84 && P.speed > 14 ? 1 : 0;
    P.slip += (isSlidingTarget - P.slip) * Math.min(1, 8 * dt);

    // Advance along heading
    _fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    car.position.addScaledVector(_fwd, P.speed * dt);
  }

  // Project onto circuit spline for elevation, slope & barrier clamping
  const idx = findNearestIndex(sd.pos, car.position.x, car.position.z, P.lastIdx, N);
  P.lastIdx = idx;
  P.u = idx / N;

  const p = sd.pos[idx];
  const r = sd.right[idx];
  const t = sd.tan[idx];

  _delta.set(car.position.x - p.x, 0, car.position.z - p.z);
  const lateral = _delta.dot(r);
  const maxLat = halfWidth - 1.05;
  P.hit = Math.max(0, P.hit - dt * 2.4);

  if (Math.abs(lateral) > maxLat) {
    const sign = Math.sign(lateral);
    const clampedLat = sign * maxLat;
    const corr = clampedLat - lateral;
    car.position.x += r.x * corr;
    car.position.z += r.z * corr;

    const tangentYaw = Math.atan2(-t.x, -t.z);
    const wallImpact = clamp((Math.abs(wrapAngle(P.yaw - tangentYaw)) * P.speed) / 28, 0.15, 1);
    if (P.speed > 12) P.hit = Math.max(P.hit, wallImpact);
    P.speed *= 0.92;
    P.yaw = wrapAngle(P.yaw + wrapAngle(tangentYaw - P.yaw) * 0.45);
  }

  car.position.y = p.y;
  const slopePitch = Math.asin(clamp(t.y, -1, 1));
  const rollBank = -steer * clamp(P.speed / 70, 0, 1) * 0.035;
  car.rotation.order = 'YXZ';
  car.rotation.set(slopePitch, P.yaw, rollBank);

  // Visual animations (wheels, steer, DRS flap, FIA rain light, glowing brake discs)
  P.steerVis += (steer * 0.38 - P.steerVis) * Math.min(1, 14 * Math.max(dt, 0.016));
  for (const fp of parts.frontPivots) fp.rotation.y = P.steerVis;
  const wheelSpin = (P.speed / 0.36) * dt;
  for (const w of parts.wheels) w.rotation.x -= wheelSpin;

  parts.drsFlap.rotation.x += ((drsActive ? 0.52 : 0) - parts.drsFlap.rotation.x) * Math.min(1, 18 * Math.max(dt, 0.016));

  P.blinkT = (P.blinkT || 0) + dt;
  const blinkOn = Math.sin(P.blinkT * 38) > 0;
  parts.rearLight.material.emissiveIntensity = brk > 0.15 ? (blinkOn ? 3.8 : 0.7) : 0.4;

  const targetHeat = brk > 0.25 && P.speed > 10 ? clamp(brk * (P.speed / 65), 0, 1) : 0;
  P.brakeHeat = (P.brakeHeat || 0) + (targetHeat - (P.brakeHeat || 0)) * Math.min(1, (targetHeat > (P.brakeHeat || 0) ? 7 : 3) * Math.max(dt, 0.016));
  if (parts.brakeDiscMats) {
    const glow = P.brakeHeat * 2.8;
    for (const dm of parts.brakeDiscMats) dm.emissiveIntensity = glow;
  }

  const { gear, rpm } = computeGearAndRpm(P.speed);
  const onCurb = Math.abs(lateral) > halfWidth - 2.1;
  const lateralG = Math.abs(steer) * (P.speed * P.speed * 0.002 + 1.2);

  return {
    speedKmh: P.speed * 3.6,
    gear,
    rpm,
    drsAvailable,
    drsActive,
    isBraking: brk > 0.15,
    isSliding: P.slip > 0.35,
    lateralG,
    hitIntensity: P.hit,
    onCurb,
    u: P.u,
    throttle: thr,
    brake: brk,
  };
}
