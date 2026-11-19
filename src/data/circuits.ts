import salatigaRouteRaw from './salatiga-route.geojson?raw';

export type CircuitId = 'monaco-gp' | 'salatiga-gp';

export interface SalatigaWaypoint {
  lat: number;
  lon: number;
  elev: number;
  name: string;
}

export interface CircuitSvgMarker {
  x: number;
  y: number;
  label: string;
  anchor: 'start' | 'middle' | 'end';
  dx: number;
  dy: number;
}

export interface CircuitSvgData {
  viewBox: string;
  path: string;
  isClosed: boolean;
  startLine: { x1: number; y1: number; x2: number; y2: number };
  startDot: { x: number; y: number };
  finishDot?: { x: number; y: number };
  drsPaths: string[];
  tunnelPath: string | null;
  markers: CircuitSvgMarker[];
}

export interface CircuitConfig {
  id: CircuitId;
  gpTitle: string;
  circuitTitle: string;
  subtitle: string;
  lengthLabel: string;
  bootMark: string;
  bootNote: string;
  recordsStorageKey: string;
  playerTeam: string;
  totalLaps: number;
  closedLoop: boolean;
  roadWidthMeters: number;
  kerbWidthMeters: number;
  barrierOffsetMeters: number;
  worldPoints: Array<[number, number, number]>;
  startIndex: number;
  finishIndex: number;
  drsPointPairs: Array<[number, number]>;
  tunnelPointPair: [number, number] | null;
  checkpoints: Array<{ pointIndex: number; name: string }>;
  minimapLabels: Array<{ pointIndex: number; label: string; ox: number; oy: number }>;
  hasHarborWater: boolean;
  svgData: CircuitSvgData;
}

// ============================================================================
// 1 · MONACO GP WAYPOINTS (3D Circuit de Monaco)
// ============================================================================
const MONACO_SCALE = 1.18;
export const MONACO_POINTS: Array<[number, number, number]> = [
  [40, 0, 160], [0, 0, 120], [0, 0, 0], [0, 0, -140], [12, 1, -192], [48, 3, -218], [115, 8, -232],
  [195, 14, -252], [243, 16, -292], [252, 17, -352], [288, 17, -396], [332, 15, -402], [372, 12, -372],
  [398, 8, -322], [392, 5, -262], [358, 4, -228], [326, 4, -252], [318, 2, -306], [332, 1, -356],
  [392, 0, -362], [478, 0, -336], [552, 0, -278], [588, 0, -206], [576, 0, -158], [596, 0, -118],
  [586, 0, -52], [556, 0, 12], [516, 0, 52], [478, 0, 64], [428, 0, 104], [362, 0, 148], [304, 0, 190],
  [252, 0, 198], [204, 0, 178], [122, 0, 168],
].map((p) => [p[0] * MONACO_SCALE, p[1] * MONACO_SCALE, p[2] * MONACO_SCALE]);

// ============================================================================
// 2 · SALATIGA -> WATES (7.9 KM) BROUTER GEOJSON & 1:1 TAMANSARI PROJECTION
// ============================================================================
export const SALATIGA_ORIGIN_LON = 110.504924;
export const SALATIGA_ORIGIN_LAT = -7.324859;
export const SALATIGA_BASE_ELEV = 590;
export const SALATIGA_ELEV_SCALE = 0.35;

const M_PER_LAT = 110574;
const M_PER_LON = 111320 * Math.cos((SALATIGA_ORIGIN_LAT * Math.PI) / 180);

export function salatigaLatLonToWorldXZ(lat: number, lon: number): [number, number] {
  const x = (lon - SALATIGA_ORIGIN_LON) * M_PER_LON;
  const z = -(lat - SALATIGA_ORIGIN_LAT) * M_PER_LAT;
  return [x, z];
}

interface ParsedRouteGeo {
  features?: Array<{
    geometry?: {
      type?: string;
      coordinates?: Array<[number, number, number?]>;
    };
  }>;
}

const parsedRoute = JSON.parse(salatigaRouteRaw) as ParsedRouteGeo;
const rawRouteCoords = parsedRoute?.features?.[0]?.geometry?.coordinates ?? [];

