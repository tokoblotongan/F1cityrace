// ============================================================================
// engine.ts — Monaco GP: Street Circuit Challenge (React-mounted WebGL Engine)
// Scene, Mediterranean lighting + sky/env bake, bloom pipeline (with software
// WebGL pacing guard), Chase / T-Cam / Cockpit camera switcher ('C'),
// keyboard input (WASD/Arrows, Space/Shift = DRS, 'R' = reset/restart),
// fixed-step physics loop, and full React unmount disposal.
// ============================================================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildTrack } from './track.js';
import { CircuitId } from '../data/circuits.ts';
import {
  createF1Car,
  updateCarPhysics,
  resolveCarCollisions,
  applyCarDamage,
  applyCarRepair,
  resetCarHealth,
} from './carPhysics.js';
import {
  initAIRacers,
  updateAIRacers,
  placeCarOnGrid,
  restartRace,
  setSessionHold,
  syncSessionFromHost,
} from './aiRacer.js';
import {
  AiTelemetryBatchPacket,
  AiTelemetryCar,
  PlayerTelemetryPacket,
  RaceSlotAssignment,
  colorHexToNum,
} from './multiplayer.ts';
import {
  initAudio,
  updateAudio,
  updateHUD,
  setHudCircuit,
  notifyRepairPickup,
  playWhooshSound,
  playCollisionSound,
  playGameOverSound,
  playFinishSound,
  playThunderSound,
  stopVictoryMusic,
} from './audioHud.js';

const STEP = 1 / 120;
const MAX_SUBSTEPS = 6;
const CAMERA_MODES = ['CHASE', 'T-CAM', 'COCKPIT'] as const;

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function buildCloudClusterGeometry(
  puffs: Array<{ x: number; y: number; z: number; rx: number; ry: number; rz: number }>
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  let vertOffset = 0;

  const baseSphere = new THREE.IcosahedronGeometry(1, 3);
  const posAttr = baseSphere.getAttribute('position');
  const normAttr = baseSphere.getAttribute('normal');
  const idxAttr = baseSphere.getIndex();

  for (const puff of puffs) {
    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i);
      const ly = posAttr.getY(i);
      const lz = posAttr.getZ(i);
      // Flatten underside for dramatic sculpted stratocumulus / cumulus shelves
      const flatY = ly < 0 ? ly * 0.46 : ly;
      const wx = puff.x + lx * puff.rx;
      const wy = puff.y + flatY * puff.ry;
      const wz = puff.z + lz * puff.rz;
      positions.push(wx, wy, wz);
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;

      const nx = normAttr.getX(i) / Math.max(0.1, puff.rx);
      const ny = normAttr.getY(i) / Math.max(0.1, puff.ry);
      const nz = normAttr.getZ(i) / Math.max(0.1, puff.rz);
      const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
      normals.push(nx * inv, ny * inv, nz * inv);
    }
    if (idxAttr) {
      for (let i = 0; i < idxAttr.count; i++) {
        indices.push(vertOffset + idxAttr.getX(i));
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) indices.push(vertOffset + i);
    }
    vertOffset += posAttr.count;
  }
  baseSphere.dispose();

  const spanY = Math.max(0.01, maxY - minY);
  const localY = new Float32Array(positions.length / 3);
  for (let i = 0; i < localY.length; i++) {
    localY[i] = (positions[i * 3 + 1] - minY) / spanY;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aLocalY', new THREE.BufferAttribute(localY, 1));
  geo.setIndex(indices);
  return geo;
}

