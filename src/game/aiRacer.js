// ============================================================================
// aiRacer.js — Monaco GP: Street Circuit Challenge
// 7 rival F1 cars: grid spawn, waypoint pure-pursuit navigation, kinematic
// braking plans before hairpins, lateral overtaking / anti-stack avoidance,
// DRS on straights, checkpoint-validated lap counting and live 1st–8th
// ranking for the player AND every AI car.
// ============================================================================

import * as THREE from 'three';
import { createF1Car, updateCarPhysics, resolveCarCollisions } from './carPhysics.js';

const TOP_SPEED = 86;            // must match carPhysics.js (m/s)
const PLAN_BRK = 26;             // conservative planning brake decel (m/s²)
const A0 = 1.7 * 9.81;           // low-speed lateral grip (matches physics)
const A1 = (3.1 * 9.81) / (TOP_SPEED * TOP_SPEED); // downforce grip slope

const TEAMS = [
  { color: 0x00d2be, team: 'Teal Arrow GP',   driver: 'L. Moreau'  },
  { color: 0xff8000, team: 'Papaya Speed',    driver: 'K. Tanaka'  },
  { color: 0x006f62, team: 'Verde Racing',    driver: 'S. Rossi'   },
  { color: 0x3b82f6, team: 'Azzurra Corse',   driver: 'A. Silva'   },
  { color: 0xfacc15, team: 'Giallo Motors',   driver: 'M. Weber'   },
  { color: 0xa855f7, team: 'Viola Grand Prix', driver: 'D. Costa'  },
  { color: 0xf472b6, team: 'Rose Racing',     driver: 'N. Laurent' },
];

const PLAYER_ID = { color: 0xe10600, team: 'Scuderia Monaco', driver: 'YOU' };

// Per-track caches (no global state leaks between restarts / scenes)
const sessions = new WeakMap();
const profiles = new WeakMap();

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function isClosedLoop(trackData) {
  return trackData?.closedLoop !== false && trackData?.trackCurve?.userData?.closedLoop !== false;
}
function getTotalLaps(trackData) {
  return trackData?.totalLaps ?? trackData?.trackCurve?.userData?.totalLaps ?? 3;
}
function getFinishU(trackData) {
  return trackData?.finishLineU ?? trackData?.startFinishLine?.finishU ?? trackData?.startFinishLine?.u ?? 1;
}

// --- race session (start lights → racing → finished) -------------------------
function getSession(trackData) {
  let s = sessions.get(trackData);
  if (!s) { s = {}; sessions.set(trackData, s); resetSession(s); }
  return s;
}
function resetSession(s, customHold) {
  s.phase = 'LIGHTS';            // 'LIGHTS' | 'RACING' | 'FINISHED'
  s.clock = 0;
  s.lightsOn = 0;
  s.hold = typeof customHold === 'number' && Number.isFinite(customHold)
    ? clamp(customHold, 0.4, 2.0)
    : 0.7 + Math.random() * 0.8;   // random lights-out hold (F1 style)
  s.outAt = 6.0 + s.hold;
  s.raceTime = 0;
  s.finishedCount = 0;
}
export function setSessionHold(trackData, holdSeconds) {
  const s = getSession(trackData);
  s.hold = clamp(Number(holdSeconds) || 0.85, 0.4, 2.0);
  s.outAt = 6.0 + s.hold;
}
export function syncSessionFromHost(trackData, hostState) {
  if (!trackData || !hostState) return;
  const s = getSession(trackData);
  if (hostState.phase === 'LIGHTS' && s.phase === 'LIGHTS') {
    s.lightsOn = Math.max(s.lightsOn, Number(hostState.startLights) || 0);
  } else if (hostState.phase === 'RACING' && s.phase === 'LIGHTS') {
    s.phase = 'RACING';
    s.lightsOn = 0;
    s.raceTime = Number(hostState.raceTime) || 0;
  }
}
function advanceSession(s, dt) {
  s.clock += dt;
  if (s.phase === 'LIGHTS') {
    const lt = s.clock - 1.0;
    s.lightsOn = lt < 0 ? 0 : Math.min(5, Math.floor(lt) + 1);
    if (s.clock >= s.outAt) { s.phase = 'RACING'; s.lightsOn = 0; s.raceTime = 0; }
  } else {
    s.raceTime += dt;
  }
}