function buildCleanSalatigaPoints(): Array<[number, number, number]> {
  const projected: Array<[number, number, number]> = rawRouteCoords.map(([lon, lat, elev]) => {
    const [x, z] = salatigaLatLonToWorldXZ(lat, lon);
    const y = ((elev ?? SALATIGA_BASE_ELEV) - SALATIGA_BASE_ELEV) * SALATIGA_ELEV_SCALE;
    return [x, y, z];
  });

  // Remove exact/sub-2.2m BRouter node duplicates and the 1m residential backtrack spur
  // without altering the actual Tamansari -> Sudirman -> JLS -> Wates route shape.
  const cleaned: Array<[number, number, number]> = [];
  for (let i = 0; i < projected.length; i++) {
    const cur = projected[i];
    if (i > 0 && i < projected.length - 1) {
      const prev = cleaned[cleaned.length - 1];
      if (Math.hypot(cur[0] - prev[0], cur[2] - prev[2]) < 2.2) continue;
      const next = projected[i + 1];
      if (Math.hypot(next[0] - prev[0], next[2] - prev[2]) < 2.0) {
        cleaned.pop();
        continue;
      }
    }
    cleaned.push(cur);
  }
  return cleaned;
}

export const SALATIGA_POINTS: Array<[number, number, number]> = buildCleanSalatigaPoints();

export const SALATIGA_GPS_WAYPOINTS: SalatigaWaypoint[] = [
  { lat: -7.324859, lon: 110.504924, elev: 590, name: 'Bundaran Tamansari' },
  { lat: -7.325796, lon: 110.504823, elev: 589.5, name: 'Jl. Jend. Sudirman Start' },
  { lat: -7.334048, lon: 110.505629, elev: 598, name: 'Jl. Jend. Sudirman Mid' },
  { lat: -7.344154, lon: 110.510706, elev: 635, name: 'Jl. Jend. Sudirman South' },
  { lat: -7.364500, lon: 110.512250, elev: 691, name: 'Tingkir / JLS Turn' },
  { lat: -7.365210, lon: 110.498030, elev: 732, name: 'JLS Highland Ridge' },
  { lat: -7.361187, lon: 110.485886, elev: 731, name: 'Wates Finish' },
];

export const SALATIGA_LANDMARKS = {
  tamansari: { lat: -7.324859, lon: 110.504924, elev: 590, label: 'Bundaran Tamansari' },
  watesFinish: { lat: -7.361187, lon: 110.485886, elev: 731, label: 'Wates Finish' },
};

// ============================================================================
// 3 · CENTRIPETAL CATMULL-ROM SPLINE & SVG SILHOUETTE GENERATOR
// ============================================================================
function axisVal(
  x0: number,
  x1: number,
  x2: number,
  x3: number,
  dt0: number,
  dt1: number,
  dt2: number,
  w: number
): number {
  let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
  let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
  t1 *= dt1;
  t2 *= dt1;
  const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2;
  const c3 = 2 * x1 - 2 * x2 + t1 + t2;
  return ((c3 * w + c2) * w + t1) * w + x1;
}

export function evalSplineXZ(
  pts: Array<[number, number, number]>,
  t: number,
  closedLoop = true
): [number, number] {
  const n = pts.length;
  if (n < 2) return pts[0] ? [pts[0][0], pts[0][2]] : [0, 0];

  let p0: [number, number, number];
  let p1: [number, number, number];
  let p2: [number, number, number];
  let p3: [number, number, number];
  let w = 0;

  if (closedLoop) {
    const p = (((t % 1) + 1) % 1) * n;
    const i = Math.floor(p);
    w = p - i;
    const P = (k: number) => pts[((k % n) + n) % n];
    p0 = P(i - 1);
    p1 = P(i);
    p2 = P(i + 1);
    p3 = P(i + 2);
  } else {
    const segs = n - 1;
    const clampedT = Math.min(1, Math.max(0, t));
    const p = clampedT * segs;
    const i = Math.min(segs - 1, Math.floor(p));
    w = p - i;
    p1 = pts[i];
    p2 = pts[i + 1];
    p0 =
      i > 0
        ? pts[i - 1]
        : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1], 2 * p1[2] - p2[2]];
    p3 =
      i + 2 < n
        ? pts[i + 2]
        : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1], 2 * p2[2] - p1[2]];
  }

  const d2 = (a: [number, number, number], b: [number, number, number]) =>
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  let dt0 = Math.pow(d2(p0, p1), 0.25);
  let dt1 = Math.pow(d2(p1, p2), 0.25);
  let dt2 = Math.pow(d2(p2, p3), 0.25);
  if (dt1 < 1e-4) dt1 = 1;
  if (dt0 < 1e-4) dt0 = dt1;
  if (dt2 < 1e-4) dt2 = dt1;
  return [
    axisVal(p0[0], p1[0], p2[0], p3[0], dt0, dt1, dt2, w),
    axisVal(p0[2], p1[2], p2[2], p3[2], dt0, dt1, dt2, w),
  ];
}