function createSkyDome(scene: THREE.Scene, sunDir: THREE.Vector3) {
  const skyDomeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() },
      uSkyFade: { value: 1.0 },
      uTime: { value: 0 },
      uHorizonCol: { value: new THREE.Color(0x4da6ff) },
      uMidCol: { value: new THREE.Color(0x256fc8) },
      uZenithCol: { value: new THREE.Color(0x1a4b8c) },
      uSeaCol: { value: new THREE.Color(0x2e70b8) },
      uSunStrength: { value: 1.0 },
      uLightning: { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      uniform float uSkyFade;
      uniform float uTime;
      uniform vec3 uHorizonCol;
      uniform vec3 uMidCol;
      uniform vec3 uZenithCol;
      uniform vec3 uSeaCol;
      uniform float uSunStrength;
      uniform float uLightning;
      varying vec3 vDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p = p * 2.05 + vec2(1.7, 9.2);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, 0.0, 1.0);

        vec3 sky = mix(uHorizonCol, uMidCol, smoothstep(0.0, 0.30, h));
        sky = mix(sky, uZenithCol, smoothstep(0.24, 0.92, h));
        if (dir.y < 0.0) {
          sky = mix(uHorizonCol, uSeaCol, smoothstep(0.0, 0.25, -dir.y));
        }

        // Subtle high-altitude wispy cirrus & storm cloud strata
        if (dir.y > 0.02) {
          vec2 uvCirrus = dir.xz / (dir.y + 0.16) * 1.45 + vec2(uTime * 0.004, 0.0);
          float wisp = fbm(uvCirrus * 1.8);
          float wispMask = smoothstep(0.54, 0.82, wisp) * smoothstep(0.02, 0.22, dir.y) * smoothstep(0.95, 0.32, dir.y);
          vec3 wispCol = mix(vec3(0.45, 0.52, 0.62), vec3(0.86, 0.93, 1.0), uSunStrength);
          sky = mix(sky, wispCol, wispMask * 0.28);
        }

        // Solar atmospheric scattering halo + crisp sun disc (scaled by clear-sky strength)
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        sky += vec3(1.0, 0.92, 0.72) * pow(sunDot, 7.0) * 0.24 * uSunStrength;
        sky += vec3(1.0, 0.96, 0.86) * pow(sunDot, 48.0) * 0.45 * uSunStrength;
        sky += vec3(1.0, 0.99, 0.94) * smoothstep(0.9982, 0.9995, sunDot) * 1.1 * uSunStrength;

        // Storm lightning sky illumination
        sky += vec3(0.76, 0.85, 1.0) * uLightning * (0.38 + 0.62 * h);

        vec3 tunnelCol = vec3(0.051, 0.059, 0.071);
        gl_FragColor = vec4(mix(tunnelCol, sky, uSkyFade), 1.0);
      }
    `,
  });

  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(11000, 48, 32), skyDomeMat);
  skyDome.renderOrder = -2;
  skyDome.frustumCulled = false;
  scene.add(skyDome);
  return { skyDome, skyDomeMat };
}

function createMediterraneanClouds(scene: THREE.Scene, sunDir: THREE.Vector3) {
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() },
      uOpacity: { value: 0.95 },
      uDarken: { value: 0.0 },
      uLightning: { value: 0.0 },
    },
    vertexShader: `
      attribute float aLocalY;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying float vHeight;
      void main() {
        vHeight = aLocalY;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      uniform float uOpacity;
      uniform float uDarken;
      uniform float uLightning;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying float vHeight;
      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = abs(dot(N, V));
        float softEdge = smoothstep(0.06, 0.54, ndv);

        float sunLit = clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
        float topFactor = smoothstep(0.08, 0.86, vHeight);
        float contrastMix = smoothstep(0.18, 0.84, topFactor * 0.62 + sunLit * 0.38);

        float silverGoldRim = pow(max(dot(-V, uSunDir), 0.0), 5.0) * (1.0 - ndv) * 0.48 * (1.0 - uDarken * 0.85);

        vec3 baseShadowCol = mix(vec3(0.35, 0.42, 0.60), vec3(0.12, 0.16, 0.22), uDarken);
        vec3 midCloudCol   = mix(vec3(0.76, 0.82, 0.92), vec3(0.24, 0.30, 0.38), uDarken);
        vec3 sunlitPeakCol = mix(vec3(1.00, 0.965, 0.88), vec3(0.36, 0.43, 0.52), uDarken);

        vec3 col = mix(baseShadowCol, midCloudCol, smoothstep(0.0, 0.58, contrastMix));
        col = mix(col, sunlitPeakCol, smoothstep(0.45, 0.96, contrastMix));
        col += vec3(1.0, 0.94, 0.78) * silverGoldRim;
        col += vec3(0.74, 0.84, 1.0) * uLightning * (0.45 + 0.55 * topFactor);

        gl_FragColor = vec4(col, softEdge * uOpacity);
      }
    `,
  });

  const prototypes = [
    buildCloudClusterGeometry([
      { x: 0, y: 2, z: 0, rx: 26, ry: 13, rz: 17 },
      { x: -18, y: 0, z: 3, rx: 17, ry: 10, rz: 13 },
      { x: 19, y: 0.5, z: -2, rx: 18, ry: 10.5, rz: 14 },
      { x: -7, y: 11, z: -2, rx: 15, ry: 11, rz: 12 },
      { x: 10, y: 12.5, z: 2, rx: 14, ry: 10.5, rz: 11 },
      { x: 1, y: 17.5, z: 0, rx: 11, ry: 9.5, rz: 9.5 },
      { x: -30, y: -2, z: -1, rx: 12, ry: 7, rz: 10 },
      { x: 31, y: -1.5, z: 2, rx: 13, ry: 7.5, rz: 10 },
      { x: -2, y: -1.5, z: 12, rx: 14, ry: 7.5, rz: 9 },
    ]),
    buildCloudClusterGeometry([
      { x: 0, y: 3, z: 0, rx: 30, ry: 13.5, rz: 18 },
      { x: -22, y: 1, z: -3, rx: 18, ry: 10, rz: 13 },
      { x: 21, y: -0.5, z: 4, rx: 19, ry: 10, rz: 14 },
      { x: 2, y: 14, z: 1, rx: 16, ry: 11.5, rz: 13 },
      { x: -13, y: 9.5, z: 3, rx: 13, ry: 9, rz: 11 },
      { x: 15, y: 9, z: -3, rx: 14, ry: 9, rz: 11 },
      { x: -35, y: -2, z: 1, rx: 13, ry: 7, rz: 9.5 },
      { x: 35, y: -2, z: -1, rx: 13, ry: 6.8, rz: 9.5 },
      { x: 6, y: 20, z: 0, rx: 10, ry: 8.5, rz: 8.5 },
    ]),
    buildCloudClusterGeometry([
      { x: 0, y: 1.5, z: 0, rx: 21, ry: 11.5, rz: 15 },
      { x: -15, y: 0, z: 2, rx: 14, ry: 8.8, rz: 11.5 },
      { x: 15, y: 0.5, z: -2, rx: 15, ry: 9.2, rz: 12 },
      { x: 4, y: 10.5, z: 1, rx: 12.5, ry: 9.5, rz: 10.5 },
      { x: -8, y: 8, z: -2, rx: 11, ry: 8, rz: 9.5 },
      { x: 0, y: -1, z: -10, rx: 13, ry: 7, rz: 8.5 },
    ]),
  ];

  const clouds: Array<{ mesh: THREE.Mesh; speed: number; dx: number; dz: number }> = [];
  let cloudCenterX = 340;
  let cloudCenterZ = -140;
  for (let i = 0; i < 22; i++) {
    const ang = (i / 22) * Math.PI * 2 + (i % 3) * 0.14;
    const rad = 460 + (i % 5) * 140;
    const mesh = new THREE.Mesh(prototypes[i % prototypes.length], cloudMat);
    const sc = 1.2 + (i % 5) * 0.26;
    mesh.scale.set(sc, sc * 0.94, sc);
    const dx = Math.cos(ang) * rad;
    const dz = Math.sin(ang) * rad;
    mesh.position.set(cloudCenterX + dx, 138 + (i % 4) * 26, cloudCenterZ + dz);
    mesh.rotation.y = (i * 0.9) % (Math.PI * 2);
    mesh.renderOrder = -1;
    scene.add(mesh);
    clouds.push({ mesh, speed: 1.6 + (i % 4) * 0.55, dx, dz });
  }

  return {
    clouds,
    cloudMat,
    setCenter: (cx: number, cz: number) => {
      cloudCenterX = cx;
      cloudCenterZ = cz;
      for (const c of clouds) {
        c.mesh.position.x = cx + c.dx;
        c.mesh.position.z = cz + c.dz;
      }
    },
    getCenter: () => ({ x: cloudCenterX, z: cloudCenterZ }),
  };
}

export type WeatherType = 'cerah' | 'hujan' | 'kabut';
export type { CircuitId };

export interface MultiplayerStartOptions {
  isHost: boolean;
  localPlayerId: string;
  driverName: string;
  liveryColor: string;
  slots: RaceSlotAssignment[];
  startAtMs?: number;
  onSendPlayerTelemetry?: (pkt: PlayerTelemetryPacket) => void;
  onSendAiTelemetry?: (pkt: AiTelemetryBatchPacket) => void;
  onHostRestart?: () => void;
}

export interface EngineController {
  startRace: (weather: WeatherType, circuit?: CircuitId) => void;
  setWeather: (weather: WeatherType) => void;
  setCircuit: (circuit: CircuitId) => void;
  restartWithWeather: (weather: WeatherType, circuit?: CircuitId) => void;
  setPlayerProfile: (name: string, liveryColor: string) => void;
  startMultiplayerRace: (weather: WeatherType, circuit: CircuitId, mp: MultiplayerStartOptions) => void;
  stopMultiplayerToSinglePreview: () => void;
  receiveRemotePlayerTelemetry: (pkt: PlayerTelemetryPacket) => void;
  receiveRemoteAiTelemetry: (pkt: AiTelemetryBatchPacket) => void;
  removeRemotePlayer: (playerId: string) => void;
}

export interface RaceFinishResult {
  playerPosition: number;
  bestLapTime: number | null;
  totalRaceTime: number;
  gapText?: string;
  isForcedFinish?: boolean;
}

export interface EngineCallbacks {
  initialWeather?: WeatherType;
  initialCircuit?: CircuitId;
  onWebGLError?: (msg: string) => void;
  onRaceFinish?: (result: RaceFinishResult | null) => void;
  onChequeredCountdown?: (secondsRemaining: number | null) => void;
  onReady?: (controller: EngineController) => void;
}

interface WeatherPreset {
  grip: number;
  brake: number;
  traction: number;
  rainIntensity: number;
  rainCount: number;
  rainSpeed: number;
  rainLen: number;
  rainOpacity: number;
  rainColor: number;
  sprayRate: number;
  fogMode: 'linear' | 'exp2';
  fogColor: number;
  fogNear: number;
  fogFar: number;
  fogDensity: number;
  skyHorizon: number;
  skyMid: number;
  skyZenith: number;
  skySea: number;
  sunStrength: number;
  cloudDarken: number;
  cloudOpacity: number;
  ambientColor: number;
  ambientInt: number;
  hemiSky: number;
  hemiGround: number;
  hemiInt: number;
  sunColor: number;
  sunInt: number;
  envInt: number;
  exposure: number;
  bloomStrength: number;
  asphaltColor: number;
  asphaltRoughness: number;
  asphaltMetalness: number;
  asphaltBump: number;
  asphaltEnv: number;
  curbRoughness: number;
  curbMetalness: number;
  curbEnv: number;
}

const WEATHER_PRESETS: Record<WeatherType, WeatherPreset> = {
  cerah: {
    grip: 1.0,
    brake: 1.0,
    traction: 1.0,
    rainIntensity: 0,
    rainCount: 0,
    rainSpeed: 30,
    rainLen: 1.2,
    rainOpacity: 0,
    rainColor: 0xcbe3ff,
    sprayRate: 0,
    fogMode: 'linear',
    fogColor: 0x4da6ff,
    fogNear: 180,
    fogFar: 950,
    fogDensity: 0,
    skyHorizon: 0x4da6ff,
    skyMid: 0x256fc8,
    skyZenith: 0x1a4b8c,
    skySea: 0x2e70b8,
    sunStrength: 1.0,
    cloudDarken: 0.0,
    cloudOpacity: 0.95,
    ambientColor: 0xffffff,
    ambientInt: 0.58,
    hemiSky: 0x4da6ff,
    hemiGround: 0x2b3329,
    hemiInt: 0.28,
    sunColor: 0xfff4dc,
    sunInt: 1.22,
    envInt: 0.35,
    exposure: 0.92,
    bloomStrength: 0.22,
    asphaltColor: 0xffffff,
    asphaltRoughness: 0.78,
    asphaltMetalness: 0.05,
    asphaltBump: 0.04,
    asphaltEnv: 0.7,
    curbRoughness: 0.65,
    curbMetalness: 0.04,
    curbEnv: 0.65,
  },
  hujan: {
    grip: 0.72,
    brake: 0.75,
    traction: 0.80,
    rainIntensity: 1.0,
    rainCount: 1500,
    rainSpeed: 35,
    rainLen: 1.5,
    rainOpacity: 0.44,
    rainColor: 0xc4d9f2,
    sprayRate: 1.0,
    fogMode: 'exp2',
    fogColor: 0x243140,
    fogNear: 90,
    fogFar: 550,
    fogDensity: 0.0045,
    skyHorizon: 0x334155,
    skyMid: 0x222c3a,
    skyZenith: 0x151d28,
    skySea: 0x18222e,
    sunStrength: 0.08,
    cloudDarken: 0.74,
    cloudOpacity: 0.98,
    ambientColor: 0x99b1cc,
    ambientInt: 0.48,
    hemiSky: 0x475569,
    hemiGround: 0x18202c,
    hemiInt: 0.30,
    sunColor: 0xa6bfd9,
    sunInt: 0.42,
    envInt: 0.54,
    exposure: 0.88,
    bloomStrength: 0.30,
    asphaltColor: 0x8b95a4,
    asphaltRoughness: 0.22,
    asphaltMetalness: 0.25,
    asphaltBump: 0.018,
    asphaltEnv: 1.85,
    curbRoughness: 0.26,
    curbMetalness: 0.16,
    curbEnv: 1.4,
  },
  kabut: {
    grip: 0.86,
    brake: 0.88,
    traction: 0.91,
    rainIntensity: 0.32,
    rainCount: 520,
    rainSpeed: 17,
    rainLen: 0.55,
    rainOpacity: 0.26,
    rainColor: 0xd8e4f0,
    sprayRate: 0.38,
    fogMode: 'exp2',
    fogColor: 0xb8c7d4,
    fogNear: 40,
    fogFar: 220,
    fogDensity: 0.0155,
    skyHorizon: 0xb8c7d4,
    skyMid: 0x9ab0c2,
    skyZenith: 0x7b92a6,
    skySea: 0x94a8b9,
    sunStrength: 0.14,
    cloudDarken: 0.24,
    cloudOpacity: 0.65,
    ambientColor: 0xdce7f2,
    ambientInt: 0.62,
    hemiSky: 0xb8c7d4,
    hemiGround: 0x52606d,
    hemiInt: 0.34,
    sunColor: 0xdce6f2,
    sunInt: 0.50,
    envInt: 0.32,
    exposure: 0.90,
    bloomStrength: 0.20,
    asphaltColor: 0xc2ccd6,
    asphaltRoughness: 0.44,
    asphaltMetalness: 0.14,
    asphaltBump: 0.028,
    asphaltEnv: 1.2,
    curbRoughness: 0.42,
    curbMetalness: 0.10,
    curbEnv: 1.0,
  },
};

export function startMonacoEngine(
  canvas: HTMLCanvasElement,
  callbacks: EngineCallbacks = {}
): () => void {
  const isSoftwareGl = detectSoftwareWebGL();

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
  } catch {
    callbacks.onWebGLError?.('WebGL is unavailable on this device — Monaco GP cannot start.');
    return () => {};
  }

  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // --- Scene & Dynamic Weather Atmosphere ---
  const scene = new THREE.Scene();
  const TUNNEL_FOG = new THREE.Color(0x0d0f12);
  const SKY_TARGET = new THREE.Color(0x4da6ff);
  const LIGHTNING_COL = new THREE.Color(0xbcd6ff);
  const linearFog = new THREE.Fog(0x4da6ff, 180, 950);
  const expFog = new THREE.FogExp2(0x243140, 0.0045);
  scene.background = SKY_TARGET.clone();
  scene.fog = linearFog;

  const camera = new THREE.PerspectiveCamera(
    72,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.1,
    13500
  );
  camera.position.set(0, 6, 14);

  const sunDir = new THREE.Vector3();
  {
    const elev = THREE.MathUtils.degToRad(44);
    const azim = THREE.MathUtils.degToRad(145);
    sunDir.setFromSphericalCoords(1, Math.PI / 2 - elev, azim);
  }

  let envRT: THREE.WebGLRenderTarget | null = null;
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();
  }

  const ambient = new THREE.AmbientLight(0xffffff, 0.58);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0x4da6ff, 0x2b3329, 0.28);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4dc, 1.22);
  sun.castShadow = !isSoftwareGl;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -75;
  sun.shadow.camera.right = 75;
  sun.shadow.camera.top = 75;
  sun.shadow.camera.bottom = -75;
  sun.shadow.camera.near = 60;
  sun.shadow.camera.far = 750;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);

  // --- World + Sky Dome + Mediterranean Clouds + Player + AI Racers ---
  const { skyDome, skyDomeMat } = createSkyDome(scene, sunDir);
  const { clouds, cloudMat, setCenter: setCloudCenter, getCenter: getCloudCenter } = createMediterraneanClouds(scene, sunDir);

  let currentCircuit: CircuitId = callbacks.initialCircuit ?? 'monaco-gp';
  let worldAbort: AbortController | null = new AbortController();
  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  function computeTrackCenterXZ(td: any): [number, number] {
    const pts = td?.trackCurve?.userData?.samples?.pos;
    if (!Array.isArray(pts) || !pts.length) return [0, 0];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pts.length; i += 8) {
      const p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    return [(minX + maxX) * 0.5, (minZ + maxZ) * 0.5];
  }

  function disposeWorldGroup() {
    worldGroup.traverse((obj: any) => {
      if (obj === worldGroup) return;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) m.map.dispose();
          if (m.bumpMap) m.bumpMap.dispose();
          if (m.roughnessMap) m.roughnessMap.dispose();
          if (m.normalMap) m.normalMap.dispose();
          if (m.emissiveMap) m.emissiveMap.dispose();
          m.dispose();
        }
      }
    });
    worldGroup.clear();
  }

  let trackData: any = buildTrack(worldGroup, currentCircuit, { abortSignal: worldAbort.signal });
  const [initCx, initCz] = computeTrackCenterXZ(trackData);
  setCloudCenter(initCx, initCz);
  setHudCircuit(currentCircuit);

  let playerDriverName = 'YOU';
  let playerLiveryHex = '#e10600';
  let playerLiveryNum = 0xe10600;

  let playerCar: THREE.Group = createF1Car(playerLiveryNum, true);
  playerCar.userData.driver = playerDriverName;
  playerCar.userData.color = playerLiveryNum;
  scene.add(playerCar);
  updateCarPhysics(playerCar, { reset: true }, trackData, 0);
  placeCarOnGrid(playerCar, trackData, 0);

  let aiList: THREE.Group[] = initAIRacers(scene, trackData, { count: 7, startSlot: 1 });
  const remoteHumanCars = new Map<string, THREE.Group>();
  const remoteAiCars = new Map<number, THREE.Group>();
  let allCars: THREE.Group[] = [playerCar, ...aiList];

  function disposeCarObject(car: THREE.Object3D) {
    scene.remove(car);
    car.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
  }

  function createDriverNameplate(name: string, hexColor: string): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      g.clearRect(0, 0, 256, 64);
      g.fillStyle = 'rgba(11, 15, 22, 0.86)';
      g.beginPath();
      if (typeof g.roundRect === 'function') {
        g.roundRect(6, 10, 244, 44, 10);
      } else {
        g.rect(6, 10, 244, 44);
      }
      g.fill();
      g.strokeStyle = 'rgba(242, 239, 230, 0.28)';
      g.lineWidth = 2;
      g.stroke();

      g.fillStyle = hexColor || '#00d2be';
      g.fillRect(14, 18, 8, 28);

      g.fillStyle = '#f2efe6';
      g.font = '900 22px "Titillium Web", sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText((name || 'DRIVER').toUpperCase().slice(0, 14), 32, 33);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(0, 1.95, 0);
    sprite.scale.set(2.9, 0.725, 1);
    sprite.renderOrder = 5;
    sprite.userData.isNameplate = true;
    return sprite;
  }

  let trackUserData = trackData.trackCurve.userData as any;
  let waterMat = trackUserData.waterMaterial;
  if (waterMat?.uniforms?.uSunDir) {
    waterMat.uniforms.uSunDir.value.copy(sunDir);
  }
  let asphaltMaterial = trackUserData.asphaltMaterial as THREE.MeshStandardMaterial | undefined;
  let curbMaterial = trackUserData.curbMaterial as THREE.MeshStandardMaterial | undefined;
  let tunnel = trackUserData.tunnel;
  let envTime = trackUserData.envTime;
  let trackPlayerPos = trackUserData.playerPos;
  let mountainMistUniform = trackUserData.mountainMistUniform as { value: number } | null | undefined;

  // --- Pooled 60 FPS 3D Rain / Drizzle Streaks (THREE.LineSegments) ---
  const MAX_RAIN = 1500;
  const RAIN_BOX_XZ = 76;
  const RAIN_BOX_Y = 34;
  const RAIN_HALF_XZ = RAIN_BOX_XZ * 0.5;
  const rainOffsets = new Float32Array(MAX_RAIN * 3);
  const rainSeeds = new Float32Array(MAX_RAIN);
  const rainPositions = new Float32Array(MAX_RAIN * 2 * 3);
  for (let i = 0; i < MAX_RAIN; i++) {
    rainOffsets[i * 3 + 0] = (Math.random() - 0.5) * RAIN_BOX_XZ;
    rainOffsets[i * 3 + 1] = Math.random() * RAIN_BOX_Y - 6;
    rainOffsets[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX_XZ;
    rainSeeds[i] = 0.82 + Math.random() * 0.36;
  }
  const rainGeo = new THREE.BufferGeometry();
  const rainPosAttr = new THREE.BufferAttribute(rainPositions, 3);
  rainPosAttr.setUsage(THREE.DynamicDrawUsage);
  rainGeo.setAttribute('position', rainPosAttr);
  rainGeo.setDrawRange(0, 0);
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xc4d9f2,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
  });
  const rainLines = new THREE.LineSegments(rainGeo, rainMat);
  rainLines.frustumCulled = false;
  rainLines.visible = false;
  scene.add(rainLines);

  // --- Pooled 60 FPS Tire Water Spray Rooster Plumes (InstancedMesh) ---
  const SPRAY_COUNT = 180;
  const sprayGeo = new THREE.IcosahedronGeometry(0.18, 0);
  const sprayMat = new THREE.MeshBasicMaterial({
    color: 0xe6eff8,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const sprayMesh = new THREE.InstancedMesh(sprayGeo, sprayMat, SPRAY_COUNT);
  sprayMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sprayMesh.frustumCulled = false;
  sprayMesh.visible = false;
  scene.add(sprayMesh);

  interface SprayDrop {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    age: number;
    life: number;
    baseScale: number;
    active: boolean;
  }
  const sprayPool: SprayDrop[] = [];
  const sprayDummy = new THREE.Object3D();
  sprayDummy.scale.setScalar(0);
  sprayDummy.updateMatrix();
  for (let i = 0; i < SPRAY_COUNT; i++) {
    sprayMesh.setMatrixAt(i, sprayDummy.matrix);
    sprayPool.push({
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      life: 0.35,
      baseScale: 0.6,
      active: false,
    });
  }
  sprayMesh.instanceMatrix.needsUpdate = true;
  let sprayNext = 0;
  let sprayAcc = 0;

  let currentWeather: WeatherType = callbacks.initialWeather ?? 'cerah';
  let activePreset: WeatherPreset = WEATHER_PRESETS[currentWeather];
  let waitingToStart = true;
  let tunnelMix = 0;
  let lightningTimer = 6 + Math.random() * 6;
  let lightningAge = -1;

  function getFogRange() {
    if (currentCircuit === 'salatiga-gp' && currentWeather === 'cerah') {
      return { near: 420, far: 8800 };
    }
    return { near: activePreset.fogNear, far: activePreset.fogFar };
  }

  function applyWeatherPreset(w: WeatherType) {
    currentWeather = w;
    activePreset = WEATHER_PRESETS[w];
    (trackData as any).weather = w;
    (trackData as any).weatherGrip = activePreset.grip;
    (trackData as any).weatherBrake = activePreset.brake;
    (trackData as any).weatherTraction = activePreset.traction;

    if (asphaltMaterial) {
      asphaltMaterial.color.setHex(activePreset.asphaltColor);
      asphaltMaterial.roughness = activePreset.asphaltRoughness;
      asphaltMaterial.metalness = activePreset.asphaltMetalness;
      asphaltMaterial.bumpScale = activePreset.asphaltBump;
      asphaltMaterial.envMapIntensity = activePreset.asphaltEnv;
    }
    if (curbMaterial) {
      curbMaterial.roughness = activePreset.curbRoughness;
      curbMaterial.metalness = activePreset.curbMetalness;
      curbMaterial.envMapIntensity = activePreset.curbEnv;
    }

    skyDomeMat.uniforms.uHorizonCol.value.setHex(activePreset.skyHorizon);
    skyDomeMat.uniforms.uMidCol.value.setHex(activePreset.skyMid);
    skyDomeMat.uniforms.uZenithCol.value.setHex(activePreset.skyZenith);
    skyDomeMat.uniforms.uSeaCol.value.setHex(activePreset.skySea);
    skyDomeMat.uniforms.uSunStrength.value = activePreset.sunStrength;
    skyDomeMat.uniforms.uLightning.value = 0;

    cloudMat.uniforms.uDarken.value = activePreset.cloudDarken;
    cloudMat.uniforms.uLightning.value = 0;

    ambient.color.setHex(activePreset.ambientColor);
    ambient.intensity = activePreset.ambientInt;
    hemi.color.setHex(activePreset.hemiSky);
    hemi.groundColor.setHex(activePreset.hemiGround);
    hemi.intensity = activePreset.hemiInt;
    sun.color.setHex(activePreset.sunColor);
    sun.intensity = activePreset.sunInt;
    scene.environmentIntensity = activePreset.envInt;

    rainMat.color.setHex(activePreset.rainColor);
    rainMat.opacity = activePreset.rainOpacity;
    if (activePreset.rainCount <= 0) {
      rainLines.visible = false;
      rainGeo.setDrawRange(0, 0);
    }

    if (activePreset.sprayRate <= 0) {
      sprayMesh.visible = false;
      for (let i = 0; i < SPRAY_COUNT; i++) {
        sprayPool[i].active = false;
        sprayDummy.scale.setScalar(0);
        sprayDummy.updateMatrix();
        sprayMesh.setMatrixAt(i, sprayDummy.matrix);
      }
      sprayMesh.instanceMatrix.needsUpdate = true;
    }

    SKY_TARGET.setHex(activePreset.fogColor);
    if (activePreset.fogMode === 'linear') {
      const { near, far } = getFogRange();
      linearFog.color.copy(SKY_TARGET);
      linearFog.near = near;
      linearFog.far = far;
      scene.fog = linearFog;
    } else {
      expFog.color.copy(SKY_TARGET);
      expFog.density = activePreset.fogDensity;
      scene.fog = expFog;
    }
    if (mountainMistUniform) {
      mountainMistUniform.value = w === 'kabut' ? 1.0 : w === 'hujan' ? 0.38 : 0.0;
    }
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(SKY_TARGET);
    }

    lightningAge = -1;
    lightningTimer = 7 + Math.random() * 8;
  }

  applyWeatherPreset(currentWeather);

  // --- Post-processing (GPU only; high threshold so only emissives bloom) ---
  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;
  if (!isSoftwareGl) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.22,
      0.4,
      0.95
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    renderer.compile(scene, camera);
  }

  // --- Input ---
  const keys: Record<string, boolean> = Object.create(null);
  let resetQueued = false;
  let cameraMode = 0;
  let audioStarted = false;

  function setCameraMode(m: number) {
    cameraMode = m;
    const cockpit = CAMERA_MODES[m] === 'COCKPIT';
    playerCar.userData.parts.helmet.visible = !cockpit;
    camera.near = cockpit ? 0.06 : 0.1;
    camera.updateProjectionMatrix();
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const activeTag = document.activeElement?.tagName;
    const targetTag = (e.target as HTMLElement | null)?.tagName;
    if (
      activeTag === 'INPUT' ||
      activeTag === 'TEXTAREA' ||
      targetTag === 'INPUT' ||
      targetTag === 'TEXTAREA'
    ) {
      return;
    }
    if (waitingToStart) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'KeyC') setCameraMode((cameraMode + 1) % CAMERA_MODES.length);
    if (e.code === 'KeyR') resetQueued = true;
    if (!audioStarted) {
      audioStarted = true;
      initAudio();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys[e.code] = false;
  };
  const onBlur = () => {
    for (const k in keys) keys[k] = false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const controls = { throttle: 0, brake: 0, steer: 0, drs: false, reset: false };
  function buildControls(dt: number) {
    const tT = keys.KeyW || keys.ArrowUp ? 1 : 0;
    const bT = keys.KeyS || keys.ArrowDown ? 1 : 0;
    const sT = keys.KeyA || keys.ArrowLeft ? 1 : keys.KeyD || keys.ArrowRight ? -1 : 0;
    controls.throttle +=
      (tT - controls.throttle) * Math.min(1, (tT > controls.throttle ? 5 : 9) * dt);
    controls.brake += (bT - controls.brake) * Math.min(1, 9 * dt);
    controls.steer += (sT - controls.steer) * Math.min(1, (sT !== 0 ? 3.4 : 6) * dt);
    controls.drs = !!(keys.Space || keys.ShiftLeft || keys.ShiftRight);
    controls.reset = resetQueued;
    resetQueued = false;
  }

  // --- Pooled 60 FPS Damage Smoke & Contact/Floor Sparks ---
  const SMOKE_COUNT = 30;
  const SPARK_COUNT = 56;
  const smokeGeo = new THREE.IcosahedronGeometry(0.24, 1);
  const sparkGeo = new THREE.BoxGeometry(0.052, 0.052, 0.36);

  interface SmokePuff {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    vel: THREE.Vector3;
    age: number;
    life: number;
    maxOp: number;
    active: boolean;
  }
  interface SparkBit {
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    groundY: number;
    age: number;
    life: number;
    active: boolean;
  }

  const smokePool: SmokePuff[] = [];
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcfd6e0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(smokeGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    smokePool.push({
      mesh,
      mat,
      vel: new THREE.Vector3(),
      age: 0,
      life: 0.9,
      maxOp: 0.45,
      active: false,
    });
  }

  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xffb833,
    transparent: true,
    opacity: 0.96,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sparkPool: SparkBit[] = [];
  for (let i = 0; i < SPARK_COUNT; i++) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparkPool.push({
      mesh,
      vel: new THREE.Vector3(),
      groundY: 0,
      age: 0,
      life: 0.35,
      active: false,
    });
  }

  let smokeNext = 0;
  let sparkNext = 0;
  let smokeAcc = 0;
  let sparkAcc = 0;
  let contactSparkCooldown = 0;
  const _pTmp = new THREE.Vector3();
  const _pFwd = new THREE.Vector3();
  const _pRight = new THREE.Vector3();

  function spawnContactSparks(
    x: number,
    y: number,
    z: number,
    tx: number,
    tz: number,
    speedScale: number,
    count: number
  ) {
    const baseSpd = Math.min(24, Math.max(6, speedScale));
    for (let i = 0; i < count; i++) {
      const sp = sparkPool[sparkNext];
      sparkNext = (sparkNext + 1) % SPARK_COUNT;
      const spread = (Math.random() - 0.5) * 7.5;
      const along = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.75) * baseSpd * 0.65;
      sp.mesh.position.set(
        x + (Math.random() - 0.5) * 0.24,
        y + 0.28 + Math.random() * 0.25,
        z + (Math.random() - 0.5) * 0.24
      );
      sp.vel.set(
        tx * along + (Math.random() - 0.5) * spread,
        1.8 + Math.random() * 3.8,
        tz * along + (Math.random() - 0.5) * spread
      );
      sp.mesh.rotation.set(0, Math.atan2(sp.vel.x, sp.vel.z), 0);
      sp.groundY = y;
      sp.age = 0;
      sp.life = 0.18 + Math.random() * 0.22;
      sp.active = true;
      sp.mesh.visible = true;
    }
  }

  function resetParticles() {
    smokeAcc = 0;
    sparkAcc = 0;
    sprayAcc = 0;
    contactSparkCooldown = 0;
    for (const s of smokePool) {
      s.active = false;
      s.mesh.visible = false;
    }
    for (const sp of sparkPool) {
      sp.active = false;
      sp.mesh.visible = false;
    }
    for (let i = 0; i < SPRAY_COUNT; i++) {
      sprayPool[i].active = false;
      sprayDummy.scale.setScalar(0);
      sprayDummy.updateMatrix();
      sprayMesh.setMatrixAt(i, sprayDummy.matrix);
    }
    sprayMesh.instanceMatrix.needsUpdate = true;
  }

  function updateWeatherEffects(dt: number, inTunnel: boolean) {
    // 1. Dynamic Lightning & Thunder (Hujan Lebat)
    let flash = 0;
    if (currentWeather === 'hujan') {
      if (lightningAge >= 0) {
        lightningAge += dt;
        if (lightningAge < 0.07) {
          flash = 1.0;
        } else if (lightningAge < 0.14) {
          flash = 0.18;
        } else if (lightningAge < 0.22) {
          flash = 0.82;
        } else if (lightningAge < 0.56) {
          flash = Math.max(0, (1 - (lightningAge - 0.22) / 0.34) * 0.65);
        } else {
          lightningAge = -1;
        }
      } else {
        lightningTimer -= dt;
        if (lightningTimer <= 0) {
          lightningAge = 0;
          lightningTimer = 8 + Math.random() * 8;
          flash = 1.0;
          if (!waitingToStart) {
            playThunderSound(0.85 + Math.random() * 0.35);
          }
        }
      }
    } else {
      lightningAge = -1;
    }

    const skyFlash = inTunnel ? flash * 0.12 : flash;
    skyDomeMat.uniforms.uLightning.value = skyFlash;
    cloudMat.uniforms.uLightning.value = skyFlash;
    if (mountainMistUniform) {
      const baseMist = currentWeather === 'kabut' ? 1.0 : currentWeather === 'hujan' ? 0.38 : 0.0;
      mountainMistUniform.value = Math.max(0, baseMist - skyFlash * 0.28);
    }
    sun.intensity = activePreset.sunInt + flash * (inTunnel ? 0.2 : 2.6);
    ambient.intensity = activePreset.ambientInt + flash * (inTunnel ? 0.1 : 0.95);

    // 2. 3D Camera-Wrapped Diagonal Rain / Drizzle Streaks
    const rainCount = activePreset.rainCount;
    if (rainCount <= 0 || inTunnel) {
      rainLines.visible = false;
    } else {
      rainLines.visible = true;
      rainGeo.setDrawRange(0, rainCount * 2);
      const camX = camera.position.x;
      const camY = camera.position.y;
      const camZ = camera.position.z;
      const fallVy = activePreset.rainSpeed;
      const slantX = currentWeather === 'hujan' ? -fallVy * 0.14 : -fallVy * 0.06;
      const slantZ = currentWeather === 'hujan' ? -fallVy * 0.05 : -fallVy * 0.03;
      const len = activePreset.rainLen;
      const dxStreak = (slantX / fallVy) * len;
      const dzStreak = (slantZ / fallVy) * len;

      for (let i = 0; i < rainCount; i++) {
        const idx3 = i * 3;
        const seed = rainSeeds[i];
        let ox = rainOffsets[idx3] + slantX * dt * seed;
        let oy = rainOffsets[idx3 + 1] - fallVy * dt * seed;
        let oz = rainOffsets[idx3 + 2] + slantZ * dt * seed;

        // Wrap within box relative to camera
        if (oy < -6) oy += RAIN_BOX_Y;
        else if (oy > RAIN_BOX_Y - 6) oy -= RAIN_BOX_Y;

        let wx = camX + ox;
        let wz = camZ + oz;
        if (ox < -RAIN_HALF_XZ) ox += RAIN_BOX_XZ;
        else if (ox > RAIN_HALF_XZ) ox -= RAIN_BOX_XZ;
        if (oz < -RAIN_HALF_XZ) oz += RAIN_BOX_XZ;
        else if (oz > RAIN_HALF_XZ) oz -= RAIN_BOX_XZ;

        rainOffsets[idx3] = ox;
        rainOffsets[idx3 + 1] = oy;
        rainOffsets[idx3 + 2] = oz;

        wx = camX + ox;
        const wy = camY + oy;
        wz = camZ + oz;

        const base6 = i * 6;
        rainPositions[base6] = wx;
        rainPositions[base6 + 1] = wy;
        rainPositions[base6 + 2] = wz;
        rainPositions[base6 + 3] = wx - dxStreak * seed;
        rainPositions[base6 + 4] = wy + len * seed;
        rainPositions[base6 + 5] = wz - dzStreak * seed;
      }
      rainPosAttr.needsUpdate = true;
    }

    // 3. Instanced Rear-Tire Water Spray Roosters for All Moving Cars
    const sprayRate = activePreset.sprayRate;
    let hasActiveSpray = false;
    if (sprayRate > 0 && !waitingToStart) {
      const interval = currentWeather === 'hujan' ? 0.022 : 0.048;
      sprayAcc += dt;
      while (sprayAcc >= interval) {
        sprayAcc -= interval;
        for (const car of allCars) {
          const cp = car.userData.physics;
          if (!cp || cp.speed < 11.1) continue; // > 40 km/h
          if (cp.u >= tunnel.uStart && cp.u <= tunnel.uEnd) continue;
          const yaw = cp.yaw;
          const fx = -Math.sin(yaw);
          const fz = -Math.cos(yaw);
          const rx = Math.cos(yaw);
          const rz = -Math.sin(yaw);
          const speedScale = Math.min(1, (cp.speed - 10) / 55);

          for (const side of [-1, 1]) {
            const drop = sprayPool[sprayNext];
            sprayNext = (sprayNext + 1) % SPRAY_COUNT;
            // Rear wheel local offset: (±0.88, 0.25, 1.72) -> world: car.pos - fwd*1.72 + right*(side*0.88)
            drop.x = car.position.x - fx * 1.72 + rx * (side * 0.86) + (Math.random() - 0.5) * 0.16;
            drop.y = car.position.y + 0.24 + Math.random() * 0.12;
            drop.z = car.position.z - fz * 1.72 + rz * (side * 0.86) + (Math.random() - 0.5) * 0.16;
            drop.vx = -fx * (2.5 + cp.speed * 0.12) + rx * (side * (0.6 + Math.random() * 1.1));
            drop.vy = (1.6 + speedScale * 2.8) * sprayRate;
            drop.vz = -fz * (2.5 + cp.speed * 0.12) + rz * (side * (0.6 + Math.random() * 1.1));
            drop.age = 0;
            drop.life = currentWeather === 'hujan' ? 0.36 + Math.random() * 0.12 : 0.24 + Math.random() * 0.08;
            drop.baseScale = (0.55 + speedScale * 0.95) * (0.5 + sprayRate * 0.5);
            drop.active = true;
          }
        }
      }
    }

    for (let i = 0; i < SPRAY_COUNT; i++) {
      const d = sprayPool[i];
      if (!d.active) continue;
      d.age += dt;
      if (d.age >= d.life) {
        d.active = false;
        sprayDummy.scale.setScalar(0);
        sprayDummy.updateMatrix();
        sprayMesh.setMatrixAt(i, sprayDummy.matrix);
        continue;
      }
      hasActiveSpray = true;
      const f = d.age / d.life;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.vy -= 4.2 * dt;
      const sc = d.baseScale * (0.5 + f * 1.65) * (1 - f * 0.65);
      sprayDummy.position.set(d.x, d.y, d.z);
      sprayDummy.scale.setScalar(Math.max(0.01, sc));
      sprayDummy.updateMatrix();
      sprayMesh.setMatrixAt(i, sprayDummy.matrix);
    }
    if (hasActiveSpray || sprayRate > 0) {
      sprayMesh.visible = true;
      sprayMesh.instanceMatrix.needsUpdate = true;
    } else {
      sprayMesh.visible = false;
    }

    return flash;
  }

  function updateDamageParticles(dt: number, health: number, speedMs: number) {
    const yaw = playerCar.userData.physics.yaw;
    _pFwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _pRight.set(Math.cos(yaw), 0, -Math.sin(yaw));

    if (health < 70) {
      const severe = health < 35;
      const rate = health <= 0 ? 0.08 : severe ? 0.045 : 0.11;
      smokeAcc += dt;
      while (smokeAcc >= rate) {
        smokeAcc -= rate;
        const s = smokePool[smokeNext];
        smokeNext = (smokeNext + 1) % SMOKE_COUNT;
        _pTmp.set((Math.random() - 0.5) * 0.22, 0.72, 1.72);
        playerCar.localToWorld(_pTmp);
        s.mesh.position.copy(_pTmp);
        s.mesh.scale.setScalar(severe ? 0.85 : 0.65);
        s.mat.color.setHex(severe ? 0x252830 : 0xd5dce4);
        s.maxOp = health <= 0 ? 0.75 : severe ? 0.72 : 0.38;
        s.vel.set(
          (Math.random() - 0.5) * 0.9 - _pFwd.x * Math.min(8, speedMs * 0.18),
          1.4 + Math.random() * 1.1,
          (Math.random() - 0.5) * 0.9 - _pFwd.z * Math.min(8, speedMs * 0.18)
        );
        s.age = 0;
        s.life = severe ? 1.05 : 0.85;
        s.active = true;
        s.mesh.visible = true;
      }

      if (severe && health > 0 && speedMs > 8) {
        sparkAcc += dt;
        while (sparkAcc >= 0.042) {
          sparkAcc -= 0.042;
          const sp = sparkPool[sparkNext];
          sparkNext = (sparkNext + 1) % SPARK_COUNT;
          const side = Math.random() < 0.5 ? -0.45 : 0.45;
          _pTmp.set(side + (Math.random() - 0.5) * 0.25, 0.13, 0.65 + Math.random() * 0.8);
          playerCar.localToWorld(_pTmp);
          sp.mesh.position.copy(_pTmp);
          sp.mesh.rotation.set(0, yaw + (Math.random() - 0.5) * 0.4, 0);
          sp.vel.set(
            -_pFwd.x * (6 + speedMs * 0.35) + _pRight.x * (Math.random() - 0.5) * 4,
            1.2 + Math.random() * 2.2,
            -_pFwd.z * (6 + speedMs * 0.35) + _pRight.z * (Math.random() - 0.5) * 4
          );
          sp.groundY = playerCar.position.y;
          sp.age = 0;
          sp.life = 0.22 + Math.random() * 0.18;
          sp.active = true;
          sp.mesh.visible = true;
        }
      }
    }

    for (const s of smokePool) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const f = s.age / s.life;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(0.65 + f * 2.1);
      s.mat.opacity = s.maxOp * (1 - f) * Math.min(1, f * 6);
    }

    for (const sp of sparkPool) {
      if (!sp.active) continue;
      sp.age += dt;
      if (sp.age >= sp.life) {
        sp.active = false;
        sp.mesh.visible = false;
        continue;
      }
      sp.vel.y -= 12 * dt;
      sp.mesh.position.addScaledVector(sp.vel, dt);
      if (sp.mesh.position.y < sp.groundY + 0.05) {
        sp.mesh.position.y = sp.groundY + 0.05;
        sp.vel.y = Math.abs(sp.vel.y) * 0.45;
      }
    }
  }

  // --- Camera controller (pre-allocated scratch vectors) ---
  const chasePos = new THREE.Vector3().copy(playerCar.position).add(new THREE.Vector3(0, 4, 10));
  const _fwd = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _off = new THREE.Vector3();
  const _shakeVec = new THREE.Vector3();
  const _lookUp = new THREE.Vector3(0, 1.1, 0);
  const TCAM_OFFSET = new THREE.Vector3(0, 1.3, 0.18);
  const COCKPIT_OFFSET = new THREE.Vector3(0, 0.92, -0.14);
  let baseFov = 72;

  function updateCamera(dt: number, state: any, elapsed: number) {
    const P = playerCar.userData.physics;
    _fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    const speedFrac = Math.min(1, state.speedKmh / 330);
    const dmgShake =
      state.health < 70 && state.health > 0 && state.speedKmh > 25
        ? state.health < 35
          ? 0.032
          : 0.014
        : 0;
    const scrapeShake = (state.scrapeIntensity || 0) * 0.048;
    const shake =
      state.hitIntensity * 0.35 + speedFrac * 0.02 + (state.onCurb ? 0.035 : 0) + dmgShake + scrapeShake;
    const sx = Math.sin(elapsed * 47.3) * shake;
    const sy = Math.cos(elapsed * 39.1) * shake * 0.7;

    const mode = CAMERA_MODES[cameraMode];
    if (mode === 'CHASE') {
      _off
        .copy(playerCar.position)
        .addScaledVector(_fwd, -(9.5 + speedFrac * 1.8))
        .add(_shakeVec.set(0, 3.4 + speedFrac * 0.5, 0));
      chasePos.lerp(_off, 1 - Math.exp(-6 * dt));
      camera.position.copy(chasePos).add(_shakeVec.set(sx, sy, 0));
      _look.copy(playerCar.position).addScaledVector(_fwd, 6).add(_lookUp);
      camera.lookAt(_look);
      baseFov = 70 + speedFrac * 10 + (state.drsActive ? 3 : 0);
    } else {
      const off = mode === 'T-CAM' ? TCAM_OFFSET : COCKPIT_OFFSET;
      camera.position.copy(playerCar.localToWorld(_off.copy(off)));
      camera.position.x += sx * 0.4;
      camera.position.y += sy * 0.4;
      camera.quaternion.copy(playerCar.quaternion);
      if (mode === 'T-CAM') camera.rotateX(-0.07);
      baseFov = (mode === 'T-CAM' ? 76 : 82) + speedFrac * 6;
    }
    if (Math.abs(camera.fov - baseFov) > 0.05) {
      camera.fov += (baseFov - camera.fov) * Math.min(1, 5 * dt);
      camera.updateProjectionMatrix();
    }
  }

  // --- Resize & WebGL context loss handlers ---
  const onResize = () => {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  let contextLost = false;
  const onContextLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
  };
  const onContextRestored = () => {
    contextLost = false;
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // --- Main loop (software-WebGL paced with afterDraw, GPU via rAF) ---
  const clock = new THREE.Clock();
  let accumulator = 0;
  let carState: any = {
    speedKmh: 0,
    gear: 1,
    rpm: 4200,
    drsAvailable: false,
    drsActive: false,
    isBraking: false,
    isSliding: false,
    lateralG: 0,
    hitIntensity: 0,
    scrapeIntensity: 0,
    onCurb: false,
    u: 0,
    throttle: 0,
    brake: 0,
    health: 100,
    isDead: false,
    repairFlash: 0,
  };
  let raceState: any = null;
  let disposed = false;
  let frameId = 0;
  let prevHealth = 100;
  let prevFinished = false;
  let chequeredCountdown: number | null = null;
  let lastReportedCountdown: number | null = null;
  let forcedFinish = false;
  let forcedFinishState: {
    playerPosition: number;
    gapText: string;
    bestLapTime: number | null;
    totalRaceTime: number;
    standings: any[];
  } | null = null;
  let wallHitAudioCooldown = 0;
  let aiHitAudioCooldown = 0;
  let whooshTrackers = allCars.slice(1).map(() => ({
    prevAlong: 0,
    initialized: false,
    cooldown: 0,
  }));

  let mpActive = false;
  let mpConfig: MultiplayerStartOptions | null = null;
  let telemetryAcc = 0;
  const _netEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _netGoalPos = new THREE.Vector3();

  function refreshAllCarsAndTrackers() {
    allCars = [
      playerCar,
      ...aiList,
      ...Array.from(remoteHumanCars.values()),
      ...Array.from(remoteAiCars.values()),
    ];
    whooshTrackers = allCars.slice(1).map(() => ({
      prevAlong: 0,
      initialized: false,
      cooldown: 0,
    }));
  }

  function clearAllOpponents() {
    for (const c of aiList) disposeCarObject(c);
    aiList = [];
    for (const c of remoteHumanCars.values()) disposeCarObject(c);
    remoteHumanCars.clear();
    for (const c of remoteAiCars.values()) disposeCarObject(c);
    remoteAiCars.clear();
    refreshAllCarsAndTrackers();
  }

  function ensurePlayerCarAppearance(name: string, liveryHex: string) {
    playerDriverName = name || 'YOU';
    playerLiveryHex = liveryHex || '#e10600';
    const nextNum = colorHexToNum(playerLiveryHex);
    if (playerLiveryNum !== nextNum) {
      playerLiveryNum = nextNum;
      const oldPos = playerCar.position.clone();
      const oldRot = playerCar.rotation.clone();
      const oldSlot = playerCar.userData.gridSlot ?? 0;
      const oldPhys = playerCar.userData.physics;
      disposeCarObject(playerCar);
      playerCar = createF1Car(nextNum, true);
      playerCar.position.copy(oldPos);
      playerCar.rotation.copy(oldRot);
      playerCar.userData.gridSlot = oldSlot;
      if (oldPhys) {
        playerCar.userData.physics = { ...playerCar.userData.physics, ...oldPhys };
      }
      const cockpit = CAMERA_MODES[cameraMode] === 'COCKPIT';
      playerCar.userData.parts.helmet.visible = !cockpit;
      scene.add(playerCar);
    }
    playerCar.userData.driver = playerDriverName;
    playerCar.userData.color = playerLiveryNum;
    if (mpActive) {
      playerCar.userData.team = 'Online Driver';
    } else {
      playerCar.userData.team = trackData?.playerTeam || 'Scuderia Monaco';
    }
    if (playerCar.userData.race?.entry) {
      playerCar.userData.race.entry.name = playerDriverName;
      playerCar.userData.race.entry.color = '#' + new THREE.Color(playerLiveryNum).getHexString();
      playerCar.userData.race.entry.team = playerCar.userData.team;
    }
    refreshAllCarsAndTrackers();
  }

  function createRemoteHumanCar(slot: RaceSlotAssignment): THREE.Group {
    const colorNum = colorHexToNum(slot.liveryColor);
    const car = createF1Car(colorNum, false);
    car.userData.driver = slot.name;
    car.userData.team = 'Online Driver';
    car.userData.color = colorNum;
    car.userData.gridSlot = slot.gridSlot;
    car.userData.isRemoteHuman = true;
    car.add(createDriverNameplate(slot.name, slot.liveryColor));
    scene.add(car);
    placeCarOnGrid(car, trackData, slot.gridSlot);
    car.userData.netState = {
      targetPos: car.position.clone(),
      targetQuat: car.quaternion.clone(),
      targetYaw: car.userData.physics.yaw,
      targetSpeed: 0,
      targetSteer: 0,
      targetDrs: false,
      targetU: car.userData.physics.u,
      velX: 0,
      velZ: 0,
      lastPacketAt: performance.now(),
      telemetry: {
        playerId: slot.playerId,
        name: slot.name,
        liveryColor: slot.liveryColor,
        x: car.position.x,
        y: car.position.y,
        z: car.position.z,
        rotY: car.userData.physics.yaw,
        pitch: 0,
        speed: 0,
        steerVis: 0,
        drs: false,
        u: car.userData.physics.u,
        lap: 1,
        lapsCompleted: 0,
        progress: 0,
        hp: 100,
        bestLapTime: null,
        lastLapTime: null,
        currentLapTime: 0,
        finished: false,
        finishTime: null,
      } satisfies PlayerTelemetryPacket,
    };
    return car;
  }

  function createRemoteAiCar(slot: number, name: string, team: string, hexColor: string): THREE.Group {
    const colorNum = colorHexToNum(hexColor);
    const car = createF1Car(colorNum, false);
    car.userData.driver = name;
    car.userData.team = team;
    car.userData.color = colorNum;
    car.userData.gridSlot = slot;
    car.userData.isRemoteAi = true;
    scene.add(car);
    placeCarOnGrid(car, trackData, slot);
    car.userData.netState = {
      targetPos: car.position.clone(),
      targetQuat: car.quaternion.clone(),
      targetYaw: car.userData.physics.yaw,
      targetSpeed: 0,
      targetSteer: 0,
      targetDrs: false,
      targetU: car.userData.physics.u,
      velX: 0,
      velZ: 0,
      lastPacketAt: performance.now(),
      telemetry: {
        slot,
        name,
        team,
        color: hexColor,
        x: car.position.x,
        y: car.position.y,
        z: car.position.z,
        rotY: car.userData.physics.yaw,
        pitch: 0,
        speed: 0,
        steerVis: 0,
        drs: false,
        u: car.userData.physics.u,
        lap: 1,
        lapsCompleted: 0,
        progress: 0,
        bestLapTime: null,
        lastLapTime: null,
        currentLapTime: 0,
        finished: false,
        finishTime: null,
      } satisfies AiTelemetryCar,
    };
    return car;
  }

  function interpolateRemoteCars(dt: number) {
    const now = performance.now();
    const alpha = 1 - Math.exp(-18 * Math.max(dt, 0.001));
    const stepRemote = (car: THREE.Group) => {
      const net = car.userData.netState;
      const P = car.userData.physics;
      const parts = car.userData.parts;
      if (!net || !P) return;

      const ageSec = Math.min(0.06, Math.max(0, (now - net.lastPacketAt) * 0.001));
      _netGoalPos.set(
        net.targetPos.x + net.velX * ageSec,
        net.targetPos.y,
        net.targetPos.z + net.velZ * ageSec
      );
      car.position.lerp(_netGoalPos, alpha);
      car.quaternion.slerp(net.targetQuat, alpha);

      P.speed += (net.targetSpeed - P.speed) * alpha;
      P.yaw = net.targetYaw;
      P.u = net.targetU;
      P.initialized = true;

      if (parts) {
        const wheelSpin = (P.speed / 0.36) * dt;
        for (const w of parts.wheels) w.rotation.x -= wheelSpin;
        P.steerVis += ((net.targetSteer || 0) - P.steerVis) * alpha;
        for (const fp of parts.frontPivots) fp.rotation.y = P.steerVis;
        parts.drsFlap.rotation.x += ((net.targetDrs ? 0.52 : 0) - parts.drsFlap.rotation.x) * alpha;
        P.blinkT = (P.blinkT || 0) + dt;
        const blinkOn = Math.sin(P.blinkT * 38) > 0;
        parts.rearLight.material.emissiveIntensity =
          P.speed < 2 || currentWeather === 'hujan' ? (blinkOn ? 3.5 : 0.6) : 0.4;
      }
    };

    for (const car of remoteHumanCars.values()) stepRemote(car);
    for (const car of remoteAiCars.values()) stepRemote(car);
  }

  function mergeMultiplayerStandings(localRs: any) {
    if (!mpActive || !mpConfig || !localRs) return localRs;
    const closedLoop = trackData?.closedLoop !== false;
    const totalLength = trackData?.trackCurve?.userData?.length || 2700;
    const startU = trackData?.startFinishLine?.u || 0;
    const finishU = trackData?.finishLineU ?? startU;
    const meterScale = closedLoop ? totalLength : Math.max(100, (finishU - startU) * totalLength);

    const localEntry = Array.isArray(localRs.standings)
      ? localRs.standings.find((e: any) => e.isPlayer)
      : null;

    const merged: any[] = [];
    if (localEntry) {
      merged.push({
        ...localEntry,
        name: playerDriverName,
        team: 'Online Driver',
        color: playerLiveryHex,
      });
    }

    for (const rCar of remoteHumanCars.values()) {
      const t = rCar.userData?.netState?.telemetry as PlayerTelemetryPacket | undefined;
      if (!t) continue;
      merged.push({
        position: 0,
        name: t.name,
        team: 'Online Driver',
        color: t.liveryColor || '#00d2be',
        isPlayer: false,
        gridSlot: rCar.userData.gridSlot ?? 1,
        lap: t.lap || 1,
        lapsCompleted: t.lapsCompleted || 0,
        progress: t.progress ?? 0,
        gap: 0,
        gapText: '',
        bestLapTime: t.bestLapTime ?? null,
        lastLapTime: t.lastLapTime ?? null,
        currentLapTime: t.currentLapTime || 0,
        finished: !!t.finished,
        finishTime: t.finishTime ?? null,
        speedKmh: (t.speed || 0) * 3.6,
        drsActive: !!t.drs,
      });
    }

    if (mpConfig.isHost) {
      if (Array.isArray(localRs.standings)) {
        for (const e of localRs.standings) {
          if (!e.isPlayer) merged.push({ ...e });
        }
      }
    } else {
      for (const aCar of remoteAiCars.values()) {
        const t = aCar.userData?.netState?.telemetry as AiTelemetryCar | undefined;
        if (!t) continue;
        merged.push({
          position: 0,
          name: t.name,
          team: t.team,
          color: t.color,
          isPlayer: false,
          gridSlot: t.slot,
          lap: t.lap || 1,
          lapsCompleted: t.lapsCompleted || 0,
          progress: t.progress ?? 0,
          gap: 0,
          gapText: '',
          bestLapTime: t.bestLapTime ?? null,
          lastLapTime: t.lastLapTime ?? null,
          currentLapTime: t.currentLapTime || 0,
          finished: !!t.finished,
          finishTime: t.finishTime ?? null,
          speedKmh: (t.speed || 0) * 3.6,
          drsActive: !!t.drs,
        });
      }
    }

    merged.sort((a, b) => {
      if (a.finished && b.finished) return (a.finishTime ?? 1e9) - (b.finishTime ?? 1e9);
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress || a.gridSlot - b.gridSlot;
    });

    const leader = merged[0];
    let finishedCount = 0;
    merged.forEach((e, idx) => {
      e.position = idx + 1;
      if (e.finished) finishedCount++;
      if (idx === 0) {
        e.gap = 0;
        e.gapText = 'LEADER';
        return;
      }
      if (e.finished && leader?.finished) {
        e.gap = Math.max(0, (e.finishTime ?? 0) - (leader.finishTime ?? 0));
        e.gapText = `+${e.gap.toFixed(3)}s`;
        return;
      }
      const lapsBehind = closedLoop ? Math.floor((leader?.progress ?? 0) - e.progress + 1e-6) : 0;
      if (lapsBehind >= 1) {
        e.gap = lapsBehind;
        e.gapText = `+${lapsBehind} LAP${lapsBehind > 1 ? 'S' : ''}`;
      } else {
        e.gap = Math.max(0, (((leader?.progress ?? 0) - e.progress) * meterScale) / 45);
        e.gapText = `+${e.gap.toFixed(3)}s`;
      }
    });

    const myStanding = merged.find((e) => e.isPlayer);
    const pos = myStanding?.position || 1;
    localRs.standings = merged;
    localRs.playerPosition = pos;
    localRs.leaderName = leader?.name || localRs.leaderName;
    localRs.finishedCount = finishedCount;
    localRs.totalCars = merged.length;
    localRs.gapToLeader = myStanding?.gap ?? 0;
    localRs.gapAhead = pos > 1 ? Math.max(0, (myStanding?.gap ?? 0) - merged[pos - 2].gap) : 0;
    localRs.gapBehind = pos < merged.length ? Math.max(0, merged[pos].gap - (myStanding?.gap ?? 0)) : 0;
    return localRs;
  }

  function reportCountdown(val: number | null) {
    if (val !== lastReportedCountdown) {
      lastReportedCountdown = val;
      callbacks.onChequeredCountdown?.(val);
    }
  }

  function snapCameraToGrid() {
    const P = playerCar.userData.physics;
    _fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    chasePos
      .copy(playerCar.position)
      .addScaledVector(_fwd, -9.5)
      .add(_shakeVec.set(0, 3.4, 0));
    camera.position.copy(chasePos);
    _look.copy(playerCar.position).addScaledVector(_fwd, 6).add(_lookUp);
    camera.lookAt(_look);
    tunnelMix = 0;
  }

  function fullRestartRace(holdSeconds?: number) {
    stopVictoryMusic();
    chequeredCountdown = null;
    forcedFinish = false;
    forcedFinishState = null;
    accumulator = 0;
    telemetryAcc = 0;
    reportCountdown(null);
    callbacks.onRaceFinish?.(null);
    restartRace([playerCar, ...aiList], trackData, holdSeconds);
    for (const rCar of remoteHumanCars.values()) {
      placeCarOnGrid(rCar, trackData, rCar.userData.gridSlot ?? 1);
      if (rCar.userData.netState) {
        rCar.userData.netState.targetPos.copy(rCar.position);
        rCar.userData.netState.targetQuat.copy(rCar.quaternion);
        rCar.userData.netState.targetSpeed = 0;
        rCar.userData.netState.velX = 0;
        rCar.userData.netState.velZ = 0;
        rCar.userData.netState.telemetry.finished = false;
        rCar.userData.netState.telemetry.finishTime = null;
        rCar.userData.netState.telemetry.progress = 0;
        rCar.userData.netState.telemetry.lap = 1;
      }
    }
    for (const aCar of remoteAiCars.values()) {
      placeCarOnGrid(aCar, trackData, aCar.userData.gridSlot ?? 1);
      if (aCar.userData.netState) {
        aCar.userData.netState.targetPos.copy(aCar.position);
        aCar.userData.netState.targetQuat.copy(aCar.quaternion);
        aCar.userData.netState.targetSpeed = 0;
        aCar.userData.netState.velX = 0;
        aCar.userData.netState.velZ = 0;
        aCar.userData.netState.telemetry.finished = false;
        aCar.userData.netState.telemetry.finishTime = null;
        aCar.userData.netState.telemetry.progress = 0;
        aCar.userData.netState.telemetry.lap = 1;
      }
    }
    resetCarHealth(playerCar);
    resetParticles();
    prevHealth = 100;
    prevFinished = false;
    wallHitAudioCooldown = 0;
    aiHitAudioCooldown = 0;
    for (const wt of whooshTrackers) {
      wt.prevAlong = 0;
      wt.initialized = false;
      wt.cooldown = 0;
    }
    if (Array.isArray(trackData.repairTokens)) {
      for (const tok of trackData.repairTokens) {
        tok.active = true;
        tok.cooldown = 0;
        tok.group.visible = true;
        tok.group.scale.setScalar(1);
      }
    }
    snapCameraToGrid();
  }

  function switchCircuit(circuitId: CircuitId) {
    if (circuitId === currentCircuit && trackData?.circuitId === circuitId) return;
    currentCircuit = circuitId;
    worldAbort?.abort();
    worldAbort = new AbortController();
    disposeWorldGroup();

    trackData = buildTrack(worldGroup, circuitId, { abortSignal: worldAbort.signal });
    trackUserData = trackData.trackCurve.userData as any;
    waterMat = trackUserData.waterMaterial;
    if (waterMat?.uniforms?.uSunDir) {
      waterMat.uniforms.uSunDir.value.copy(sunDir);
    }
    asphaltMaterial = trackUserData.asphaltMaterial as THREE.MeshStandardMaterial | undefined;
    curbMaterial = trackUserData.curbMaterial as THREE.MeshStandardMaterial | undefined;
    tunnel = trackUserData.tunnel;
    envTime = trackUserData.envTime;
    trackPlayerPos = trackUserData.playerPos;
    mountainMistUniform = trackUserData.mountainMistUniform as { value: number } | null | undefined;

    const [cx, cz] = computeTrackCenterXZ(trackData);
    setCloudCenter(cx, cz);
    setHudCircuit(circuitId);
    applyWeatherPreset(currentWeather);
    fullRestartRace();
  }

  const SINGLE_AI_TEAMS = [
    { color: '#00d2be', team: 'Teal Arrow GP', driver: 'L. Moreau' },
    { color: '#ff8000', team: 'Papaya Speed', driver: 'K. Tanaka' },
    { color: '#006f62', team: 'Verde Racing', driver: 'S. Rossi' },
    { color: '#3b82f6', team: 'Azzurra Corse', driver: 'A. Silva' },
    { color: '#facc15', team: 'Giallo Motors', driver: 'M. Weber' },
    { color: '#a855f7', team: 'Viola Grand Prix', driver: 'D. Costa' },
    { color: '#f472b6', team: 'Rose Racing', driver: 'N. Laurent' },
  ];

  callbacks.onReady?.({
    setWeather: (w: WeatherType) => {
      applyWeatherPreset(w);
    },
    setCircuit: (c: CircuitId) => {
      switchCircuit(c);
    },
    setPlayerProfile: (name: string, liveryColor: string) => {
      ensurePlayerCarAppearance(name, liveryColor);
    },
    startRace: (w: WeatherType, c?: CircuitId) => {
      mpActive = false;
      mpConfig = null;
      if (c && c !== currentCircuit) {
        switchCircuit(c);
      }
      clearAllOpponents();
      playerCar.userData.gridSlot = 0;
      ensurePlayerCarAppearance(playerDriverName, playerLiveryHex);
      aiList = initAIRacers(scene, trackData, { count: 7, startSlot: 1 });
      refreshAllCarsAndTrackers();
      applyWeatherPreset(w);
      waitingToStart = false;
      fullRestartRace();
    },
    restartWithWeather: (w: WeatherType, c?: CircuitId) => {
      if (mpActive && mpConfig) {
        if (mpConfig.isHost) mpConfig.onHostRestart?.();
        return;
      }
      if (c && c !== currentCircuit) {
        switchCircuit(c);
      }
      applyWeatherPreset(w);
      waitingToStart = false;
      fullRestartRace();
    },
    startMultiplayerRace: (w: WeatherType, c: CircuitId, mp: MultiplayerStartOptions) => {
      mpActive = true;
      mpConfig = mp;
      if (c && c !== currentCircuit) {
        switchCircuit(c);
      }
      clearAllOpponents();

      const mySlotObj = mp.slots.find((s) => s.playerId === mp.localPlayerId);
      const myGridSlot = mySlotObj?.gridSlot ?? 0;
      playerCar.userData.gridSlot = myGridSlot;
      ensurePlayerCarAppearance(mp.driverName, mp.liveryColor);

      const humanSlots = mp.slots.slice(0, 8);
      for (const s of humanSlots) {
        if (s.playerId === mp.localPlayerId) continue;
        remoteHumanCars.set(s.playerId, createRemoteHumanCar(s));
      }

      const aiCount = Math.max(0, 8 - humanSlots.length);
      const aiStartSlot = humanSlots.length;
      const deterministicHold =
        typeof mp.startAtMs === 'number'
          ? 0.75 + ((mp.startAtMs % 700) / 700) * 0.65
          : 0.95;

      if (mp.isHost) {
        aiList = initAIRacers(scene, trackData, {
          count: aiCount,
          startSlot: aiStartSlot,
          holdSeconds: deterministicHold,
        });
      } else {
        aiList = [];
        for (let i = 0; i < aiCount; i++) {
          const teamInfo = SINGLE_AI_TEAMS[i % SINGLE_AI_TEAMS.length];
          const slot = aiStartSlot + i;
          remoteAiCars.set(slot, createRemoteAiCar(slot, teamInfo.driver, teamInfo.team, teamInfo.color));
        }
      }

      refreshAllCarsAndTrackers();
      applyWeatherPreset(w);
      waitingToStart = false;
      fullRestartRace(deterministicHold);
      setSessionHold(trackData, deterministicHold);
    },
    stopMultiplayerToSinglePreview: () => {
      mpActive = false;
      mpConfig = null;
      waitingToStart = true;
      clearAllOpponents();
      playerCar.userData.gridSlot = 0;
      ensurePlayerCarAppearance(playerDriverName, playerLiveryHex);
      aiList = initAIRacers(scene, trackData, { count: 7, startSlot: 1 });
      refreshAllCarsAndTrackers();
      fullRestartRace();
    },
    receiveRemotePlayerTelemetry: (pkt: PlayerTelemetryPacket) => {
      if (!mpActive || !mpConfig || pkt.playerId === mpConfig.localPlayerId) return;
      let rCar = remoteHumanCars.get(pkt.playerId);
      if (!rCar) {
        rCar = createRemoteHumanCar({
          playerId: pkt.playerId,
          name: pkt.name,
          liveryColor: pkt.liveryColor,
          gridSlot: remoteHumanCars.size + 1,
        });
        remoteHumanCars.set(pkt.playerId, rCar);
        refreshAllCarsAndTrackers();
      }
      const net = rCar.userData.netState;
      if (!net) return;
      const now = performance.now();
      const dtPkt = Math.max(0.02, Math.min(0.25, (now - net.lastPacketAt) * 0.001));
      const dx = pkt.x - net.targetPos.x;
      const dz = pkt.z - net.targetPos.z;
      if (Math.hypot(dx, dz) < 25) {
        net.velX = THREE.MathUtils.clamp(dx / dtPkt, -95, 95);
        net.velZ = THREE.MathUtils.clamp(dz / dtPkt, -95, 95);
      } else {
        // Large jump (reset/respawn): snap cleanly
        net.velX = 0;
        net.velZ = 0;
        rCar.position.set(pkt.x, pkt.y, pkt.z);
      }
      net.targetPos.set(pkt.x, pkt.y, pkt.z);
      _netEuler.set(pkt.pitch || 0, pkt.rotY, 0, 'YXZ');
      net.targetQuat.setFromEuler(_netEuler);
      net.targetYaw = pkt.rotY;
      net.targetSpeed = pkt.speed || 0;
      net.targetSteer = pkt.steerVis || 0;
      net.targetDrs = !!pkt.drs;
      net.targetU = pkt.u ?? 0;
      net.lastPacketAt = now;
      net.telemetry = pkt;
    },
    receiveRemoteAiTelemetry: (pkt: AiTelemetryBatchPacket) => {
      if (!mpActive || !mpConfig || mpConfig.isHost) return;
      syncSessionFromHost(trackData, pkt);
      if (typeof pkt.chequeredCountdown === 'number' && !forcedFinish) {
        chequeredCountdown =
          chequeredCountdown == null ? pkt.chequeredCountdown : Math.min(chequeredCountdown, pkt.chequeredCountdown);
      }
      if (!Array.isArray(pkt.cars)) return;
      const now = performance.now();
      for (const ac of pkt.cars) {
        let aCar = remoteAiCars.get(ac.slot);
        if (!aCar) {
          aCar = createRemoteAiCar(ac.slot, ac.name, ac.team, ac.color);
          remoteAiCars.set(ac.slot, aCar);
          refreshAllCarsAndTrackers();
        }
        const net = aCar.userData.netState;
        if (!net) continue;
        const dtPkt = Math.max(0.02, Math.min(0.25, (now - net.lastPacketAt) * 0.001));
        const dx = ac.x - net.targetPos.x;
        const dz = ac.z - net.targetPos.z;
        if (Math.hypot(dx, dz) < 25) {
          net.velX = THREE.MathUtils.clamp(dx / dtPkt, -95, 95);
          net.velZ = THREE.MathUtils.clamp(dz / dtPkt, -95, 95);
        } else {
          net.velX = 0;
          net.velZ = 0;
          aCar.position.set(ac.x, ac.y, ac.z);
        }
        net.targetPos.set(ac.x, ac.y, ac.z);
        _netEuler.set(ac.pitch || 0, ac.rotY, 0, 'YXZ');
        net.targetQuat.setFromEuler(_netEuler);
        net.targetYaw = ac.rotY;
        net.targetSpeed = ac.speed || 0;
        net.targetSteer = ac.steerVis || 0;
        net.targetDrs = !!ac.drs;
        net.targetU = ac.u ?? 0;
        net.lastPacketAt = now;
        net.telemetry = ac;
      }
    },
    removeRemotePlayer: (playerId: string) => {
      const rCar = remoteHumanCars.get(playerId);
      if (!rCar) return;
      remoteHumanCars.delete(playerId);
      disposeCarObject(rCar);
      refreshAllCarsAndTrackers();
    },
  });

  function afterDraw(cb: () => void) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    if (sync) gl.flush();
    const poll = () => {
      if (disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        frameId = window.setTimeout(cb, 80);
      }
    };
    frameId = window.setTimeout(poll, 5);
  }

  function tick() {
    if (disposed) return;
    if (contextLost) {
      frameId = requestAnimationFrame(tick);
      return;
    }

    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;

    buildControls(dt);

    const playerP = playerCar.userData.physics;
    if (!waitingToStart && controls.reset && (raceState?.isFinished || forcedFinish || playerP.health <= 0)) {
      if (mpActive && mpConfig) {
        if (mpConfig.isHost) {
          mpConfig.onHostRestart?.();
        }
      } else {
        fullRestartRace();
      }
      controls.reset = false;
    }

    const FROZEN_CONTROLS = { throttle: 0, brake: 1, steer: 0, drs: false, reset: false };
    const playerControls =
      waitingToStart || raceState?.phase === 'LIGHTS' || playerP.health <= 0 || forcedFinish
        ? FROZEN_CONTROLS
        : controls;

    if (waitingToStart) {
      carState = updateCarPhysics(playerCar, FROZEN_CONTROLS, trackData, 0);
      raceState = updateAIRacers(aiList, [playerCar, ...aiList], trackData, 0, true);
      accumulator = 0;
    } else {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= STEP && steps < MAX_SUBSTEPS) {
        wallHitAudioCooldown = Math.max(0, wallHitAudioCooldown - STEP);
        aiHitAudioCooldown = Math.max(0, aiHitAudioCooldown - STEP);
        contactSparkCooldown = Math.max(0, contactSparkCooldown - STEP);

        const stepControls =
          raceState?.phase === 'LIGHTS' || playerP.health <= 0 || forcedFinish
            ? FROZEN_CONTROLS
            : controls;

        const hitBeforeWall = playerP.hit;
        const speedBeforeWall = playerP.speed;
        carState = updateCarPhysics(playerCar, stepControls, trackData, STEP);
        if (playerP.hit > hitBeforeWall + 0.04 && wallHitAudioCooldown <= 0) {
          const wallIntensity = Math.min(1, Math.max(0.2, Math.max(playerP.hit, speedBeforeWall / 75)));
          playCollisionSound(wallIntensity, true);
          wallHitAudioCooldown = 0.24;
        }

        const simCars = [playerCar, ...aiList];
        raceState = updateAIRacers(aiList, simCars, trackData, STEP, false);

        // In multiplayer, also resolve solid OBB contact between local car(s) and remote human/AI cars
        let extraCollisions: any[] = [];
        if (mpActive && (remoteHumanCars.size > 0 || remoteAiCars.size > 0)) {
          const remoteCars = [...remoteHumanCars.values(), ...remoteAiCars.values()];
          const colliderSet = [playerCar, ...aiList, ...remoteCars];
          extraCollisions = resolveCarCollisions(colliderSet, trackData, STEP);
        }

        if (mpActive) {
          mergeMultiplayerStandings(raceState);
        }

        // Post-leader Chequered Flag 15s finish countdown / all-opponents-finished check
        const totalOpponents = Math.max(1, (raceState?.totalCars || 8) - 1);
        if (raceState && !raceState.isFinished && !forcedFinish && playerP.health > 0 && raceState.phase === 'RACING') {
          if (raceState.finishedCount >= 1) {
            if (chequeredCountdown === null) {
              chequeredCountdown = 15.0;
            } else {
              chequeredCountdown = Math.max(0, chequeredCountdown - STEP);
            }
            if (chequeredCountdown <= 0 || raceState.finishedCount >= totalOpponents) {
              forcedFinish = true;
              chequeredCountdown = null;
              const standingsCopy = Array.isArray(raceState.standings)
                ? raceState.standings.map((e: any) =>
                    e.isPlayer ? { ...e, finished: true } : { ...e }
                  )
                : [];
              const pEntry = standingsCopy.find((e: any) => e.isPlayer);
              const pos = raceState.playerPosition || pEntry?.position || standingsCopy.length || 8;
              const gapText = pEntry?.gapText || (trackData?.closedLoop === false ? '+0.000s' : '+1 LAP');
              forcedFinishState = {
                playerPosition: pos,
                gapText,
                bestLapTime: raceState.bestLapTime ?? pEntry?.bestLapTime ?? null,
                totalRaceTime: raceState.raceTime ?? 0,
                standings: standingsCopy,
              };
            }
          }
        } else if (raceState?.isFinished || playerP.health <= 0) {
          chequeredCountdown = null;
        }

        // Process solid OBB car-to-car collision events (audio, damage, micro-shake, sparks)
        const allCollisions = [
          ...(Array.isArray(raceState?.collisionEvents) ? raceState.collisionEvents : []),
          ...extraCollisions,
        ];
        if (!forcedFinish && raceState?.phase === 'RACING' && allCollisions.length > 0) {
          for (const ev of allCollisions) {
            if (ev.isPlayerInvolved && playerP.health > 0) {
              if (aiHitAudioCooldown <= 0 && ev.closingSpeed > 2.6) {
                const carIntensity = Math.min(1, Math.max(0.22, ev.closingSpeed / 36));
                playCollisionSound(carIntensity, false);
                aiHitAudioCooldown = 0.24;
              }
              if (ev.closingSpeed > 4.0) {
                playerP.hit = Math.max(playerP.hit, Math.min(0.85, ev.closingSpeed / 34));
              }
              const impactSpeed = Math.max(ev.closingSpeed + 3, ev.closingSpeed * 1.15);
              if (impactSpeed > 15 && playerP.damageCooldown <= 0) {
                applyCarDamage(playerCar, impactSpeed);
              }
            }

            if (ev.closingSpeed > 4.5) {
              spawnContactSparks(
                ev.contactX,
                ev.contactY,
                ev.contactZ,
                ev.tangentX,
                ev.tangentZ,
                Math.max(ev.closingSpeed, ev.tangentSpeed, 10),
                ev.isPlayerInvolved ? 7 : 4
              );
            } else if (ev.isScrape && contactSparkCooldown <= 0) {
              spawnContactSparks(
                ev.contactX,
                ev.contactY,
                ev.contactZ,
                ev.tangentX,
                ev.tangentZ,
                Math.max(ev.tangentSpeed, 9),
                ev.isPlayerInvolved ? 3 : 2
              );
              contactSparkCooldown = 0.032;
            }
          }
        }

        accumulator -= STEP;
        steps++;
      }
      if (steps === MAX_SUBSTEPS) accumulator = 0;

      // Smooth 60 FPS interpolation for all remote human & Host AI cars
      if (mpActive) {
        interpolateRemoteCars(dt);
        if (raceState) mergeMultiplayerStandings(raceState);
      }

      // 20Hz (50ms) Realtime Broadcast Telemetry
      if (mpActive && mpConfig) {
        telemetryAcc += dt;
        if (telemetryAcc >= 0.05) {
          telemetryAcc %= 0.05;
          const pRace = playerCar.userData.race;
          const pEntry = pRace?.entry;
          mpConfig.onSendPlayerTelemetry?.({
            playerId: mpConfig.localPlayerId,
            name: playerDriverName,
            liveryColor: playerLiveryHex,
            x: Number(playerCar.position.x.toFixed(3)),
            y: Number(playerCar.position.y.toFixed(3)),
            z: Number(playerCar.position.z.toFixed(3)),
            rotY: Number(playerP.yaw.toFixed(4)),
            pitch: Number(playerCar.rotation.x.toFixed(4)),
            speed: Number(playerP.speed.toFixed(2)),
            steerVis: Number((playerP.steerVis || 0).toFixed(3)),
            drs: !!carState?.drsActive,
            u: Number((playerP.u || 0).toFixed(5)),
            lap: pEntry?.lap || 1,
            lapsCompleted: pEntry?.lapsCompleted || 0,
            progress: Number((pEntry?.progress ?? 0).toFixed(5)),
            hp: Math.round(playerP.health ?? 100),
            bestLapTime: pEntry?.bestLapTime ?? null,
            lastLapTime: pEntry?.lastLapTime ?? null,
            currentLapTime: pEntry?.currentLapTime ?? 0,
            finished: !!(pEntry?.finished || forcedFinish),
            finishTime: pEntry?.finishTime ?? (forcedFinish ? forcedFinishState?.totalRaceTime ?? null : null),
            checkpointName: raceState?.checkpointName,
          });

          if (mpConfig.isHost) {
            const aiCarsPayload: AiTelemetryCar[] = aiList.map((ac) => {
              const ap = ac.userData.physics;
              const ar = ac.userData.race;
              const ae = ar?.entry;
              return {
                slot: ac.userData.gridSlot ?? 1,
                name: ae?.name || ac.userData.driver || 'AI',
                team: ae?.team || ac.userData.team || 'AI GP',
                color: ae?.color || '#00d2be',
                x: Number(ac.position.x.toFixed(3)),
                y: Number(ac.position.y.toFixed(3)),
                z: Number(ac.position.z.toFixed(3)),
                rotY: Number(ap.yaw.toFixed(4)),
                pitch: Number(ac.rotation.x.toFixed(4)),
                speed: Number(ap.speed.toFixed(2)),
                steerVis: Number((ap.steerVis || 0).toFixed(3)),
                drs: !!ae?.drsActive,
                u: Number((ap.u || 0).toFixed(5)),
                lap: ae?.lap || 1,
                lapsCompleted: ae?.lapsCompleted || 0,
                progress: Number((ae?.progress ?? 0).toFixed(5)),
                bestLapTime: ae?.bestLapTime ?? null,
                lastLapTime: ae?.lastLapTime ?? null,
                currentLapTime: ae?.currentLapTime ?? 0,
                finished: !!ae?.finished,
                finishTime: ae?.finishTime ?? null,
              };
            });
            mpConfig.onSendAiTelemetry?.({
              hostId: mpConfig.localPlayerId,
              phase: raceState?.phase || 'LIGHTS',
              startLights: raceState?.startLights || 0,
              raceTime: Number((raceState?.raceTime || 0).toFixed(3)),
              chequeredCountdown: chequeredCountdown != null ? Number(chequeredCountdown.toFixed(2)) : null,
              cars: aiCarsPayload,
            });
          }
        }
      }
    }

    // Opponent proximity & overtake Doppler whoosh detection across all cars (AI + remote humans)
    const opponents = allCars.slice(1);
    if (!forcedFinish && raceState?.phase === 'RACING' && playerP.health > 0) {
      const pfX = -Math.sin(playerP.yaw);
      const pfZ = -Math.cos(playerP.yaw);
      const prX = Math.cos(playerP.yaw);
      const prZ = -Math.sin(playerP.yaw);
      for (let i = 0; i < opponents.length; i++) {
        const opp = opponents[i];
        const wt = whooshTrackers[i];
        if (!wt) continue;
        wt.cooldown = Math.max(0, wt.cooldown - dt);
        const dx = opp.position.x - playerCar.position.x;
        const dz = opp.position.z - playerCar.position.z;
        const along = dx * pfX + dz * pfZ;
        const across = dx * prX + dz * prZ;
        if (!wt.initialized) {
          wt.prevAlong = along;
          wt.initialized = true;
          continue;
        }
        const dy = Math.abs(opp.position.y - playerCar.position.y);
        const dist = Math.hypot(dx, dz);
        if (dy < 3.0 && dist < 8.4 && wt.cooldown <= 0) {
          const crossedPlane = wt.prevAlong * along <= 0;
          if (crossedPlane || Math.abs(along) < 2.2) {
            const oppP = opp.userData.physics;
            const afX = -Math.sin(oppP.yaw);
            const afZ = -Math.cos(oppP.yaw);
            const relVx = oppP.speed * afX - playerP.speed * pfX;
            const relVz = oppP.speed * afZ - playerP.speed * pfZ;
            const relSpeed = Math.hypot(relVx, relVz);
            if (relSpeed > 4.2) {
              const pan = Math.max(-0.95, Math.min(0.95, across / 4.2));
              playWhooshSound(relSpeed, pan);
              wt.cooldown = 1.9;
            }
          }
        }
        wt.prevAlong = along;
      }
    }

    // Update & check trackside Repair Coins (12s respawn cooldown)
    if (Array.isArray(trackData.repairTokens)) {
      for (const tok of trackData.repairTokens) {
        if (!tok.active) {
          tok.cooldown -= dt;
          if (tok.cooldown <= 0) {
            tok.active = true;
            tok.cooldown = 0;
            tok.group.visible = true;
            tok.group.scale.setScalar(0.05);
          }
        } else {
          tok.core.rotation.y += dt * 2.4;
          tok.core.position.y = 0.82 + Math.sin(elapsed * 3.4 + tok.phase) * 0.14;
          if (tok.group.scale.x < 0.999) {
            tok.group.scale.setScalar(Math.min(1, tok.group.scale.x + dt * 5));
          }
          if (!forcedFinish && playerP.health > 0 && raceState?.phase === 'RACING') {
            const dx = playerCar.position.x - tok.basePos.x;
            const dz = playerCar.position.z - tok.basePos.z;
            if (dx * dx + dz * dz < 6.76) {
              applyCarRepair(playerCar, 20);
              notifyRepairPickup(playerP.health);
              tok.active = false;
              tok.cooldown = 12.0;
              tok.group.visible = false;
            }
          }
        }
      }
    }

    // Sync latest health/repair/scrape/speed state into carState for HUD/Audio/Camera
    carState.speedKmh = playerP.speed * 3.6;
    carState.health = playerP.health;
    carState.isDead = playerP.health <= 0;
    carState.hitIntensity = playerP.hit;
    carState.scrapeIntensity = playerP.scrapeLevel || 0;
    carState.repairFlash = playerP.repairFlash;
    updateDamageParticles(dt, playerP.health, playerP.speed);

    // Follow player car with sun shadow frustum
    sun.position.copy(playerCar.position).addScaledVector(sunDir, 380);
    sun.target.position.copy(playerCar.position);
    sun.target.updateMatrixWorld();

    // Tunnel atmosphere + dynamic weather crossfade + 3D rain / spray / lightning
    const inTunnel = !!(tunnel && tunnel.uStart >= 0 && carState.u >= tunnel.uStart && carState.u <= tunnel.uEnd);
    const lightningFlash = updateWeatherEffects(dt, inTunnel);
    const k = Math.min(1, 3.6 * dt);
    tunnelMix += ((inTunnel ? 1 : 0) - tunnelMix) * k;

    SKY_TARGET.setHex(activePreset.fogColor);
    if (lightningFlash > 0.01 && !inTunnel) {
      SKY_TARGET.lerp(LIGHTNING_COL, Math.min(0.65, lightningFlash * 0.55));
    }

    if (scene.background instanceof THREE.Color) {
      scene.background.lerpColors(SKY_TARGET, TUNNEL_FOG, tunnelMix);
    }
    if (scene.fog instanceof THREE.Fog) {
      const { near: activeFogNear, far: activeFogFar } = getFogRange();
      scene.fog.color.lerpColors(SKY_TARGET, TUNNEL_FOG, tunnelMix);
      scene.fog.near = activeFogNear + (18 - activeFogNear) * tunnelMix;
      scene.fog.far = activeFogFar + (120 - activeFogFar) * tunnelMix;
    } else if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.lerpColors(SKY_TARGET, TUNNEL_FOG, tunnelMix);
      const tunnelExp = 0.013;
      scene.fog.density = activePreset.fogDensity + (tunnelExp - activePreset.fogDensity) * tunnelMix;
    }

    const targetExposure = inTunnel ? 0.80 : activePreset.exposure + lightningFlash * 0.14;
    renderer.toneMappingExposure += (targetExposure - renderer.toneMappingExposure) * k;
    if (bloom) {
      const targetBloom = inTunnel ? 0.50 : activePreset.bloomStrength + lightningFlash * 0.16;
      bloom.strength += (targetBloom - bloom.strength) * k;
    }
    const targetCloudOp = inTunnel ? 0.08 : activePreset.cloudOpacity;
    cloudMat.uniforms.uOpacity.value += (targetCloudOp - cloudMat.uniforms.uOpacity.value) * k;
    skyDomeMat.uniforms.uSkyFade.value = 1 - tunnelMix;
    skyDomeMat.uniforms.uTime.value = elapsed;

    const cc = getCenterOrFallback();
    for (const c of clouds) {
      c.mesh.position.x += c.speed * dt;
      if (c.mesh.position.x > cc.x + 1100) c.mesh.position.x = cc.x - 1100;
      c.mesh.position.z = cc.z + c.dz;
    }

    // Sync 3D gantry start lights
    if (raceState && Array.isArray(trackData.startFinishLine?.lights)) {
      trackData.startFinishLine.lights.forEach((lm: any, i: number) => {
        if (lm?.material && 'emissiveIntensity' in lm.material) {
          lm.material.emissiveIntensity = i < raceState.startLights ? 3.5 : 0.1;
        }
      });
    }

    if (waterMat?.uniforms?.uTime) {
      waterMat.uniforms.uTime.value = elapsed;
    }
    if (envTime) envTime.value = elapsed;
    if (trackPlayerPos) trackPlayerPos.value.copy(playerCar.position);
    updateCamera(dt, carState, elapsed);
    skyDome.position.copy(camera.position);

    const audioCarState = {
      ...carState,
      throttle: carState.throttle ?? playerControls.throttle,
      brake: carState.brake ?? playerControls.brake,
      rainIntensity: activePreset.rainIntensity,
      inTunnel,
    };
    updateAudio(audioCarState);

    if (prevHealth > 0 && playerP.health <= 0 && !prevFinished) {
      reportCountdown(null);
      playGameOverSound();
    }
    prevHealth = playerP.health;

    if (forcedFinish && forcedFinishState && raceState) {
      raceState.isFinished = true;
      raceState.phase = 'FINISHED';
      raceState.playerPosition = forcedFinishState.playerPosition;
      raceState.standings = forcedFinishState.standings;
      reportCountdown(null);
    } else if (chequeredCountdown !== null && raceState && !raceState.isFinished && playerP.health > 0) {
      raceState.phase = 'FINISHED';
      reportCountdown(Math.max(1, Math.ceil(chequeredCountdown)));
    } else {
      reportCountdown(null);
    }

    const isFinishedNow = !!(raceState && raceState.isFinished);
    if (!prevFinished && isFinishedNow && playerP.health > 0) {
      const playerPos = raceState.playerPosition || 1;
      playFinishSound(playerPos);
      const playerEntry = Array.isArray(raceState.standings)
        ? raceState.standings.find((e: any) => e.isPlayer)
        : null;
      callbacks.onRaceFinish?.({
        playerPosition: playerPos,
        bestLapTime: forcedFinishState
          ? forcedFinishState.bestLapTime
          : raceState.bestLapTime ?? playerEntry?.bestLapTime ?? null,
        totalRaceTime: forcedFinishState
          ? forcedFinishState.totalRaceTime
          : playerEntry?.finishTime ?? raceState.raceTime ?? 0,
        gapText: forcedFinishState ? forcedFinishState.gapText : playerEntry?.gapText,
        isForcedFinish: forcedFinish,
      });
    } else if (prevFinished && !isFinishedNow) {
      callbacks.onRaceFinish?.(null);
    }
    prevFinished = isFinishedNow;

    updateHUD(raceState);

    if (isSoftwareGl || !composer) {
      renderer.render(scene, camera);
      afterDraw(tick);
    } else {
      composer.render();
      frameId = requestAnimationFrame(tick);
    }
  }

  frameId = requestAnimationFrame(tick);

  function getCenterOrFallback() {
    return getCloudCenter();
  }

  return function cleanup() {
    disposed = true;
    mpActive = false;
    mpConfig = null;
    worldAbort?.abort();
    stopVictoryMusic();
    cancelAnimationFrame(frameId);
    clearTimeout(frameId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', onResize);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);

    scene.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) m.map.dispose();
          if (m.bumpMap) m.bumpMap.dispose();
          if (m.roughnessMap) m.roughnessMap.dispose();
          if (m.normalMap) m.normalMap.dispose();
          if (m.emissiveMap) m.emissiveMap.dispose();
          m.dispose();
        }
      }
    });
    envRT?.dispose();
    composer?.dispose();
    renderer.dispose();
  };
}