// --- precomputed corner-speed profile (curvature → grip-limited speed) --------
function getProfile(trackData) {
  let p = profiles.get(trackData);
  if (p) return p;
  const closedLoop = isClosedLoop(trackData);
  const sd = trackData.trackCurve.userData.samples;
  const N = sd.count;
  const uDenom = closedLoop ? N : Math.max(1, N - 1);
  const segLen = trackData.trackCurve.userData.length / uDenom;
  const curv = new Float32Array(N);
  const sign = new Float32Array(N);
  const corner2 = new Float32Array(N);   // squared corner speed limit
  for (let i = 0; i < N; i++) {
    if (!closedLoop && i >= N - 1) {
      curv[i] = 0;
      sign[i] = 0;
      corner2[i] = 92 * 92;
      continue;
    }
    const nextIdx = closedLoop ? (i + 3) % N : Math.min(i + 3, N - 1);
    const stepCount = closedLoop ? 3 : Math.max(1, nextIdx - i);
    const t0 = sd.tan[i], t1 = sd.tan[nextIdx];
    const k = t0.angleTo(t1) / (stepCount * segLen);
    curv[i] = k;
    sign[i] = Math.sign(t0.z * t1.x - t0.x * t1.z); // + = left-hand corner
    // implicit grip solution: v² = (A0 + A1·v²) / κ  →  v² = A0 / (κ − A1)
    const denom = k - A1;
    const v = denom > 1e-5 ? Math.min(92, Math.sqrt(A0 / denom)) : 92;
    corner2[i] = Math.max(10, v) ** 2;
  }
  p = { curv, sign, corner2, N, segLen };
  profiles.set(trackData, p);
  return p;
}

// --- grid placement + race metadata -------------------------------------------
function freshRace(car, u, trackData) {
  const P = car.userData.physics;
  const isPlayer = !!car.userData.isPlayer;
  const driverName = (isPlayer ? (car.userData.driver || PLAYER_ID.driver) : car.userData.driver) || 'YOU';
  const colorVal = car.userData.color ?? (isPlayer ? PLAYER_ID.color : 0x00d2be);
  const teamName = isPlayer
    ? (car.userData.team || trackData?.playerTeam || PLAYER_ID.team)
    : (car.userData.team || PLAYER_ID.team);
  return {
    u, prevU: u, lateral: 0, latTarget: 0,
    lap: 0, nextCp: 0, lapsCompleted: 0, lapStart: 0,
    lastLapTime: null, bestLapTime: null,
    finished: false, finishTime: null,
    lastCheckpoint: null,
    yawRate: 0, prevYaw: P.yaw, throttle: 0, brake: 1, drs: false,
    progress: 0, position: (car.userData.gridSlot ?? 0) + 1,
    gap: 0, gapText: '',
    traffic: { blockDist: Infinity, blocker: null, blockLat: 0, blockSpeed: 0, sidePush: 0 },
    entry: {
      position: 0, name: driverName, team: teamName,
      color: '#' + new THREE.Color(colorVal).getHexString(),
      isPlayer, gridSlot: car.userData.gridSlot ?? 0,
      lap: 1, lapsCompleted: 0, progress: 0, gap: 0, gapText: '',
      bestLapTime: null, lastLapTime: null, currentLapTime: 0,
      finished: false, finishTime: null, speedKmh: 0, drsActive: false,
    },
  };
}