function generateCircuitSvg(
  pts: Array<[number, number, number]>,
  startIndex: number,
  drsPairs: Array<[number, number]>,
  tunnelPair: [number, number] | null,
  markerDefs: Array<{ pointIndex: number; label: string; anchor: 'start' | 'middle' | 'end'; dx: number; dy: number }>,
  closedLoop = true,
  finishIndex = startIndex
): CircuitSvgData {
  const W = 280;
  const H = 148;
  const padX = 28;
  const padY = 20;
  const SEG = 360;

  const xs: number[] = [];
  const zs: number[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i <= SEG; i++) {
    const [x, z] = evalSplineXZ(pts, i / SEG, closedLoop);
    xs.push(x);
    zs.push(z);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const s = Math.min((W - padX * 2) / spanX, (H - padY * 2) / spanZ);
  const ox = (W - spanX * s) * 0.5;
  const oy = (H - spanZ * s) * 0.5;
  const tx = (x: number, z: number): [number, number] => [
    +(ox + (x - minX) * s).toFixed(1),
    +(oy + (z - minZ) * s).toFixed(1),
  ];

  const findNearestSeg = (pt: [number, number, number]) => {
    let best = 0;
    let bd = Infinity;
    const limit = closedLoop ? SEG : SEG + 1;
    for (let i = 0; i < limit; i++) {
      const d = (xs[i] - pt[0]) ** 2 + (zs[i] - pt[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };

  const buildArcPath = (segA: number, segB: number, close = false) => {
    const count = closedLoop
      ? (segB >= segA ? segB - segA : SEG - segA + segB)
      : Math.max(1, segB - segA);
    const cmds: string[] = [];
    for (let k = 0; k <= count; k++) {
      const idx = closedLoop ? (segA + k) % SEG : Math.min(SEG, Math.max(0, segA + k));
      const [px, py] = tx(xs[idx], zs[idx]);
      cmds.push(`${k === 0 ? 'M' : 'L'}${px},${py}`);
    }
    if (close) cmds.push('Z');
    return cmds.join(' ');
  };

  const path = buildArcPath(0, SEG, closedLoop);

  const startSeg = findNearestSeg(pts[startIndex]);
  const [sx0, sy0] = tx(xs[startSeg], zs[startSeg]);
  const nextSeg = closedLoop ? (startSeg + 2) % SEG : Math.min(SEG, startSeg + 2);
  const [sx1, sy1] = tx(xs[nextSeg], zs[nextSeg]);
  const vx = sx1 - sx0;
  const vy = sy1 - sy0;
  const vLen = Math.hypot(vx, vy) || 1;
  const nx = -vy / vLen;
  const ny = vx / vLen;

  const drsPaths = drsPairs.map(([aIdx, bIdx]) => {
    const rawA = findNearestSeg(pts[aIdx]);
    const rawB = findNearestSeg(pts[bIdx]);
    if (closedLoop) {
      return buildArcPath((rawA + 4) % SEG, (rawB - 4 + SEG) % SEG, false);
    }
    return buildArcPath(Math.min(SEG - 2, rawA + 2), Math.max(rawA + 3, rawB - 2), false);
  });

  let tunnelPath: string | null = null;
  if (tunnelPair) {
    const ta = (findNearestSeg(pts[tunnelPair[0]]) - 2 + SEG) % SEG;
    const tb = (findNearestSeg(pts[tunnelPair[1]]) + 2) % SEG;
    tunnelPath = buildArcPath(ta, tb, false);
  }

  let finishDot: { x: number; y: number } | undefined;
  if (!closedLoop) {
    const fPt = pts[Math.min(pts.length - 1, finishIndex)];
    const [fx, fy] = tx(fPt[0], fPt[2]);
    finishDot = { x: fx, y: fy };
  }

  const markers: CircuitSvgMarker[] = markerDefs.map((m) => {
    const pt = pts[Math.min(pts.length - 1, Math.max(0, m.pointIndex))];
    const [x, y] = tx(pt[0], pt[2]);
    return {
      x,
      y,
      label: m.label,
      anchor: m.anchor,
      dx: m.dx,
      dy: m.dy,
    };
  });

  return {
    viewBox: `0 0 ${W} ${H}`,
    path,
    isClosed: closedLoop,
    startLine: {
      x1: +(sx0 - nx * 7).toFixed(1),
      y1: +(sy0 - ny * 7).toFixed(1),
      x2: +(sx0 + nx * 7).toFixed(1),
      y2: +(sy0 + ny * 7).toFixed(1),
    },
    startDot: { x: sx0, y: sy0 },
    finishDot,
    drsPaths,
    tunnelPath,
    markers,
  };
}

// ============================================================================
// 4 · EXPORTED CIRCUIT DEFINITIONS
// ============================================================================
const SALATIGA_LAST_IDX = Math.max(0, SALATIGA_POINTS.length - 1);

export const CIRCUITS: Record<CircuitId, CircuitConfig> = {
  'monaco-gp': {
    id: 'monaco-gp',
    gpTitle: 'MONACO GP',
    circuitTitle: 'CIRCUIT DE MONACO',
    subtitle: 'Monte Carlo, Monaco • Harbor & Tunnel • 3.34 KM',
    lengthLabel: '3.34 KM',
    bootMark: 'M',
    bootNote: 'Building Circuit de Monaco…',
    recordsStorageKey: 'f1_monaco_podium_records',
    playerTeam: 'Scuderia Monaco',
    totalLaps: 3,
    closedLoop: true,
    roadWidthMeters: 16.8,
    kerbWidthMeters: 1.05,
    barrierOffsetMeters: 9.55,
    worldPoints: MONACO_POINTS,
    startIndex: 2,
    finishIndex: 2,
    drsPointPairs: [
      [2, 3],
      [21, 23],
    ],
    tunnelPointPair: [19, 21],
    checkpoints: [
      { pointIndex: 2, name: 'Start / Finish' },
      { pointIndex: 4, name: 'Sainte Devote' },
      { pointIndex: 9, name: 'Casino Square' },
      { pointIndex: 15, name: 'Fairmont Hairpin' },
      { pointIndex: 18, name: 'Portier' },
      { pointIndex: 20, name: 'Monaco Tunnel' },
      { pointIndex: 24, name: 'Nouvelle Chicane' },
      { pointIndex: 27, name: 'Piscine' },
      { pointIndex: 31, name: 'La Rascasse' },
    ],
    minimapLabels: [
      { pointIndex: 9, label: 'CASINO', ox: -40, oy: -6 },
      { pointIndex: 20, label: 'TUNNEL', ox: -12, oy: -9 },
      { pointIndex: 27, label: 'PISCINE', ox: 7, oy: 4 },
      { pointIndex: 31, label: 'RASCASSE', ox: -14, oy: 13 },
    ],
    hasHarborWater: true,
    svgData: generateCircuitSvg(
      MONACO_POINTS,
      2,
      [
        [2, 3],
        [21, 23],
      ],
      [19, 21],
      [
        { pointIndex: 4, label: 'Ste-Dévote', anchor: 'end', dx: -6, dy: -4 },
        { pointIndex: 9, label: 'Casino', anchor: 'end', dx: -7, dy: -4 },
        { pointIndex: 15, label: 'Hairpin', anchor: 'end', dx: -6, dy: 9 },
        { pointIndex: 20, label: 'Tunnel', anchor: 'start', dx: 6, dy: -6 },
        { pointIndex: 24, label: 'Harbor Chicane', anchor: 'start', dx: 7, dy: 4 },
      ],
      true,
      2
    ),
  },
  'salatiga-gp': {
    id: 'salatiga-gp',
    gpTitle: 'SALATIGA GP',
    circuitTitle: 'SALATIGA — WATES STAGE',
    subtitle: 'Tamansari → Sudirman → JLS → Wates • Point-to-Point • 7.9 KM',
    lengthLabel: '7.9 KM',
    bootMark: 'S',
    bootNote: 'Building Salatiga → Wates 7.9 KM Stage…',
    recordsStorageKey: 'f1_salatiga_wates_podium_records',
    playerTeam: 'Salatiga Racing',
    totalLaps: 1,
    closedLoop: false,
    roadWidthMeters: 14,
    kerbWidthMeters: 1.2,
    barrierOffsetMeters: 8.2,
    worldPoints: SALATIGA_POINTS,
    startIndex: Math.min(8, SALATIGA_LAST_IDX),
    finishIndex: SALATIGA_LAST_IDX,
    drsPointPairs: [
      [16, 36],
      [82, 128],
      [170, 212],
    ],
    tunnelPointPair: null,
    checkpoints: [
      { pointIndex: Math.min(8, SALATIGA_LAST_IDX), name: 'Tamansari Start' },
      { pointIndex: Math.min(48, SALATIGA_LAST_IDX), name: 'Jl. Jend. Sudirman' },
      { pointIndex: Math.min(98, SALATIGA_LAST_IDX), name: 'Sudirman South' },
      { pointIndex: Math.min(158, SALATIGA_LAST_IDX), name: 'Tingkir JLS Corner' },
      { pointIndex: Math.min(205, SALATIGA_LAST_IDX), name: 'JLS Highland' },
      { pointIndex: Math.min(248, SALATIGA_LAST_IDX), name: 'JLS Crest 755m' },
      { pointIndex: SALATIGA_LAST_IDX, name: 'Wates Finish' },
    ],
    minimapLabels: [
      { pointIndex: 0, label: 'TAMANSARI', ox: 6, oy: 3 },
      { pointIndex: Math.min(54, SALATIGA_LAST_IDX), label: 'SUDIRMAN', ox: 6, oy: 2 },
      { pointIndex: Math.min(158, SALATIGA_LAST_IDX), label: 'TINGKIR / JLS', ox: -54, oy: 11 },
      { pointIndex: SALATIGA_LAST_IDX, label: 'WATES FINISH', ox: -4, oy: -7 },
    ],
    hasHarborWater: false,
    svgData: generateCircuitSvg(
      SALATIGA_POINTS,
      Math.min(8, SALATIGA_LAST_IDX),
      [
        [16, 36],
        [82, 128],
        [170, 212],
      ],
      null,
      [
        { pointIndex: 0, label: 'Start · Tamansari', anchor: 'start', dx: 6, dy: 3 },
        { pointIndex: Math.min(54, SALATIGA_LAST_IDX), label: 'Jl. Sudirman', anchor: 'start', dx: 6, dy: 2 },
        { pointIndex: Math.min(158, SALATIGA_LAST_IDX), label: 'JLS Corner', anchor: 'start', dx: 6, dy: 4 },
        { pointIndex: SALATIGA_LAST_IDX, label: 'Finish · Wates', anchor: 'end', dx: -5, dy: -5 },
      ],
      false,
      SALATIGA_LAST_IDX
    ),
  },
};

export const CIRCUIT_LIST: CircuitConfig[] = [
  CIRCUITS['monaco-gp'],
  CIRCUITS['salatiga-gp'],
];

export function getCircuitConfig(id?: string | null): CircuitConfig {
  if (id === 'salatiga-gp') return CIRCUITS['salatiga-gp'];
  return CIRCUITS['monaco-gp'];
}
