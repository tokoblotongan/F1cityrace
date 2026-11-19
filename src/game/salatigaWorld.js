// ============================================================================
// salatigaWorld.js — Salatiga -> Wates (7.9 KM) 3D Corridor Environment
// Contoured Central Java highland terrain, distant Mount Merbabu / Merapi /
// Telomoyo / Ungaran backdrop, strict road-corridor-only (onlyAlongActiveTrack)
// OpenStreetMap GeoJSON + deterministic trackside building fill, tropical
// shade trees, streetlamps, grandstands, and sponsor boards.
// ============================================================================

import * as THREE from 'three';
import { salatigaLatLonToWorldXZ } from '../data/circuits.ts';

const geoModules = import.meta.glob('../data/salatiga-buildings.geojson', {
  eager: true,
  query: '?url',
  import: 'default',
});
const salatigaGeoUrl = Object.values(geoModules)[0] || null;

let cachedGeoFeatures = null;
let geoFetchPromise = null;

async function loadSalatigaGeoFeatures() {
  if (!salatigaGeoUrl) return [];
  if (cachedGeoFeatures) return cachedGeoFeatures;
  if (!geoFetchPromise) {
    geoFetchPromise = fetch(salatigaGeoUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`GeoJSON HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const features = Array.isArray(data?.features) ? data.features : [];
        cachedGeoFeatures = features;
        return features;
      })
      .catch((err) => {
        geoFetchPromise = null;
        throw err;
      });
  }
  return geoFetchPromise;
}

function createSeededRng(seed = 7331) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function makeShophouseTexture(wallHex, trimHex, awningHex) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');

  g.fillStyle = wallHex;
  g.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 1600; i++) {
    const x = (i * 73) % 512;
    const y = (i * 139) % 512;
    g.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(20,25,30,0.05)';
    g.fillRect(x, y, 4, 4);
  }
  for (let px = 0; px <= 512; px += 128) {
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(px - 4, 0, 8, 512);
    g.fillStyle = trimHex;
    g.fillRect(px - 2, 0, 4, 512);
  }

  for (const [cy, ch] of [[0, 20], [218, 18], [374, 16]]) {
    g.fillStyle = trimHex;
    g.fillRect(0, cy, 512, ch);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, cy + ch, 512, 5);
  }

  for (let row = 0; row < 2; row++) {
    const wy = row === 0 ? 52 : 254;
    for (let col = 0; col < 4; col++) {
      const wx = 32 + col * 124;
      g.fillStyle = trimHex;
      g.fillRect(wx - 6, wy - 6, 76, 114);
      g.fillStyle = '#1e293b';
      g.fillRect(wx, wy, 64, 100);
      g.fillStyle = '#5c94b4';
      g.fillRect(wx + 6, wy + 6, 23, 40);
      g.fillRect(wx + 35, wy + 6, 23, 40);
      g.fillRect(wx + 6, wy + 54, 23, 40);
      g.fillRect(wx + 35, wy + 54, 23, 40);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(wx - 8, wy + 104, 80, 6);
    }
  }

  g.fillStyle = awningHex;
  g.fillRect(0, 382, 512, 28);
  g.fillStyle = '#0f172a';
  g.fillRect(20, 416, 472, 92);
  for (let bay = 0; bay < 2; bay++) {
    const bx = 32 + bay * 234;
    g.fillStyle = 'rgba(255, 224, 160, 0.56)';
    g.fillRect(bx, 424, 214, 72);
    g.fillStyle = '#1e293b';
    g.fillRect(bx + 104, 424, 6, 72);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function makeTerracottaTileTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#a44123';
  g.fillRect(0, 0, 512, 512);

  for (let y = 0; y < 512; y += 24) {
    g.fillStyle = 'rgba(42, 12, 6, 0.36)';
    g.fillRect(0, y + 19, 512, 5);
    g.fillStyle = 'rgba(235, 130, 88, 0.2)';
    g.fillRect(0, y, 512, 4);
    for (let x = 0; x < 512; x += 24) {
      g.fillStyle = ((x + y) / 24) % 2 === 0 ? 'rgba(255,190,145,0.10)' : 'rgba(40,12,8,0.12)';
      g.fillRect(x + 2, y + 3, 20, 16);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function makeKanopiTexture(primaryHex, stripeHex) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = primaryHex;
  g.fillRect(0, 0, 512, 256);
  const cols = 12;
  const cw = 512 / cols;
  for (let i = 0; i < cols; i++) {
    if (i % 2 === 1) {
      g.fillStyle = stripeHex;
      g.fillRect(i * cw, 0, cw, 256);
    }
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(i * cw, 0, 3, 256);
  }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(0, 224, 512, 32);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function makeVolcanicMountainGeometry(radius, height, seedOffset) {
  const geo = new THREE.ConeGeometry(radius, height, 64, 18, true);
  geo.translate(0, height * 0.5, 0);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);

  const cBase = new THREE.Color(0x28472d);
  const cMid = new THREE.Color(0x365242);
  const cRidge = new THREE.Color(0x526470);
  const cPeak = new THREE.Color(0x6d7d8c);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const hFrac = THREE.MathUtils.clamp(y / height, 0, 1);
    const ang = Math.atan2(z, x);

    const ridge1 = Math.sin(ang * 5 + seedOffset) * 0.14;
    const ridge2 = Math.cos(ang * 11 - seedOffset * 1.4) * 0.07;
    const ridge3 = Math.sin(ang * 19 + hFrac * 4.0) * 0.035;
    const flare = Math.pow(1 - hFrac, 0.65);
    const radialScale = 1 + (ridge1 + ridge2 + ridge3) * (0.35 + flare * 0.85);

    x *= radialScale;
    z *= radialScale;
    if (hFrac > 0.90) {
      const topT = (hFrac - 0.90) / 0.10;
      y -= topT * height * 0.045 * (0.6 + 0.4 * Math.cos(ang * 2));
    }
    pos.setXYZ(i, x, y, z);

    if (hFrac < 0.45) {
      tmp.copy(cBase).lerp(cMid, hFrac / 0.45);
    } else if (hFrac < 0.78) {
      tmp.copy(cMid).lerp(cRidge, (hFrac - 0.45) / 0.33);
    } else {
      tmp.copy(cRidge).lerp(cPeak, (hFrac - 0.78) / 0.22);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function mergeSimpleGeos(geos, includeVertexYColor = false) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let vertOffset = 0;

  const cBot = new THREE.Color(0x1f4d27);
  const cTop = new THREE.Color(0x63ad45);
  const tmp = new THREE.Color();

  for (const g of geos) {
    const nonIdx = g.index ? g.toNonIndexed() : g;
    const p = nonIdx.getAttribute('position');
    const n = nonIdx.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      positions.push(p.getX(i), y, p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      if (includeVertexYColor) {
        const t = THREE.MathUtils.clamp((y - 3.7) / 3.6, 0, 1);
        tmp.copy(cBot).lerp(cTop, t);
        colors.push(tmp.r, tmp.g, tmp.b);
      }
      indices.push(vertOffset + i);
    }
    vertOffset += p.count;
    if (nonIdx !== g) nonIdx.dispose();
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (includeVertexYColor) {
    merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  merged.setIndex(indices);
  return merged;
}

function makeShadeTreeTrunkGeo() {
  const parts = [
    new THREE.CylinderGeometry(0.24, 0.42, 3.6, 8),
    new THREE.CylinderGeometry(0.11, 0.20, 2.2, 6),
    new THREE.CylinderGeometry(0.10, 0.18, 2.1, 6),
    new THREE.CylinderGeometry(0.10, 0.18, 2.0, 6),
  ];
  parts[0].translate(0, 1.8, 0);
  parts[1].rotateZ(0.48);
  parts[1].translate(-0.55, 4.1, 0.15);
  parts[2].rotateZ(-0.44);
  parts[2].rotateX(0.22);
  parts[2].translate(0.55, 4.0, -0.2);
  parts[3].rotateX(-0.46);
  parts[3].translate(0.05, 4.0, 0.52);

  return mergeSimpleGeos(parts, false);
}

function makeShadeTreeCanopyGeo() {
  const blobs = [
    { rx: 2.65, ry: 1.45, rz: 2.55, x: 0, y: 5.4, z: 0 },
    { rx: 1.95, ry: 1.25, rz: 1.85, x: -1.35, y: 4.9, z: 0.45 },
    { rx: 1.95, ry: 1.20, rz: 1.90, x: 1.35, y: 4.95, z: -0.45 },
    { rx: 1.75, ry: 1.15, rz: 1.75, x: 0.15, y: 5.05, z: 1.35 },
    { rx: 1.65, ry: 1.15, rz: 1.65, x: -0.2, y: 5.1, z: -1.3 },
    { rx: 1.55, ry: 1.15, rz: 1.55, x: 0, y: 6.25, z: 0 },
  ];
  const geos = blobs.map((b) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(b.rx, b.ry, b.rz);
    g.translate(b.x, b.y, b.z);
    return g;
  });
  return mergeSimpleGeos(geos, true);
}

export function buildSalatigaEnvironment(scene, ctx) {
  const {
    pos,
    right,
    SAMPLE_COUNT,
    HALF_WIDTH,
    totalLength = 7986,
    closedLoop = false,
    startU = 0,
    finishLineU = 0.994,
    nearestSample,
    envTime,
    dummy,
    topCoolGantryMats,
    esLumutBoardMats,
    gantryTrimMat,
    makeSponsorBannerTexture,
    spawnBanners,
    makeGrandstandCluster,
    heroClearZones = [],
    abortSignal,
  } = ctx;

  const uDenom = closedLoop ? SAMPLE_COUNT : Math.max(1, SAMPLE_COUNT - 1);
  const wrapU = (u) => (closedLoop ? (((u % 1) + 1) % 1) : THREE.MathUtils.clamp(u, 0, 1));
  const idxAtU = (u) =>
    closedLoop
      ? ((Math.round(u * SAMPLE_COUNT) % SAMPLE_COUNT) + SAMPLE_COUNT) % SAMPLE_COUNT
      : THREE.MathUtils.clamp(Math.round(u * uDenom), 0, SAMPLE_COUNT - 1);

  // Route bounding box for dynamic terrain & far mountain framing
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const p = pos[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const routeCenterX = (minX + maxX) * 0.5;
  const routeCenterZ = (minZ + maxZ) * 0.5;

  // 1. Spatial Grid over Track Samples for Fast O(1) Corridor & Terrain Evaluation
  const CELL = 36;
  const trackGrid = new Map();
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const p = pos[i];
    const gx = Math.floor(p.x / CELL);
    const gz = Math.floor(p.z / CELL);
    const key = `${gx},${gz}`;
    let list = trackGrid.get(key);
    if (!list) {
      list = [];
      trackGrid.set(key, list);
    }
    list.push(i);
  }

  const nearestTrackFast = (x, z) => {
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    let bestIdx = -1;
    let bestSq = Infinity;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const list = trackGrid.get(`${gx + dx},${gz + dz}`);
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const idx = list[k];
          const p = pos[idx];
          const ddx = x - p.x;
          const ddz = z - p.z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bestSq) {
            bestSq = d2;
            bestIdx = idx;
          }
        }
      }
    }
    if (bestIdx >= 0) return { idx: bestIdx, distSq: bestSq };
    return nearestSample(x, z);
  };

  // Terrain carved strictly <= trackY - 0.78m anywhere within 38m of centerline
  // so no hillside/triangle ever clips the active Tamansari -> Wates road.
  const getTerrainHeight = (x, z) => {
    const near = nearestTrackFast(x, z);
    const dist = Math.sqrt(near.distSq);
    const trackY = pos[near.idx].y - 0.78;
    if (dist <= 38) return trackY;

    const southSlope = THREE.MathUtils.clamp((z - 800) / 4200, -0.15, 1.1) * 24;
    const westRidge = THREE.MathUtils.clamp((-x + 200) / 3600, -0.15, 1.0) * 14;
    const hills =
      Math.sin(x * 0.0022 + 0.6) * Math.cos(z * 0.0021) * 8.0 +
      Math.sin(x * 0.0064 - z * 0.0052) * 3.6;
    const farRise = Math.min(82, Math.max(0, dist - 220) * 0.032);
    const baseY = trackY * 0.75 + southSlope * 0.45 + westRidge * 0.45 + hills + farRise - 1.5;

    if (dist >= 145) return baseY;
    const t = THREE.MathUtils.smoothstep((dist - 38) / 107, 0, 1);
    const lerpY = THREE.MathUtils.lerp(trackY, baseY, t);
    return Math.min(lerpY, trackY + (dist - 38) * 0.14);
  };

  // 2. Dynamic Route-BBox Highland Basin Terrain Mesh (256x256 carved road corridor)
  const terrainW = Math.max(8400, Math.ceil((maxX - minX + 5200) / 100) * 100);
  const terrainD = Math.max(9200, Math.ceil((maxZ - minZ + 4600) / 100) * 100);
  const terrainGeo = new THREE.PlaneGeometry(terrainW, terrainD, 256, 256);
  terrainGeo.rotateX(-Math.PI / 2);
  const tPos = terrainGeo.getAttribute('position');
  const tColors = new Float32Array(tPos.count * 3);
  const cValley = new THREE.Color(0x3b6334);
  const cTerrace = new THREE.Color(0x527a3d);
  const cFoothill = new THREE.Color(0x2a4829);
  const cUrban = new THREE.Color(0x57634d);
  const cTmp = new THREE.Color();

  for (let i = 0; i < tPos.count; i++) {
    const wx = tPos.getX(i) + routeCenterX;
    const wz = tPos.getZ(i) + routeCenterZ;
    const wy = getTerrainHeight(wx, wz);
    tPos.setXYZ(i, wx, wy, wz);

    const near = nearestTrackFast(wx, wz);
    const dist = Math.sqrt(near.distSq);
    const slopeMix = THREE.MathUtils.clamp((wy - 8) / 62, 0, 1);
    cTmp.copy(cValley).lerp(cTerrace, 0.35 + 0.35 * Math.sin(wx * 0.008 + wz * 0.008));
    cTmp.lerp(cFoothill, slopeMix * 0.65);
    if (dist < 46) cTmp.lerp(cUrban, 0.32 * (1 - dist / 46));
    tColors[i * 3] = cTmp.r;
    tColors[i * 3 + 1] = cTmp.g;
    tColors[i * 3 + 2] = cTmp.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(tColors, 3));
  terrainGeo.computeVertexNormals();

  const terrainMesh = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.0,
    })
  );
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // 3. Far-Horizon Mount Merbabu & Mount Merapi Massif + Telomoyo & Ungaran
  // Every volcano center is > 2,400m from the 7.9km Tamansari -> Wates route
  const mountainMistUniform = { value: 0.0 };
  const mountainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.0,
  });
  mountainMat.customProgramCacheKey = () => 'salatiga_mountain_mist_v1';
  mountainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uMistBoost = mountainMistUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMtnWorldPos;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vMtnWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uMistBoost;\nvarying vec3 vMtnWorldPos;')
      .replace(
        '#include <dithering_fragment>',
        `#ifdef USE_FOG
          float mistH = smoothstep(40.0, 620.0, vMtnWorldPos.y);
          vec3 mistTint = vec3(0.68, 0.77, 0.85);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mistTint, clamp(uMistBoost * (0.35 + 0.45 * mistH), 0.0, 0.88));
        #endif
        #include <dithering_fragment>`
      );
  };

  const merbabuMain = new THREE.Mesh(makeVolcanicMountainGeometry(1350, 1150, 1.3), mountainMat);
  merbabuMain.position.set(-650, -18, 7050);
  scene.add(merbabuMain);

  const merbabuShoulder = new THREE.Mesh(makeVolcanicMountainGeometry(1050, 860, 2.7), mountainMat);
  merbabuShoulder.position.set(950, -18, 7200);
  scene.add(merbabuShoulder);

  const merapiCone = new THREE.Mesh(makeVolcanicMountainGeometry(1450, 1320, 3.6), mountainMat);
  merapiCone.position.set(-2450, -24, 7800);
  scene.add(merapiCone);

  const telomoyo = new THREE.Mesh(makeVolcanicMountainGeometry(1100, 760, 4.1), mountainMat);
  telomoyo.position.set(-4650, -14, 4800);
  scene.add(telomoyo);

  const ungaran = new THREE.Mesh(makeVolcanicMountainGeometry(1200, 780, 5.4), mountainMat);
  ungaran.position.set(-3400, -18, -2900);
  scene.add(ungaran);

  // 4. Landmark Clear Zones & Spatial Occupancy Grid (prevents any overlaps)
  const landmarkClearZones = [...heroClearZones];
  const buildingOccGrid = new Map();
  const OCC_CELL = 16;

  const markBuildingOccupied = (x, z) => {
    const gx = Math.floor(x / OCC_CELL);
    const gz = Math.floor(z / OCC_CELL);
    const key = `${gx},${gz}`;
    let arr = buildingOccGrid.get(key);
    if (!arr) {
      arr = [];
      buildingOccGrid.set(key, arr);
    }
    arr.push([x, z]);
  };

  const isNearExistingBuilding = (x, z, radiusSq) => {
    const gx = Math.floor(x / OCC_CELL);
    const gz = Math.floor(z / OCC_CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = buildingOccGrid.get(`${gx + dx},${gz + dz}`);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const [bx, bz] = arr[k];
          if ((x - bx) ** 2 + (z - bz) ** 2 < radiusSq) return true;
        }
      }
    }
    return false;
  };

  const hitsLandmarkZone = (x, z, uVal, side) => {
    for (const lz of landmarkClearZones) {
      if ((x - lz.x) ** 2 + (z - lz.z) ** 2 < lz.radSq) return true;
      if (lz.uProg != null && lz.side === side && Math.abs(uVal - lz.uProg) < 0.014) return true;
    }
    return false;
  };

  // 5. Shared Zone Materials (strict corridor buildings: 6m-55m from road edge, <=75m centerline)
  const wallTexPalettes = [
    makeShophouseTexture('#f3eadb', '#d1c4ad', '#b91c1c'), // Zone 0: Tamansari - Jl. Jend. Sudirman commercial ruko
    makeShophouseTexture('#f4f5f6', '#cbd5e1', '#14532d'), // Zone 1: Civic / Tingkir boulevard
    makeShophouseTexture('#e5dccb', '#a89274', '#0f766e'), // Zone 2: JLS highland cafes & homes toward Wates
  ];
  const rukoWallMats = wallTexPalettes.map(
    (tex) =>
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.74,
        metalness: 0.05,
        side: THREE.DoubleSide,
      })
  );
  const rukoRoofMat = new THREE.MeshStandardMaterial({
    map: makeTerracottaTileTexture(),
    roughness: 0.74,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const kanopiMats = [
    new THREE.MeshStandardMaterial({ map: makeKanopiTexture('#b91c1c', '#fef3c7'), roughness: 0.62, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ map: makeKanopiTexture('#0f766e', '#f8fafc'), roughness: 0.62, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ map: makeKanopiTexture('#1d4ed8', '#f8fafc'), roughness: 0.62, side: THREE.DoubleSide }),
  ];

  // Strict anti-sprawl corridor bounds
  const MIN_BLDG_CENTER_DIST = HALF_WIDTH + 6.0; // 13m from centerline (>= 6m from asphalt edge)
  const MAX_BLDG_CENTER_DIST = HALF_WIDTH + 55.0; // 62m from centerline (<= 55m from asphalt edge)
  const HARD_CUTOFF_CENTER_DIST = 75.0;

  let corridorFillBuilt = false;
  const buildCorridorFillBuildings = () => {
    if (corridorFillBuilt || abortSignal?.aborted) return;
    corridorFillBuilt = true;

    const rng = createSeededRng(7331);
    const spacingMeters = 18;
    const totalSlots = Math.max(80, Math.floor(totalLength / spacingMeters));

    const zoneBuckets = [[], [], []];
    const kanopiBuckets = [[], [], []];
    const roofBuckets = [];

    for (let i = 0; i <= totalSlots; i++) {
      const u = i / totalSlots;
      const idx = idxAtU(u);
      const p = pos[idx];
      const r = right[idx];

      // Urban commercial density in northern Sudirman/Tamansari (u < 0.35),
      // sparser highland homes/cafes along Tingkir -> JLS -> Wates (u >= 0.35)
      const isUrban = u < 0.35;
      const isPeriUrban = u >= 0.35 && u < 0.62;
      const spawnBothSides = isUrban;

      for (const side of spawnBothSides ? [-1, 1] : [i % 2 === 0 ? -1 : 1]) {
        const roll = rng();
        if (!isUrban && roll > (isPeriUrban ? 0.56 : 0.42)) continue;
        if (isUrban && roll > 0.86) continue;

        const edgeOffset = isUrban
          ? 7.5 + rng() * 26.0
          : 9.0 + rng() * 34.0;
        const centerDist = THREE.MathUtils.clamp(
          HALF_WIDTH + edgeOffset,
          MIN_BLDG_CENTER_DIST + 1.5,
          MAX_BLDG_CENTER_DIST - 4.0
        );

        const bx = p.x + r.x * side * centerDist;
        const bz = p.z + r.z * side * centerDist;

        const near = nearestTrackFast(bx, bz);
        const nearDist = Math.sqrt(near.distSq);
        if (nearDist < MIN_BLDG_CENTER_DIST + 2.5 || nearDist > HARD_CUTOFF_CENTER_DIST - 6.0) continue;
        if (hitsLandmarkZone(bx, bz, u, side)) continue;
        if (isNearExistingBuilding(bx, bz, 15.5 * 15.5)) continue;

        const w = isUrban ? 9.5 + rng() * 4.5 : 8.0 + rng() * 4.2;
        const d = isUrban ? 8.5 + rng() * 3.5 : 7.5 + rng() * 3.2;
        // Verify building corners don't cross inside MIN_BLDG_CENTER_DIST
        if (nearDist - Math.max(w, d) * 0.6 < MIN_BLDG_CENTER_DIST) continue;

        const floors = isUrban
          ? (rng() > 0.58 ? 3 : rng() > 0.22 ? 2 : 1)
          : (rng() > 0.68 ? 2 : 1);
        const h = floors * 3.5;

        const groundY = Math.min(getTerrainHeight(bx, bz), pos[near.idx].y - 0.35);
        const roadYaw = Math.atan2(-side * r.x, -side * r.z);
        const pal = isUrban ? (u < 0.26 ? 0 : 1) : 2;

        markBuildingOccupied(bx, bz);
        zoneBuckets[pal].push({ x: bx, y: groundY - 2.2, z: bz, w, h: h + 2.2, d, yaw: roadYaw });
        roofBuckets.push({
          x: bx,
          y: groundY + h,
          z: bz,
          w: w * 0.78,
          h: 1.7 + rng() * 0.75,
          d: d * 0.78,
          yaw: roadYaw + Math.PI / 4,
        });

        if (isUrban && pal === 0 && nearDist <= HALF_WIDTH + 32) {
          const fx = Math.sin(roadYaw);
          const fz = Math.cos(roadYaw);
          const canopyOffset = d * 0.5 + 1.1;
          kanopiBuckets[i % kanopiMats.length].push({
            x: bx + fx * canopyOffset,
            y: groundY + 3.05,
            z: bz + fz * canopyOffset,
            w: w * 0.92,
            d: 2.35,
            yaw: roadYaw,
          });
        }
      }
    }

    const boxUnitGeo = new THREE.BoxGeometry(1, 1, 1);
    boxUnitGeo.translate(0, 0.5, 0);
    zoneBuckets.forEach((specs, pal) => {
      if (!specs.length) return;
      const im = new THREE.InstancedMesh(boxUnitGeo, rukoWallMats[pal], specs.length);
      im.castShadow = true;
      im.receiveShadow = true;
      specs.forEach((b, k) => {
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(0, b.yaw, 0);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        im.setMatrixAt(k, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      scene.add(im);
    });

    if (roofBuckets.length) {
      const coneRoofGeo = new THREE.ConeGeometry(1, 1, 4);
      coneRoofGeo.translate(0, 0.5, 0);
      const roofIM = new THREE.InstancedMesh(coneRoofGeo, rukoRoofMat, roofBuckets.length);
      roofIM.castShadow = true;
      roofIM.receiveShadow = true;
      roofBuckets.forEach((rf, k) => {
        dummy.position.set(rf.x, rf.y, rf.z);
        dummy.rotation.set(0, rf.yaw, 0);
        dummy.scale.set(rf.w, rf.h, rf.d);
        dummy.updateMatrix();
        roofIM.setMatrixAt(k, dummy.matrix);
      });
      roofIM.instanceMatrix.needsUpdate = true;
      roofIM.computeBoundingSphere();
      scene.add(roofIM);
    }

    const kanopiGeo = new THREE.BoxGeometry(1, 0.14, 1);
    kanopiBuckets.forEach((specs, ki) => {
      if (!specs.length) return;
      const kim = new THREE.InstancedMesh(kanopiGeo, kanopiMats[ki], specs.length);
      kim.castShadow = true;
      kim.receiveShadow = true;
      specs.forEach((kn, idx) => {
        dummy.position.set(kn.x, kn.y, kn.z);
        dummy.rotation.set(0, kn.yaw, 0);
        dummy.rotateX(0.22);
        dummy.scale.set(kn.w, 1, kn.d);
        dummy.updateMatrix();
        kim.setMatrixAt(idx, dummy.matrix);
      });
      kim.instanceMatrix.needsUpdate = true;
      kim.computeBoundingSphere();
      scene.add(kim);
    });
  };

  // 6. Tropical Javanese Shade Trees (alongsideTrackOnly: true, strictly 6m-45m from road edges)
  const treeSpecs = [];
  const buildTrees = () => {
    const treeSteps = Math.max(200, Math.floor(totalLength / 20));
    for (let i = 0; i <= treeSteps; i++) {
      const u = i / treeSteps;
      const idx = idxAtU(u);
      const p = pos[idx];
      const r = right[idx];
      const side = i % 2 === 0 ? -1 : 1;
      const jitter = hash2D(i * 1.37, idx * 0.71);
      const edgeOffset = 6.5 + jitter * 28.0; // strictly within 6m..45m from asphalt edge
      const dist = HALF_WIDTH + edgeOffset;
      const tx = p.x + r.x * side * dist;
      const tz = p.z + r.z * side * dist;

      const near = nearestTrackFast(tx, tz);
      const nearDist = Math.sqrt(near.distSq);
      if (nearDist < HALF_WIDTH + 6.0 || nearDist > HALF_WIDTH + 45.0) continue;
      if (hitsLandmarkZone(tx, tz, u, side)) continue;
      if (isNearExistingBuilding(tx, tz, 6.2 * 6.2)) continue;

      const ty = Math.min(getTerrainHeight(tx, tz), pos[near.idx].y - 0.25);
      treeSpecs.push({
        x: tx,
        y: ty - 0.15,
        z: tz,
        s: 0.78 + jitter * 0.48,
        yaw: jitter * Math.PI * 2,
      });
    }

    if (treeSpecs.length) {
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b382a, roughness: 0.92 });
      const canopyMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.0,
      });
      canopyMat.customProgramCacheKey = () => 'salatiga_tree_breeze_v1';
      canopyMat.onBeforeCompile = (shader) => {
        shader.uniforms.uEnvTime = envTime;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uEnvTime;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vec3 treeOrigin = vec3(0.0);
            #ifdef USE_INSTANCING
              treeOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            #endif
            float treePhase = fract(sin(dot(treeOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
            float swayMask = smoothstep(3.4, 6.2, position.y);
            transformed.x += sin(uEnvTime * 1.45 + treePhase + position.y * 0.5) * 0.16 * swayMask;
            transformed.z += cos(uEnvTime * 1.15 + treePhase * 1.3) * 0.12 * swayMask;`
          );
      };

      const trunkIM = new THREE.InstancedMesh(makeShadeTreeTrunkGeo(), trunkMat, treeSpecs.length);
      const canopyIM = new THREE.InstancedMesh(makeShadeTreeCanopyGeo(), canopyMat, treeSpecs.length);
      trunkIM.castShadow = true;
      canopyIM.castShadow = true;
      canopyIM.receiveShadow = true;

      const canopyTones = [0xe8ffd8, 0xd4f7c2, 0xf2ffe6, 0xc4ebb0];
      const cTmpTree = new THREE.Color();
      treeSpecs.forEach((tr, i) => {
        dummy.position.set(tr.x, tr.y, tr.z);
        dummy.rotation.set(0, tr.yaw, 0);
        dummy.scale.setScalar(tr.s);
        dummy.updateMatrix();
        trunkIM.setMatrixAt(i, dummy.matrix);
        canopyIM.setMatrixAt(i, dummy.matrix);
        canopyIM.setColorAt(i, cTmpTree.setHex(canopyTones[i % canopyTones.length]));
      });
      trunkIM.instanceMatrix.needsUpdate = true;
      canopyIM.instanceMatrix.needsUpdate = true;
      if (canopyIM.instanceColor) canopyIM.instanceColor.needsUpdate = true;
      trunkIM.computeBoundingSphere();
      canopyIM.computeBoundingSphere();
      scene.add(trunkIM, canopyIM);
    }
  };

  // 7. Streetlamps along Salatiga -> Wates Route
  const lampSpecs = [];
  const lampCount = Math.max(96, Math.round(totalLength / 48));
  for (let i = 0; i <= lampCount; i++) {
    const u = 0.005 + (i / lampCount) * 0.99;
    const idx = idxAtU(u);
    const p = pos[idx];
    const r = right[idx];
    const side = i % 2 === 0 ? 1 : -1;
    const lx = p.x + r.x * side * (HALF_WIDTH + 2.2);
    const lz = p.z + r.z * side * (HALF_WIDTH + 2.2);
    if (nearestTrackFast(lx, lz).distSq < (HALF_WIDTH + 1.5) ** 2) continue;
    lampSpecs.push({
      x: lx,
      y: p.y,
      z: lz,
      yaw: Math.atan2(-side * r.x, -side * r.z),
    });
  }
  if (lampSpecs.length) {
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.13, 5.4, 7);
    poleGeo.translate(0, 2.7, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x222936, metalness: 0.68, roughness: 0.38 });
    const bulbGeo = new THREE.SphereGeometry(0.24, 8, 6);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff5d6,
      emissive: 0xffd27a,
      emissiveIntensity: 1.4,
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

  // 8. Grandstands & Sponsor Boards along the 7.9 KM Stage
  if (typeof makeGrandstandCluster === 'function') {
    makeGrandstandCluster([
      { u: wrapU(startU + 0.012), side: 1, dist: 19 },
      { u: wrapU(0.26), side: -1, dist: 20 },
      { u: wrapU(0.58), side: 1, dist: 20 },
      { u: wrapU(finishLineU - 0.014), side: -1, dist: 19 },
    ]);
  }

  const salatigaGpFace = new THREE.MeshStandardMaterial({
    map: makeSponsorBannerTexture('#06281e', '#22ff88', 'SALATIGA — WATES', 'POINT-TO-POINT STAGE · 7.9 KM'),
    roughness: 0.42,
    metalness: 0.12,
  });
  const jlsFace = new THREE.MeshStandardMaterial({
    map: makeSponsorBannerTexture('#1a1f2b', '#d8b24a', 'MERBABU HIGHLAND', 'TAMANSARI · SUDIRMAN · JLS · WATES'),
    roughness: 0.42,
    metalness: 0.12,
  });

  const bannerBuckets = [[], [], [], []];
  const bannerCount = Math.max(72, Math.round(totalLength / 68));
  for (let i = 0; i <= bannerCount; i++) {
    const u = 0.01 + (i / bannerCount) * 0.975;
    const idx = idxAtU(u);
    const p = pos[idx];
    const r = right[idx];
    const side = i % 2 === 0 ? 1 : -1;
    if (hitsLandmarkZone(p.x + r.x * side * (HALF_WIDTH + 1.16), p.z + r.z * side * (HALF_WIDTH + 1.16), u, side)) {
      continue;
    }

    const bx = p.x + r.x * side * (HALF_WIDTH + 1.16);
    const bz = p.z + r.z * side * (HALF_WIDTH + 1.16);
    const bucketIdx = i % 4;
    bannerBuckets[bucketIdx].push({
      x: bx,
      y: p.y + 1.48,
      z: bz,
      yaw: Math.atan2(-side * r.x, -side * r.z),
    });
  }

  spawnBanners(bannerBuckets[0], esLumutBoardMats);
  spawnBanners(bannerBuckets[1], topCoolGantryMats);
  spawnBanners(bannerBuckets[2], [gantryTrimMat, gantryTrimMat, gantryTrimMat, gantryTrimMat, salatigaGpFace, salatigaGpFace]);
  spawnBanners(bannerBuckets[3], [gantryTrimMat, gantryTrimMat, gantryTrimMat, gantryTrimMat, jlsFace, jlsFace]);

  // 9. Async Real OpenStreetMap Building Extrusion + Corridor-Only Fill
  // Strict anti-sprawl corridor filter: edge offset 6m-55m (centerline 13m-62m, hard cutoff 75m)
  if (!salatigaGeoUrl) {
    buildCorridorFillBuildings();
    buildTrees();
  } else {
    loadSalatigaGeoFeatures()
      .then((features) => {
        if (abortSignal?.aborted) return;
        if (!features.length) {
          buildCorridorFillBuildings();
          buildTrees();
          return;
        }

        const wallBuckets = [
          { pos: [], norm: [], uv: [], idx: [] }, // 0: Tamansari - Jl. Jend. Sudirman commercial ruko
          { pos: [], norm: [], uv: [], idx: [] }, // 1: Civic / Tingkir boulevard
          { pos: [], norm: [], uv: [], idx: [] }, // 2: JLS highland cafes & homes
        ];
        const roofPos = [];
        const roofNorm = [];
        const roofUv = [];
        const roofIdx = [];
        const osmKanopiSpecs = [];

        const pushTri = (b, ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, u0, v0, u1, v1, u2, v2) => {
          const base = b.pos.length / 3;
          b.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
          b.norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
          b.uv.push(u0, v0, u1, v1, u2, v2);
          b.idx.push(base, base + 1, base + 2);
        };

        for (let fIdx = 0; fIdx < features.length; fIdx++) {
          const feat = features[fIdx];
          const geom = feat?.geometry;
          if (!geom) continue;
          const ring =
            geom.type === 'Polygon'
              ? geom.coordinates?.[0]
              : geom.type === 'MultiPolygon'
                ? geom.coordinates?.[0]?.[0]
                : null;
          if (!Array.isArray(ring) || ring.length < 4) continue;

          const nPts = ring.length - 1;
          if (nPts < 3 || nPts > 24) continue;

          const worldPts = [];
          const shapePts = [];
          let cx = 0;
          let cz = 0;
          for (let k = 0; k < nPts; k++) {
            const [wx, wz] = salatigaLatLonToWorldXZ(ring[k][1], ring[k][0]);
            worldPts.push([wx, wz]);
            shapePts.push(new THREE.Vector2(wx, wz));
            cx += wx;
            cz += wz;
          }
          cx /= nPts;
          cz /= nPts;

          // Strict active-track corridor check across all vertices, edge midpoints & centroid
          let minEdgeDistSq = Infinity;
          let maxVertDistSq = 0;
          let nearestRoadIdx = 0;
          let maxRadSq = 0;
          for (let k = 0; k < nPts; k++) {
            const [x0, z0] = worldPts[k];
            const [x1, z1] = worldPts[(k + 1) % nPts];
            const r2 = (x0 - cx) ** 2 + (z0 - cz) ** 2;
            if (r2 > maxRadSq) maxRadSq = r2;

            const nV = nearestTrackFast(x0, z0);
            if (nV.distSq < minEdgeDistSq) {
              minEdgeDistSq = nV.distSq;
              nearestRoadIdx = nV.idx;
            }
            if (nV.distSq > maxVertDistSq) maxVertDistSq = nV.distSq;

            const mx = (x0 + x1) * 0.5;
            const mz = (z0 + z1) * 0.5;
            const nM = nearestTrackFast(mx, mz);
            if (nM.distSq < minEdgeDistSq) {
              minEdgeDistSq = nM.distSq;
              nearestRoadIdx = nM.idx;
            }
          }
          const radius = Math.sqrt(maxRadSq);
          if (radius < 1.8 || radius > 34) continue;

          const nearC = nearestTrackFast(cx, cz);
          const centDist = Math.sqrt(nearC.distSq);
          const minEdgeDist = Math.sqrt(minEdgeDistSq);
          const maxVertDist = Math.sqrt(maxVertDistSq);

          // Must sit strictly 6m-55m from road edge and never sprawl past 75m from centerline
          if (minEdgeDist < MIN_BLDG_CENTER_DIST || centDist > MAX_BLDG_CENTER_DIST || maxVertDist > HARD_CUTOFF_CENTER_DIST) {
            continue;
          }

          const roadRefIdx = nearC.idx ?? nearestRoadIdx;
          const uRoute = roadRefIdx / uDenom;
          if (hitsLandmarkZone(cx, cz, uRoute, 0)) continue;

          const bType = String(feat.properties?.building || '');
          let zoneIdx = 2;
          if (uRoute < 0.35 || bType === 'commercial' || bType === 'retail' || bType === 'office') {
            zoneIdx = 0;
          } else if (uRoute < 0.62 || bType === 'university' || bType === 'school' || bType === 'hospital' || bType === 'public') {
            zoneIdx = 1;
          }

          const rawLevels = Number(feat.properties?.['building:levels']);
          const hSeed = hash2D(cx * 0.13, cz * 0.17);
          let levels;
          if (Number.isFinite(rawLevels) && rawLevels >= 1 && rawLevels <= 6) {
            levels = rawLevels;
          } else if (zoneIdx === 0) {
            levels = hSeed > 0.45 || bType === 'commercial' || bType === 'retail' ? 3 : 2;
          } else if (zoneIdx === 1) {
            levels = hSeed > 0.42 ? 2 : 1;
          } else {
            levels = hSeed > 0.65 ? 2 : 1;
          }
          const buildingH = Math.max(3.5, levels * 3.5);

          const trackY = pos[roadRefIdx].y;
          const terrainY = getTerrainHeight(cx, cz);
          const groundY = Math.min(terrainY, trackY - 0.35);
          const baseY = groundY - 2.4;
          const topY = groundY + buildingH;
          const wb = wallBuckets[zoneIdx];

          let roadFaceEdge = null;
          let roadFaceDot = -Infinity;
          const roadP = pos[roadRefIdx];
          const toRoadX = roadP.x - cx;
          const toRoadZ = roadP.z - cz;

          for (let k = 0; k < nPts; k++) {
            const [x0, z0] = worldPts[k];
            const [x1, z1] = worldPts[(k + 1) % nPts];
            const ex = x1 - x0;
            const ez = z1 - z0;
            const eLen = Math.hypot(ex, ez);
            if (eLen < 0.25) continue;

            let nx = ez / eLen;
            let nz = -ex / eLen;
            if ((x0 - cx) * nx + (z0 - cz) * nz < 0) {
              nx = -nx;
              nz = -nz;
            }
            const uSpan = Math.max(0.5, eLen / 10);
            pushTri(wb, x0, baseY, z0, x1, baseY, z1, x1, topY, z1, nx, 0, nz, 0, 0, uSpan, 0, uSpan, 1);
            pushTri(wb, x0, baseY, z0, x1, topY, z1, x0, topY, z0, nx, 0, nz, 0, 0, uSpan, 1, 0, 1);

            if (zoneIdx === 0 && minEdgeDist <= 38 && eLen >= 3.2 && eLen <= 26) {
              const dotR = nx * toRoadX + nz * toRoadZ;
              if (dotR > roadFaceDot) {
                roadFaceDot = dotR;
                roadFaceEdge = {
                  mx: (x0 + x1) * 0.5 + nx * 1.1,
                  mz: (z0 + z1) * 0.5 + nz * 1.1,
                  len: eLen * 0.92,
                  yaw: Math.atan2(nx, nz),
                };
              }
            }
          }

          if (roadFaceEdge) {
            osmKanopiSpecs.push({
              x: roadFaceEdge.mx,
              y: groundY + 3.05,
              z: roadFaceEdge.mz,
              w: roadFaceEdge.len,
              d: 2.25,
              yaw: roadFaceEdge.yaw,
            });
          }

          const triFaces = THREE.ShapeUtils.triangulateShape(shapePts, []);
          for (const tri of triFaces) {
            const [ia, ib, ic] = tri;
            const [ax, az] = worldPts[ia];
            const [bx, bz] = worldPts[ib];
            const [cxp, czp] = worldPts[ic];
            const rBase = roofPos.length / 3;
            roofPos.push(ax, topY, az, bx, topY, bz, cxp, topY, czp);
            roofNorm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
            roofUv.push(ax * 0.08, az * 0.08, bx * 0.08, bz * 0.08, cxp * 0.08, czp * 0.08);
            roofIdx.push(rBase, rBase + 1, rBase + 2);
          }

          markBuildingOccupied(cx, cz);
        }

        if (abortSignal?.aborted) return;

        const osmGroup = new THREE.Group();
        osmGroup.name = 'salatiga-osm-buildings';

        wallBuckets.forEach((b, i) => {
          if (!b.pos.length) return;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
          g.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
          g.setIndex(b.idx);
          const m = new THREE.Mesh(g, rukoWallMats[i]);
          m.castShadow = true;
          m.receiveShadow = true;
          osmGroup.add(m);
        });

        if (roofPos.length) {
          const rg = new THREE.BufferGeometry();
          rg.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3));
          rg.setAttribute('normal', new THREE.Float32BufferAttribute(roofNorm, 3));
          rg.setAttribute('uv', new THREE.Float32BufferAttribute(roofUv, 2));
          rg.setIndex(roofIdx);
          rg.computeVertexNormals();
          const rm = new THREE.Mesh(rg, rukoRoofMat);
          rm.castShadow = true;
          rm.receiveShadow = true;
          osmGroup.add(rm);
        }

        if (osmKanopiSpecs.length) {
          const kGeo = new THREE.BoxGeometry(1, 0.14, 1);
          const kIM = new THREE.InstancedMesh(kGeo, kanopiMats[0], osmKanopiSpecs.length);
          kIM.castShadow = true;
          kIM.receiveShadow = true;
          osmKanopiSpecs.forEach((kn, idx) => {
            dummy.position.set(kn.x, kn.y, kn.z);
            dummy.rotation.set(0, kn.yaw, 0);
            dummy.rotateX(0.22);
            dummy.scale.set(kn.w, 1, kn.d);
            dummy.updateMatrix();
            kIM.setMatrixAt(idx, dummy.matrix);
          });
          kIM.instanceMatrix.needsUpdate = true;
          kIM.computeBoundingSphere();
          osmGroup.add(kIM);
        }

        scene.add(osmGroup);

        // Fill remaining corridor slots along Sudirman South, Tingkir, JLS & Wates Finish
        buildCorridorFillBuildings();
        buildTrees();
      })
      .catch((err) => {
        if (!abortSignal?.aborted) {
          console.warn('Salatiga GeoJSON fallback to corridor fill:', err?.message || err);
          buildCorridorFillBuildings();
          buildTrees();
        }
      });
  }

  return {
    waterMaterial: null,
    mountainMistUniform,
    secondaryBridgeUs: [wrapU(0.32), wrapU(0.72)],
    repairTokenCount: 18,
  };
}