export function placeCarOnGrid(car, trackData, slot) {
  const closedLoop = isClosedLoop(trackData);
  const sd = trackData.trackCurve.userData.samples;
  const uDenom = closedLoop ? sd.count : Math.max(1, sd.count - 1);
  const startU = trackData.startFinishLine.u;
  const poleLeadU = trackData.startFinishLine.poleLeadU ?? 0.004;
  const gridStepU = trackData.startFinishLine.gridStepU ?? 0.0035;
  const u = closedLoop
    ? (startU - poleLeadU - slot * gridStepU + 1) % 1
    : clamp(startU - poleLeadU - slot * gridStepU, 0.001, 0.985);
  const idx = closedLoop
    ? Math.round(u * sd.count) % sd.count
    : clamp(Math.round(u * uDenom), 0, sd.count - 1);
  const p = sd.pos[idx], r = sd.right[idx], t = sd.tan[idx];
  const side = slot % 2 ? 1 : -1;
  car.position.set(p.x + r.x * side * 2.3, p.y, p.z + r.z * side * 2.3);

  const P = car.userData.physics;
  P.speed = 0; P.latVel = 0; P.yawVel = 0; P.knockTimer = 0;
  P.scrapeLevel = 0; P.scrapeTimer = 0;
  P.slip = 0; P.hit = 0; P.steerVis = 0;
  P.u = idx / uDenom; P.lastIdx = idx;
  P.yaw = Math.atan2(-t.x, -t.z);
  P.initialized = true;
  car.rotation.order = 'YXZ';
  car.rotation.set(Math.asin(clamp(t.y, -1, 1)), P.yaw, 0);

  car.userData.gridSlot = slot;
  if (car.userData.isPlayer) {
    car.userData.team = trackData.playerTeam || PLAYER_ID.team;
    if (!car.userData.driver) car.userData.driver = PLAYER_ID.driver;
    if (!car.userData.color) car.userData.color = PLAYER_ID.color;
  }
  car.userData.race = freshRace(car, P.u, trackData);
  car.userData.race.lateral = side * 2.3;
  car.userData.race.latTarget = side * 2.3;
}

function ensureRace(car, trackData) {
  if (!car.userData.race) {
    const P = car.userData.physics;
    car.userData.race = freshRace(car, P.u || trackData.startFinishLine.u, trackData);
  }
}

// --- spawn rival AI cars (up to 7, configurable for multiplayer grids) --------
export function initAIRacers(scene, trackData, options = {}) {
  const count = clamp(options.count ?? 7, 0, TEAMS.length);
  const startSlot = Math.max(1, options.startSlot ?? 1);
  resetSession(getSession(trackData), options.holdSeconds);
  const aiList = [];
  TEAMS.slice(0, count).forEach((team, i) => {
    const car = createF1Car(team.color, false);
    car.userData.team = team.team;
    car.userData.driver = team.driver;
    car.userData.color = team.color;
    car.userData.ai = {
      top: 0.965 - i * 0.009,          // front grid = slightly faster (quali order)
      corner: 0.97 - i * 0.007,
      lane: ((i % 3) - 1) * 1.1,       // preferred straight-line lane
    };
    scene.add(car);
    placeCarOnGrid(car, trackData, startSlot + i);
    aiList.push(car);
  });
  return aiList;
}

export function restartRace(allCars, trackData, holdSeconds) {
  resetSession(getSession(trackData), holdSeconds);
  allCars.forEach((car, i) => placeCarOnGrid(car, trackData, car.userData.gridSlot ?? i));
}

// --- localization ----------------------------------------------------------------
function localize(car, sd) {
  const P = car.userData.physics, R = car.userData.race;
  const i = P.lastIdx, p = sd.pos[i], r = sd.right[i];
  R.u = P.u;
  R.lateral = (car.position.x - p.x) * r.x + (car.position.z - p.z) * r.z;
}

