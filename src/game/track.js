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
  water.position.set(820, -1.6, -20);
  scene.add(water);

  // Harbor seawall quay
  const quay = new THREE.Mesh(
    new THREE.BoxGeometry(620, 3.0, 740),
    new THREE.MeshStandardMaterial({ color: 0x9e9585, roughness: 0.92 })
  );
  quay.position.set(350, -1.55, -140);
  quay.receiveShadow = true;
  scene.add(quay);

  // Monte Carlo hillside buildings (InstancedMesh)
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  buildingGeo.translate(0, 0.5, 0);
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.08 });
  const bPositions = [];
  const palette = [0xdfd5c5, 0xd4a988, 0xc9b9a6, 0xe8e2d5, 0xb7c2cc, 0xd8c3a5];
  const dummy = new THREE.Object3D();

  for (let i = 0; i < 160; i++) {
    const idx = Math.floor((i / 160) * SAMPLE_COUNT);
    const p = pos[idx];
    const r = right[idx];
    const side = i % 2 === 0 ? -1 : 1;
    // Keep harbor side open near the bay
    if (side === 1 && p.x > 460 && p.z > -320 && p.z < 120) continue;
    const dist = 22 + ((i * 37) % 58);
    const bx = p.x + r.x * side * dist;
    const bz = p.z + r.z * side * dist;
    // Verify not overlapping track centerline
    let tooClose = false;
    for (let k = 0; k < SAMPLE_COUNT; k += 20) {
      if ((bx - pos[k].x) ** 2 + (bz - pos[k].z) ** 2 < 290) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) bPositions.push({ x: bx, y: Math.max(-1.5, p.y - 1.5), z: bz, idx: i });
  }

  const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, bPositions.length);
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  bPositions.forEach((b, i) => {
    const w = 14 + (b.idx % 4) * 5;
    const d = 14 + ((b.idx * 3) % 4) * 5;
    const h = 16 + ((b.idx * 13) % 38);
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(0, (b.idx * 0.43) % Math.PI, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    buildings.setMatrixAt(i, dummy.matrix);
    buildings.setColorAt(i, new THREE.Color(palette[b.idx % palette.length]));
  });
  buildings.instanceMatrix.needsUpdate = true;
  if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
  buildings.computeBoundingSphere();
  scene.add(buildings);

  // Port Hercule moored yachts
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.28, metalness: 0.15 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.3 });
  for (let y = 0; y < 7; y++) {
    const yacht = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 24), hullMat);
    hull.position.y = 0.6;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.4, 13), hullMat);
    cabin.position.set(0, 2.5, -1);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.0, 11), deckMat);
    glass.position.set(0, 2.7, -1);
    yacht.add(hull, cabin, glass);
    yacht.position.set(740 + (y % 2) * 38, -1.4, -220 + y * 56);
    yacht.rotation.y = -0.35 + (y % 3) * 0.12;
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
