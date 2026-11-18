// ============================================================================
// carPhysics.js — Monaco GP: Street Circuit Challenge
// Composite multi-part F1 car model (monocoque, sidepods, halo, wings, DRS
// flap, helmet, 4 spinning/steering wheels, rain light, contact shadow) +
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

function makeContactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 128, 12, 64, 128, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

let sharedShadowTex = null;

export function createF1Car(colorHex = 0xe10600, isPlayer = false) {
  const car = new THREE.Group();
  car.userData.isPlayer = !!isPlayer;

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    metalness: 0.45,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x161920,
    roughness: 0.58,
    metalness: 0.25,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x141619,
    roughness: 0.88,
    metalness: 0.05,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xd9dee6,
    roughness: 0.28,
    metalness: 0.82,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xf2efe6,
    roughness: 0.35,
    metalness: 0.1,
  });

  // 1. Floor / Venturi plank
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.08, 4.4), carbonMat);
  floor.position.set(0, 0.14, 0.1);
  floor.castShadow = true;
  car.add(floor);

  // 2. Main monocoque tub & tapered nose cone (-Z is forward)
  const tub = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.48, 2.7), paintMat);
  tub.position.set(0, 0.44, 0.25);
  tub.castShadow = true;
  car.add(tub);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 1.55), paintMat);
  nose.position.set(0, 0.35, -1.78);
  nose.rotation.x = 0.09;
  nose.castShadow = true;
  car.add(nose);

  // 3. Sculpted sidepods & airbox/engine cover
  const sidepodL = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.38, 1.95), paintMat);
  sidepodL.position.set(-0.62, 0.38, 0.45);
  sidepodL.castShadow = true;
  const sidepodR = sidepodL.clone();
  sidepodR.position.x = 0.62;
  car.add(sidepodL, sidepodR);

  const engineCover = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 1.75), paintMat);
  engineCover.position.set(0, 0.68, 0.95);
  engineCover.castShadow = true;
  const sharkFin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 1.15), accentMat);
  sharkFin.position.set(0, 0.98, 1.18);
  car.add(engineCover, sharkFin);

  // 4. Front Wing & Endplates
  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.07, 0.52), carbonMat);
  frontWing.position.set(0, 0.16, -2.42);
  frontWing.castShadow = true;
  const fwTipL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.56), paintMat);
  fwTipL.position.set(-0.98, 0.23, -2.42);
  const fwTipR = fwTipL.clone();
  fwTipR.position.x = 0.98;
  car.add(frontWing, fwTipL, fwTipR);

  // 5. Rear Wing & animated DRS upper flap
  const rwPylon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 0.25), carbonMat);
  rwPylon.position.set(0, 0.68, 2.22);
  const rwMain = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.08, 0.34), carbonMat);
  rwMain.position.set(0, 0.96, 2.24);
  const rwPlateL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.48, 0.46), paintMat);
  rwPlateL.position.set(-0.68, 0.92, 2.24);
  const rwPlateR = rwPlateL.clone();
  rwPlateR.position.x = 0.68;
  const drsFlap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.24), paintMat);
  drsFlap.position.set(0, 1.07, 2.34);
  car.add(rwPylon, rwMain, rwPlateL, rwPlateR, drsFlap);

  // 6. Titanium Halo & Driver Helmet
  const haloRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.036, 8, 18, Math.PI * 1.2),
    carbonMat
  );
  haloRing.rotation.x = Math.PI / 2;
  haloRing.rotation.z = -Math.PI * 0.1;
  haloRing.position.set(0, 0.78, -0.25);
  const haloPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.26, 8), carbonMat);
  haloPillar.position.set(0, 0.68, -0.58);
  haloPillar.rotation.x = -0.35;
  car.add(haloRing, haloPillar);

  const helmet = new THREE.Group();
  const helmDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 14, 12),
    new THREE.MeshPhysicalMaterial({ color: isPlayer ? 0xfacc15 : 0xf2efe6, roughness: 0.15, clearcoat: 1 })
  );
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.09, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 0.1, metalness: 0.9 })
  );
  visor.position.set(0, 0.02, -0.11);
  helmet.add(helmDome, visor);
  helmet.position.set(0, 0.72, -0.05);
  car.add(helmet);

  // 7. Rear ERS / rain taillight
  const rearLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.12, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1e00, emissiveIntensity: 0.4 })
  );
  rearLight.position.set(0, 0.36, 2.35);
  car.add(rearLight);

  // 8. 4 Wheels (front pair inside steering pivots)
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.34, 20);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.36, 14);
  rimGeo.rotateZ(Math.PI / 2);

  const makeWheel = () => {
    const wg = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    wg.add(tire, rim);
    return wg;
  };

  const frontPivots = [];
  const wheels = [];
  const wheelCoords = [
    { x: -0.9, y: 0.36, z: -1.62, front: true },
    { x: 0.9, y: 0.36, z: -1.62, front: true },
    { x: -0.92, y: 0.36, z: 1.56, front: false },
    { x: 0.92, y: 0.36, z: 1.56, front: false },
  ];
  for (const wc of wheelCoords) {
    const w = makeWheel();
    wheels.push(w);
    if (wc.front) {
      const pivot = new THREE.Group();
      pivot.position.set(wc.x, wc.y, wc.z);
      pivot.add(w);
      car.add(pivot);
      frontPivots.push(pivot);
    } else {
      w.position.set(wc.x, wc.y, wc.z);
      car.add(w);
    }
  }

  // 9. Ground contact shadow
  if (!sharedShadowTex) sharedShadowTex = makeContactShadowTexture();
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 5.3),
    new THREE.MeshBasicMaterial({ map: sharedShadowTex, transparent: true, opacity: 0.65, depthWrite: false })
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.03;
  car.add(contactShadow);

  car.userData.parts = { helmet, drsFlap, wheels, frontPivots, rearLight };
  car.userData.physics = {
    speed: 0,
    slip: 0,
    hit: 0,
    steerVis: 0,
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

  // Visual animations (wheels, steer, DRS flap, rear light)
  P.steerVis += (steer * 0.38 - P.steerVis) * Math.min(1, 14 * Math.max(dt, 0.016));
  for (const fp of parts.frontPivots) fp.rotation.y = P.steerVis;
  const wheelSpin = (P.speed / 0.36) * dt;
  for (const w of parts.wheels) w.rotation.x -= wheelSpin;

  parts.drsFlap.rotation.x += ((drsActive ? 0.48 : 0) - parts.drsFlap.rotation.x) * Math.min(1, 18 * Math.max(dt, 0.016));
  parts.rearLight.material.emissiveIntensity = brk > 0.15 ? 3.2 : 0.45;

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