// --- traffic scan: nearest blocker ahead + side-by-side push ----------------------
function scanTraffic(car, cars, length, closedLoop) {
  const R = car.userData.race;
  const t = R.traffic;
  t.blockDist = Infinity; t.blocker = null; t.blockLat = 0; t.blockSpeed = 0; t.sidePush = 0;
  for (const other of cars) {
    if (other === car) continue;
    const oR = other.userData.race;
    if (!oR) continue;
    let ahead, dist;
    if (closedLoop) {
      const du = (oR.u - R.u + 1) % 1;
      ahead = du < 0.5;
      dist = (ahead ? du : 1 - du) * length;
    } else {
      const rawDu = oR.u - R.u;
      ahead = rawDu >= 0;
      dist = Math.abs(rawDu) * length;
    }
    const latDiff = oR.lateral - R.lateral;
    if (ahead && dist < 30 && Math.abs(latDiff) < 3.2 && dist < t.blockDist) {
      t.blockDist = dist; t.blocker = other;
      t.blockLat = oR.lateral; t.blockSpeed = other.userData.physics.speed;
    }
    if (dist < 6.5 && Math.abs(latDiff) < 2.7) {
      t.sidePush += (latDiff >= 0 ? -1 : 1) * (2.7 - Math.abs(latDiff)) * 0.45;
    }
  }
  return t;
}

