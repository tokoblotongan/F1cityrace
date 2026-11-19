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

import { buildMonacoTrack } from './track.js';
import {
  createF1Car,
  updateCarPhysics,
  applyCarDamage,
  applyCarRepair,
  resetCarHealth,
} from './carPhysics.js';
import { initAIRacers, updateAIRacers, placeCarOnGrid, restartRace } from './aiRacer.js';
import {
  initAudio,
  updateAudio,
  updateHUD,
  notifyRepairPickup,
  playWhooshSound,
  playCollisionSound,
  playGameOverSound,
  playFinishSound,
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

        // Rich Mediterranean cobalt-azure sky gradient (#1a4b8c zenith -> #4da6ff horizon)
        vec3 horizonCol = vec3(0.302, 0.651, 1.000);
        vec3 midSkyCol  = vec3(0.145, 0.435, 0.785);
        vec3 zenithCol  = vec3(0.102, 0.294, 0.549);
        vec3 seaUnder   = vec3(0.180, 0.440, 0.720);

        vec3 sky = mix(horizonCol, midSkyCol, smoothstep(0.0, 0.30, h));
        sky = mix(sky, zenithCol, smoothstep(0.24, 0.92, h));
        if (dir.y < 0.0) {
          sky = mix(horizonCol, seaUnder, smoothstep(0.0, 0.25, -dir.y));
        }

        // Subtle high-altitude wispy cirrus & distant horizon cumulus strata
        if (dir.y > 0.02) {
          vec2 uvCirrus = dir.xz / (dir.y + 0.16) * 1.45 + vec2(uTime * 0.004, 0.0);
          float wisp = fbm(uvCirrus * 1.8);
          float wispMask = smoothstep(0.54, 0.82, wisp) * smoothstep(0.02, 0.22, dir.y) * smoothstep(0.95, 0.32, dir.y);
          sky = mix(sky, vec3(0.86, 0.93, 1.0), wispMask * 0.28);
        }

        // Solar atmospheric scattering halo + crisp sun disc
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        sky += vec3(1.0, 0.92, 0.72) * pow(sunDot, 7.0) * 0.24;
        sky += vec3(1.0, 0.96, 0.86) * pow(sunDot, 48.0) * 0.45;
        sky += vec3(1.0, 0.99, 0.94) * smoothstep(0.9982, 0.9995, sunDot) * 1.1;

        vec3 tunnelCol = vec3(0.051, 0.059, 0.071);
        gl_FragColor = vec4(mix(tunnelCol, sky, uSkyFade), 1.0);
      }
    `,
  });

  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(2500, 48, 32), skyDomeMat);
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
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying float vHeight;
      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = abs(dot(N, V));
        float softEdge = smoothstep(0.06, 0.54, ndv);

        // High-contrast sunlit silver-gold tops vs. dramatic moody slate-blue/lavender bases
        float sunLit = clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
        float topFactor = smoothstep(0.08, 0.86, vHeight);
        float contrastMix = smoothstep(0.18, 0.84, topFactor * 0.62 + sunLit * 0.38);

        float silverGoldRim = pow(max(dot(-V, uSunDir), 0.0), 5.0) * (1.0 - ndv) * 0.48;

        vec3 baseShadowCol = vec3(0.35, 0.42, 0.60);  // moody slate-blue / lavender base
        vec3 midCloudCol   = vec3(0.76, 0.82, 0.92);
        vec3 sunlitPeakCol = vec3(1.00, 0.965, 0.88); // bright sunlit silver-gold top

        vec3 col = mix(baseShadowCol, midCloudCol, smoothstep(0.0, 0.58, contrastMix));
        col = mix(col, sunlitPeakCol, smoothstep(0.45, 0.96, contrastMix));
        col += vec3(1.0, 0.94, 0.78) * silverGoldRim;

        gl_FragColor = vec4(col, softEdge * uOpacity);
      }
    `,
  });

  const prototypes = [
    // Towering sculpted cumulus formation
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
    // Broad dramatic stratocumulus shelf + rising crown
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
    // Compact high-contrast Mediterranean puff cluster
    buildCloudClusterGeometry([
      { x: 0, y: 1.5, z: 0, rx: 21, ry: 11.5, rz: 15 },
      { x: -15, y: 0, z: 2, rx: 14, ry: 8.8, rz: 11.5 },
      { x: 15, y: 0.5, z: -2, rx: 15, ry: 9.2, rz: 12 },
      { x: 4, y: 10.5, z: 1, rx: 12.5, ry: 9.5, rz: 10.5 },
      { x: -8, y: 8, z: -2, rx: 11, ry: 8, rz: 9.5 },
      { x: 0, y: -1, z: -10, rx: 13, ry: 7, rz: 8.5 },
    ]),
  ];

  const clouds: Array<{ mesh: THREE.Mesh; speed: number; baseZ: number }> = [];
  const centerX = 340;
  const centerZ = -140;
  for (let i = 0; i < 22; i++) {
    const ang = (i / 22) * Math.PI * 2 + (i % 3) * 0.14;
    const rad = 460 + (i % 5) * 140;
    const mesh = new THREE.Mesh(prototypes[i % prototypes.length], cloudMat);
    const sc = 1.2 + (i % 5) * 0.26;
    mesh.scale.set(sc, sc * 0.94, sc);
    const cx = centerX + Math.cos(ang) * rad;
    const cz = centerZ + Math.sin(ang) * rad;
    mesh.position.set(cx, 138 + (i % 4) * 26, cz);
    mesh.rotation.y = (i * 0.9) % (Math.PI * 2);
    mesh.renderOrder = -1;
    scene.add(mesh);
    clouds.push({ mesh, speed: 1.6 + (i % 4) * 0.55, baseZ: cz });
  }

  return { clouds, cloudMat };
}

