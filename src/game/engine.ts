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
import { createF1Car, updateCarPhysics } from './carPhysics.js';
import { initAIRacers, updateAIRacers, placeCarOnGrid, restartRace } from './aiRacer.js';
import { initAudio, updateAudio, updateHUD } from './audioHud.js';

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

  const baseSphere = new THREE.IcosahedronGeometry(1, 2);
  const posAttr = baseSphere.getAttribute('position');
  const normAttr = baseSphere.getAttribute('normal');
  const idxAttr = baseSphere.getIndex();

  for (const puff of puffs) {
    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i);
      const ly = posAttr.getY(i);
      const lz = posAttr.getZ(i);
      // Flatten underside slightly for realistic cumulus cloud base
      const flatY = ly < 0 ? ly * 0.62 : ly;
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

function createMediterraneanClouds(scene: THREE.Scene, sunDir: THREE.Vector3) {
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() },
      uOpacity: { value: 0.92 },
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
        float softEdge = smoothstep(0.05, 0.56, ndv);

        // Wrapped volumetric solar illumination + warm top dome + cool underside shadow
        float wrapSun = clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
        float topDome = smoothstep(0.05, 0.88, vHeight);
        float silverLining = pow(max(dot(-V, uSunDir), 0.0), 6.0) * (1.0 - ndv) * 0.42;

        vec3 shadowCol = vec3(0.69, 0.78, 0.88);
        vec3 midCol = vec3(0.92, 0.95, 0.99);
        vec3 sunCol = vec3(1.0, 0.985, 0.945);

        vec3 col = mix(shadowCol, midCol, smoothstep(0.0, 0.6, topDome * 0.65 + wrapSun * 0.35));
        col = mix(col, sunCol, pow(wrapSun * 0.55 + topDome * 0.45, 1.35));
        col += vec3(1.0, 0.97, 0.90) * silverLining;

        gl_FragColor = vec4(col, softEdge * uOpacity);
      }
    `,
  });

  const prototypes = [
    buildCloudClusterGeometry([
      { x: 0, y: 2, z: 0, rx: 22, ry: 12, rz: 15 },
      { x: -16, y: 0, z: 3, rx: 15, ry: 9.5, rz: 12 },
      { x: 17, y: 0.5, z: -2, rx: 16, ry: 10, rz: 13 },
      { x: -6, y: 8, z: -2, rx: 13, ry: 9, rz: 11 },
      { x: 9, y: 9.5, z: 2, rx: 12, ry: 8.5, rz: 10 },
      { x: -27, y: -2, z: -1, rx: 10, ry: 6.5, rz: 9 },
      { x: 28, y: -1.5, z: 2, rx: 11, ry: 7, rz: 9 },
    ]),
    buildCloudClusterGeometry([
      { x: 0, y: 3, z: 0, rx: 25, ry: 13, rz: 16 },
      { x: -19, y: 1, z: -3, rx: 16, ry: 10, rz: 12 },
      { x: 18, y: -0.5, z: 4, rx: 17, ry: 9.5, rz: 13 },
      { x: 2, y: 11, z: 1, rx: 14, ry: 9.5, rz: 12 },
      { x: -11, y: 8, z: 3, rx: 11, ry: 8, rz: 10 },
      { x: 14, y: 7, z: -3, rx: 12, ry: 8, rz: 10 },
      { x: -30, y: -2, z: 1, rx: 11, ry: 6.5, rz: 8.5 },
    ]),
    buildCloudClusterGeometry([
      { x: 0, y: 1.5, z: 0, rx: 19, ry: 11, rz: 14 },
      { x: -14, y: 0, z: 2, rx: 13, ry: 8.5, rz: 11 },
      { x: 14, y: 0.5, z: -2, rx: 14, ry: 9, rz: 11 },
      { x: 4, y: 8.5, z: 1, rx: 11, ry: 8, rz: 9.5 },
      { x: -7, y: 6.5, z: -2, rx: 10, ry: 7.2, rz: 9 },
    ]),
  ];

  const clouds: Array<{ mesh: THREE.Mesh; speed: number; baseZ: number }> = [];
  const centerX = 340;
  const centerZ = -140;
  for (let i = 0; i < 20; i++) {
    const ang = (i / 20) * Math.PI * 2 + (i % 3) * 0.14;
    const rad = 460 + (i % 4) * 145;
    const mesh = new THREE.Mesh(prototypes[i % prototypes.length], cloudMat);
    const sc = 1.15 + (i % 5) * 0.24;
    mesh.scale.set(sc, sc * 0.92, sc);
    const cx = centerX + Math.cos(ang) * rad;
    const cz = centerZ + Math.sin(ang) * rad;
    mesh.position.set(cx, 130 + (i % 4) * 24, cz);
    mesh.rotation.y = (i * 0.9) % (Math.PI * 2);
    mesh.renderOrder = -1;
    scene.add(mesh);
    clouds.push({ mesh, speed: 1.6 + (i % 4) * 0.55, baseZ: cz });
  }

  return { clouds, cloudMat };
}

export interface EngineCallbacks {
  onWebGLError?: (msg: string) => void;
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
  const DAY_SKY = new THREE.Color(0x87ceeb);
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

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x2b3329, 0.25);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4dc, 1.2);
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

  // --- World + Mediterranean Clouds + Player + AI Racers ---
  const { clouds, cloudMat } = createMediterraneanClouds(scene, sunDir);
  const trackData = buildMonacoTrack(scene);
  const playerCar = createF1Car(0xe10600, true);
  scene.add(playerCar);
  updateCarPhysics(playerCar, { reset: true }, trackData, 0);
  placeCarOnGrid(playerCar, trackData, 0);

  const aiList = initAIRacers(scene, trackData);
  const allCars = [playerCar, ...aiList];

  const waterMat = trackData.trackCurve.userData.waterMaterial;
  waterMat.uniforms.uSunDir.value.copy(sunDir);
  const tunnel = trackData.trackCurve.userData.tunnel;

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
    const shake =
      state.hitIntensity * 0.35 + speedFrac * 0.02 + (state.onCurb ? 0.035 : 0);
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
    onCurb: false,
    u: 0,
    throttle: 0,
    brake: 0,
  };
  let raceState: any = null;
  let disposed = false;
  let frameId = 0;

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

    if (controls.reset && raceState?.isFinished) {
      restartRace(allCars, trackData);
      controls.reset = false;
    }

    const playerControls =
      raceState?.phase === 'LIGHTS'
        ? { throttle: 0, brake: 1, steer: 0, drs: false, reset: false }
        : controls;

    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < MAX_SUBSTEPS) {
      carState = updateCarPhysics(playerCar, playerControls, trackData, STEP);
      raceState = updateAIRacers(aiList, allCars, trackData, STEP);
      accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) accumulator = 0;

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
    cloudMat.uniforms.uOpacity.value += ((inTunnel ? 0.12 : 0.92) - cloudMat.uniforms.uOpacity.value) * k;

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
    updateCamera(dt, carState, elapsed);

    const audioCarState = {
      ...carState,
      throttle: carState.throttle ?? playerControls.throttle,
      brake: carState.brake ?? playerControls.brake,
    };
    updateAudio(audioCarState);
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