// --- AI driver: speed plan + pure-pursuit steering + overtaking + DRS --------------
function computeAIControls(car, cars, trackData, prof, session, dt) {
  const P = car.userData.physics, R = car.userData.race, skill = car.userData.ai;
  const closedLoop = isClosedLoop(trackData);
  const finishU = getFinishU(trackData);
  const sd = trackData.trackCurve.userData.samples;
  const halfWidth = trackData.trackCurve.userData.halfWidth;
  const length = trackData.trackCurve.userData.length;
  const tunnel = trackData.trackCurve.userData.tunnel;
  const idx = P.lastIdx;

  // hold on the grid until lights out
  if (session.phase === 'LIGHTS') {
    R.prevYaw = P.yaw;
    return { throttle: 0, brake: 1, steer: 0, drs: false };
  }

  const speed = P.speed;
  const inTunnelNow = tunnel && tunnel.uStart >= 0 && P.u >= tunnel.uStart && P.u <= tunnel.uEnd;

  // ---- kinematic speed plan: brake in time for every corner ahead -------------
  let inZone = false;
  for (const z of trackData.drsZones) if (P.u >= z.uStart && P.u <= z.uEnd) { inZone = true; break; }
  const drsNow = R.drs && inZone;
  let target = TOP_SPEED * skill.top * (drsNow ? 1.1 : 1);
  if (R.finished) {
    if (closedLoop) {
      target = 12.5; // cool-down lap after the flag
    } else {
      target = P.u >= finishU + 0.0018 || P.u >= 0.9965 ? 0 : 9.5; // stop gently in Wates runoff
    }
  }

  const weatherGrip = trackData.weatherGrip ?? 1.0;
  const weatherBrake = trackData.weatherBrake ?? 1.0;
  const effPlanBrk = PLAN_BRK * weatherBrake;

  const horizon = Math.min(prof.N - 1, Math.ceil((speed * speed / (2 * effPlanBrk) + 45) / prof.segLen));
  const cs2 = skill.corner * skill.corner * weatherGrip * weatherGrip;
  for (let k = 0; k <= horizon; k += 2) {
    const j = closedLoop ? (idx + k) % prof.N : Math.min(prof.N - 1, idx + k);
    const allowed = Math.sqrt(prof.corner2[j] * cs2 + 2 * effPlanBrk * k * prof.segLen);
    if (allowed < target) target = allowed;
    if (!closedLoop && j === prof.N - 1) break;
  }

  // ---- lateral plan: racing line + overtaking / avoidance ----------------------
  const traffic = scanTraffic(car, cars, length, closedLoop);
  const aheadIdx = closedLoop
    ? (idx + Math.round(25 / prof.segLen)) % prof.N
    : Math.min(prof.N - 1, idx + Math.round(25 / prof.segLen));
  let latGoal = prof.curv[aheadIdx] > 0.006 ? -prof.sign[aheadIdx] * 1.5 : skill.lane;

  if (!R.finished && traffic.blocker && traffic.blockDist < 24) {
    const closing = speed > traffic.blockSpeed + 0.5 || traffic.blockDist < 12;
    if (closing && (!inTunnelNow || traffic.blockDist < 10)) {
      const lim = halfWidth - 1.9;
      let side = traffic.blockLat >= 0 ? -1 : 1;
      let lane = traffic.blockLat + side * 3.4;
      if (Math.abs(lane) > lim || Math.abs(lane - traffic.blockLat) < 2.4) {
        side = -side; lane = traffic.blockLat + side * 3.4;
      }
      latGoal = clamp(lane, -lim, lim);
    }
  }
  latGoal = clamp(latGoal + traffic.sidePush, -(halfWidth - 1.7), halfWidth - 1.7);
  if (R.finished) latGoal = skill.lane * 0.3;

  // Smooth post-knock recovery: accept displaced lane briefly instead of snapping back into player
  const knockT = P.knockTimer || 0;
  if (knockT > 0) {
    const recoveryRate = Math.min(1, 0.55 * dt);
    R.latTarget += (latGoal - R.latTarget) * recoveryRate;
    R.latTarget = clamp(R.latTarget, R.lateral - 1.25, R.lateral + 1.25);
    R.latTarget = clamp(R.latTarget, -(halfWidth - 1.65), halfWidth - 1.65);
  } else {
    R.latTarget += (latGoal - R.latTarget) * Math.min(1, 1.8 * dt);
  }

  // follow the blocker until the overtake lane is actually open
  if (!R.finished && traffic.blocker && traffic.blockDist < 10 &&
      Math.abs(R.latTarget - traffic.blockLat) < 2.5) {
    target = Math.min(target, traffic.blockSpeed + (traffic.blockDist < 5 ? 0 : 1.2));
  }

  // ---- throttle / brake from speed error ---------------------------------------
  const err = target - speed;
  let tT, bT;
  if (target <= 0.1) { tT = 0; bT = 1; }
  else if (err > 0.8) { tT = 1; bT = 0; }
  else if (err < -1.2) { tT = 0; bT = clamp(-err / 10, 0.15, 1); }
  else { tT = clamp(0.5 + err * 0.4, 0, 1); bT = 0; }
  if (knockT > 0.1) tT *= 0.85;
  R.throttle += (tT - R.throttle) * Math.min(1, 6 * dt);
  R.brake += (bT - R.brake) * Math.min(1, 8 * dt);

  // ---- DRS: zones on straights, never while braking ------------------------------
  R.drs = !R.finished && inZone && speed > 24 && R.brake < 0.1 && err > -2 && knockT <= 0.05;

  // ---- pure-pursuit steering toward the lookahead waypoint ----------------------
  const lookDist = clamp(7 + speed * 0.5 + knockT * 10, 9, 58);
  const j = closedLoop
    ? (idx + Math.round(lookDist / prof.segLen)) % prof.N
    : Math.min(prof.N - 1, idx + Math.round(lookDist / prof.segLen));
  const tx = sd.pos[j].x + sd.right[j].x * R.latTarget;
  const tz = sd.pos[j].z + sd.right[j].z * R.latTarget;
  const desiredYaw = Math.atan2(-(tx - car.position.x), -(tz - car.position.z));
  const dy = wrapAngle(desiredYaw - P.yaw);
  const instYawRate = wrapAngle(P.yaw - R.prevYaw) / Math.max(dt, 1e-4);
  R.yawRate += (instYawRate - R.yawRate) * 0.25;
  R.prevYaw = P.yaw;
  const knockEase = 1 - clamp(knockT * 0.65, 0, 0.45);
  const steer = clamp(dy * 3.0 * knockEase - (R.yawRate + (P.yawVel || 0) * 0.35) * 0.42, -1, 1);

  return { throttle: R.throttle, brake: R.brake, steer, drs: R.drs };
}