export interface RaceFinishResult {
  playerPosition: number;
  bestLapTime: number | null;
  totalRaceTime: number;
}

export interface EngineCallbacks {
  onWebGLError?: (msg: string) => void;
  onRaceFinish?: (result: RaceFinishResult | null) => void;
}

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

  // --- Scene & Clear Mediterranean Atmosphere ---
  const scene = new THREE.Scene();
  const DAY_SKY = new THREE.Color(0x4da6ff);
  const TUNNEL_FOG = new THREE.Color(0x0d0f12);
  scene.background = DAY_SKY.clone();
  scene.fog = new THREE.Fog(DAY_SKY.getHex(), 180, 950);

  const camera = new THREE.PerspectiveCamera(
    72,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.1,
    3200
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
  const { clouds, cloudMat } = createMediterraneanClouds(scene, sunDir);
  const trackData = buildMonacoTrack(scene);
  const playerCar = createF1Car(0xe10600, true);
  scene.add(playerCar);
  updateCarPhysics(playerCar, { reset: true }, trackData, 0);
  placeCarOnGrid(playerCar, trackData, 0);

  const aiList = initAIRacers(scene, trackData);
  const allCars = [playerCar, ...aiList];

  const trackUserData = trackData.trackCurve.userData as any;
  const waterMat = trackUserData.waterMaterial;
  waterMat.uniforms.uSunDir.value.copy(sunDir);
  const tunnel = trackUserData.tunnel;
  const envTime = trackUserData.envTime;
  const trackPlayerPos = trackUserData.playerPos;

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
    contactSparkCooldown = 0;
    for (const s of smokePool) {
      s.active = false;
      s.mesh.visible = false;
    }
    for (const sp of sparkPool) {
      sp.active = false;
      sp.mesh.visible = false;
    }
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
  let wallHitAudioCooldown = 0;
  let aiHitAudioCooldown = 0;
  const whooshTrackers = aiList.map(() => ({
    prevAlong: 0,
    initialized: false,
    cooldown: 0,
  }));

  function fullRestartRace() {
    stopVictoryMusic();
    callbacks.onRaceFinish?.(null);
    restartRace(allCars, trackData);
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
  }

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
    if (controls.reset && (raceState?.isFinished || playerP.health <= 0)) {
      fullRestartRace();
      controls.reset = false;
    }

    const playerControls =
      raceState?.phase === 'LIGHTS' || playerP.health <= 0
        ? { throttle: 0, brake: 1, steer: 0, drs: false, reset: false }
        : controls;

    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < MAX_SUBSTEPS) {
      wallHitAudioCooldown = Math.max(0, wallHitAudioCooldown - STEP);
      aiHitAudioCooldown = Math.max(0, aiHitAudioCooldown - STEP);
      contactSparkCooldown = Math.max(0, contactSparkCooldown - STEP);

      const hitBeforeWall = playerP.hit;
      const speedBeforeWall = playerP.speed;
      carState = updateCarPhysics(playerCar, playerControls, trackData, STEP);
      if (playerP.hit > hitBeforeWall + 0.04 && wallHitAudioCooldown <= 0) {
        const wallIntensity = Math.min(1, Math.max(0.2, Math.max(playerP.hit, speedBeforeWall / 75)));
        playCollisionSound(wallIntensity, true);
        wallHitAudioCooldown = 0.24;
      }

      raceState = updateAIRacers(aiList, allCars, trackData, STEP);

      // Process solid OBB car-to-car collision events (audio, damage, micro-shake, sparks)
      if (raceState?.phase === 'RACING' && Array.isArray(raceState.collisionEvents)) {
        for (const ev of raceState.collisionEvents) {
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

    // Opponent proximity & overtake Doppler whoosh detection
    if (raceState?.phase === 'RACING' && playerP.health > 0) {
      const pfX = -Math.sin(playerP.yaw);
      const pfZ = -Math.cos(playerP.yaw);
      const prX = Math.cos(playerP.yaw);
      const prZ = -Math.sin(playerP.yaw);
      for (let i = 0; i < aiList.length; i++) {
        const ai = aiList[i];
        const wt = whooshTrackers[i];
        wt.cooldown = Math.max(0, wt.cooldown - dt);
        const dx = ai.position.x - playerCar.position.x;
        const dz = ai.position.z - playerCar.position.z;
        const along = dx * pfX + dz * pfZ;
        const across = dx * prX + dz * prZ;
        if (!wt.initialized) {
          wt.prevAlong = along;
          wt.initialized = true;
          continue;
        }
        const dy = Math.abs(ai.position.y - playerCar.position.y);
        const dist = Math.hypot(dx, dz);
        if (dy < 3.0 && dist < 8.4 && wt.cooldown <= 0) {
          const crossedPlane = wt.prevAlong * along <= 0;
          if (crossedPlane || Math.abs(along) < 2.2) {
            const aiP = ai.userData.physics;
            const afX = -Math.sin(aiP.yaw);
            const afZ = -Math.cos(aiP.yaw);
            const relVx = aiP.speed * afX - playerP.speed * pfX;
            const relVz = aiP.speed * afZ - playerP.speed * pfZ;
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
          if (playerP.health > 0 && raceState?.phase === 'RACING') {
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

    // Tunnel atmosphere crossfade
    const inTunnel = carState.u >= tunnel.uStart && carState.u <= tunnel.uEnd;
    const k = Math.min(1, 3 * dt);
    if (scene.background instanceof THREE.Color) {
      scene.background.lerp(inTunnel ? TUNNEL_FOG : DAY_SKY, k);
    }
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.lerp(inTunnel ? TUNNEL_FOG : DAY_SKY, k);
      scene.fog.near += ((inTunnel ? 18 : 180) - scene.fog.near) * k;
      scene.fog.far += ((inTunnel ? 120 : 950) - scene.fog.far) * k;
    }
    renderer.toneMappingExposure += ((inTunnel ? 0.8 : 0.92) - renderer.toneMappingExposure) * k;
    if (bloom) bloom.strength += ((inTunnel ? 0.5 : 0.22) - bloom.strength) * k;
    cloudMat.uniforms.uOpacity.value += ((inTunnel ? 0.1 : 0.95) - cloudMat.uniforms.uOpacity.value) * k;
    skyDomeMat.uniforms.uSkyFade.value += ((inTunnel ? 0.0 : 1.0) - skyDomeMat.uniforms.uSkyFade.value) * k;
    skyDomeMat.uniforms.uTime.value = elapsed;

    for (const c of clouds) {
      c.mesh.position.x += c.speed * dt;
      if (c.mesh.position.x > 1450) c.mesh.position.x = -750;
      c.mesh.position.z = c.baseZ;
    }

    // Sync 3D gantry start lights
    if (raceState && Array.isArray(trackData.startFinishLine?.lights)) {
      trackData.startFinishLine.lights.forEach((lm: any, i: number) => {
        if (lm?.material && 'emissiveIntensity' in lm.material) {
          lm.material.emissiveIntensity = i < raceState.startLights ? 3.5 : 0.1;
        }
      });
    }

    waterMat.uniforms.uTime.value = elapsed;
    if (envTime) envTime.value = elapsed;
    if (trackPlayerPos) trackPlayerPos.value.copy(playerCar.position);
    updateCamera(dt, carState, elapsed);
    skyDome.position.copy(camera.position);

    const audioCarState = {
      ...carState,
      throttle: carState.throttle ?? playerControls.throttle,
      brake: carState.brake ?? playerControls.brake,
    };
    updateAudio(audioCarState);

    if (prevHealth > 0 && playerP.health <= 0 && !prevFinished) {
      playGameOverSound();
    }
    prevHealth = playerP.health;

    const isFinishedNow = !!(raceState && raceState.isFinished);
    if (!prevFinished && isFinishedNow && playerP.health > 0) {
      const playerPos = raceState.playerPosition || 1;
      playFinishSound(playerPos);
      const playerEntry = Array.isArray(raceState.standings)
        ? raceState.standings.find((e: any) => e.isPlayer)
        : null;
      callbacks.onRaceFinish?.({
        playerPosition: playerPos,
        bestLapTime: raceState.bestLapTime ?? playerEntry?.bestLapTime ?? null,
        totalRaceTime: playerEntry?.finishTime ?? raceState.raceTime ?? 0,
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

  return function cleanup() {
    disposed = true;
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
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    envRT?.dispose();
    composer?.dispose();
    renderer.dispose();
  };
}