// --- checkpoint-validated lap / stage counting (player + AI) ------------------------
function validateLap(car, trackData, session) {
  const R = car.userData.race;
  const cps = trackData.checkpoints;
  const closedLoop = isClosedLoop(trackData);
  const totalLaps = getTotalLaps(trackData);

  if (closedLoop) {
    const next = cps[R.nextCp];
    const delta = (R.u - R.prevU + 1) % 1;
    if (delta > 1e-9 && delta < 0.5) {                 // forward motion only
      const arc = (next.u - R.prevU + 1) % 1;
      if (arc <= delta + 1e-9) {
        if (R.nextCp === 0) {                          // start / finish line
          if (R.lap === 0) {
            R.lap = 1; R.lapStart = session.raceTime;  // rolling start → lap 1 begins
          } else if (!R.finished) {
            const lapTime = session.raceTime - R.lapStart;
            R.lastLapTime = lapTime;
            if (R.bestLapTime == null || lapTime < R.bestLapTime) R.bestLapTime = lapTime;
            R.lapsCompleted++;
            R.lapStart = session.raceTime;
            if (R.lapsCompleted >= totalLaps) {
              R.finished = true;
              R.finishTime = session.raceTime;
              R.lap = totalLaps;
              session.finishedCount++;
              if (car.userData.isPlayer) session.phase = 'FINISHED';
            } else {
              R.lap = R.lapsCompleted + 1;
            }
          }
        }
        R.lastCheckpoint = next.name;
        R.nextCp = (R.nextCp + 1) % cps.length;
      }
    }
    R.prevU = R.u;
    return;
  }

  // Open point-to-point stage (e.g., Salatiga -> Wates 7.9 KM)
  if (!R.finished) {
    const delta = R.u - R.prevU;
    if (delta > 1e-9) {
      for (let step = 0; step < cps.length && !R.finished; step++) {
        const next = cps[R.nextCp];
        if (R.u + 1e-9 >= next.u) {
          if (R.nextCp === 0) {
            if (R.lap === 0) {
              R.lap = 1;
              R.lapStart = session.raceTime;
            }
            R.lastCheckpoint = next.name;
            if (R.nextCp < cps.length - 1) R.nextCp++;
            else break;
          } else if (R.nextCp === cps.length - 1) {
            const stageTime = session.raceTime - R.lapStart;
            R.lastLapTime = stageTime;
            if (R.bestLapTime == null || stageTime < R.bestLapTime) R.bestLapTime = stageTime;
            R.lapsCompleted = totalLaps;
            R.finished = true;
            R.finishTime = session.raceTime;
            R.lap = totalLaps;
            session.finishedCount++;
            if (car.userData.isPlayer) session.phase = 'FINISHED';
            R.lastCheckpoint = next.name;
          } else {
            R.lastCheckpoint = next.name;
            R.nextCp++;
          }
        } else {
          break;
        }
      }
    }
  }
  R.prevU = R.u;
}

// --- live standings 1st..8th -----------------------------------------------------------
function computeStandings(cars, trackData, session) {
  const closedLoop = isClosedLoop(trackData);
  const totalLaps = getTotalLaps(trackData);
  const startU = trackData.startFinishLine.u;
  const finishU = getFinishU(trackData);
  const stageSpan = Math.max(1e-4, finishU - startU);
  const length = trackData.trackCurve.userData.length;
  const entries = [];
  for (const car of cars) {
    const R = car.userData.race, P = car.userData.physics, e = R.entry;
    if (closedLoop) {
      const frac = (R.u - startU + 1) % 1;
      R.progress = R.lap === 0 ? frac - 1 : R.lapsCompleted + frac;
    } else {
      const frac = clamp((R.u - startU) / stageSpan, -0.05, 1.0);
      R.progress = R.finished ? 1 : frac;
    }
    e.lap = clamp(R.lap || 1, 1, totalLaps);
    e.lapsCompleted = R.lapsCompleted;
    e.progress = R.progress;
    e.bestLapTime = R.bestLapTime;
    e.lastLapTime = R.lastLapTime;
    e.currentLapTime = R.lap > 0 && !R.finished ? session.raceTime - R.lapStart : 0;
    e.finished = R.finished;
    e.finishTime = R.finishTime;
    e.speedKmh = P.speed * 3.6;
    e.drsActive = !!R.drs;
    entries.push(e);
  }
  entries.sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress || a.gridSlot - b.gridSlot;
  });
  const leader = entries[0];
  const meterScale = closedLoop ? length : (finishU - startU) * length;
  entries.forEach((e, i) => {
    e.position = i + 1;
    if (i === 0) { e.gap = 0; e.gapText = 'LEADER'; return; }
    if (e.finished && leader.finished) {
      e.gap = e.finishTime - leader.finishTime;
      e.gapText = `+${e.gap.toFixed(3)}s`;
      return;
    }
    const lapsBehind = closedLoop ? Math.floor(leader.progress - e.progress + 1e-6) : 0;
    if (lapsBehind >= 1) {
      e.gap = lapsBehind;
      e.gapText = `+${lapsBehind} LAP${lapsBehind > 1 ? 'S' : ''}`;
    } else {
      e.gap = Math.max(0, (leader.progress - e.progress) * meterScale / 45);
      e.gapText = `+${e.gap.toFixed(3)}s`;
    }
  });
  return entries;
}

// ==========================================================================================
export function updateAIRacers(aiList, allCars, trackData, dt, holdOnGrid = false) {
  const session = getSession(trackData);
  const prof = getProfile(trackData);
  const closedLoop = isClosedLoop(trackData);
  const totalLaps = getTotalLaps(trackData);
  const finishU = getFinishU(trackData);
  const sd = trackData.trackCurve.userData.samples;
  const cars = (allCars && allCars.length) ? allCars : aiList;

  if (!holdOnGrid) {
    advanceSession(session, dt);
  }
  for (const car of cars) ensureRace(car, trackData);
  for (const car of cars) localize(car, sd);

  let collisionEvents = [];
  if (!holdOnGrid) {
    // rivals drive through the shared physics pipeline (grip, DRS, barriers, sparks)
    for (const car of aiList) {
      const controls = computeAIControls(car, cars, trackData, prof, session, dt);
      updateCarPhysics(car, controls, trackData, dt);
      localize(car, sd);
    }

    // Solid OBB car-to-car collision separation + momentum transfer + yaw deflection
    collisionEvents = resolveCarCollisions(cars, trackData, dt);
    for (const car of cars) localize(car, sd);
    for (const ev of collisionEvents) {
      if (ev.closingSpeed > 2.2) {
        for (const c of [ev.carA, ev.carB]) {
          if (!c.userData.isPlayer && c.userData.race) {
            c.userData.race.latTarget += (c.userData.race.lateral - c.userData.race.latTarget) * 0.55;
          }
        }
      }
    }
    for (const car of cars) validateLap(car, trackData, session);
  }

  const standings = computeStandings(cars, trackData, session);
  const player = cars.find(c => c.userData.isPlayer) || cars[0];
  const PR = player.userData.race;
  const pe = PR.entry;
  const pos = pe.position;
  const startU = trackData.startFinishLine.u;
  const frac = closedLoop
    ? (PR.u - startU + 1) % 1
    : clamp((PR.u - startU) / Math.max(1e-4, finishU - startU), 0, 1);

  return {
    standings,
    playerLap: clamp(PR.lap || 1, 1, totalLaps),
    totalLaps,
    closedLoop,
    finishLineU: finishU,
    currentLapTime: PR.lap > 0 && !PR.finished ? session.raceTime - PR.lapStart : 0,
    bestLapTime: PR.bestLapTime,
    startLights: session.lightsOn,
    isFinished: PR.finished,
    phase: session.phase,
    waitingToStart: !!holdOnGrid,
    raceTime: session.raceTime,
    lastLapTime: PR.lastLapTime,
    playerPosition: pos,
    gapToLeader: pe.gap,
    gapAhead: pos > 1 ? Math.max(0, pe.gap - standings[pos - 2].gap) : 0,
    gapBehind: pos < standings.length ? Math.max(0, standings[pos].gap - pe.gap) : 0,
    leaderName: standings[0].name,
    checkpointName: PR.lastCheckpoint || trackData.checkpoints[0]?.name || 'Start / Finish',
    nextCheckpointName: trackData.checkpoints[Math.min(PR.nextCp, trackData.checkpoints.length - 1)].name,
    lapProgress: frac,
    finishedCount: session.finishedCount,
    totalCars: cars.length,
    collisionEvents,
  };
}
