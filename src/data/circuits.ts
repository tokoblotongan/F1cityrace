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
  startLine: { x1: number; y1: number; x2: number; y2: number };
  startDot: { x: number; y: number };
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
  worldPoints: Array<[number, number, number]>;
  startIndex: number;
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
// 2 · SALATIGA STREET CIRCUIT GPS WAYPOINTS & PROJECTION
// Route: Blotongan Start/Finish -> JLS (Lingkar Selatan) -> Jl. Jend. Sudirman
//        -> Bundaran Tamansari -> Jl. Diponegoro (Rumdin & UKSW) -> Blotongan
// ============================================================================
export const SALATIGA_ORIGIN_LAT = -7.3270;
export const SALATIGA_ORIGIN_LON = 110.5015;
export const SALATIGA_BASE_ELEV = 525;
export const SALATIGA_WORLD_SCALE = 0.56;
export const SALATIGA_ELEV_SCALE = 0.40;

const M_PER_LAT = 110574;
const M_PER_LON = 111320 * Math.cos((SALATIGA_ORIGIN_LAT * Math.PI) / 180);

export function salatigaLatLonToWorldXZ(lat: number, lon: number): [number, number] {
  const x = (lon - SALATIGA_ORIGIN_LON) * M_PER_LON * SALATIGA_WORLD_SCALE;
  const z = -(lat - SALATIGA_ORIGIN_LAT) * M_PER_LAT * SALATIGA_WORLD_SCALE;
  return [x, z];
}

export const SALATIGA_GPS_WAYPOINTS: SalatigaWaypoint[] = [
  { lat: -7.3114, lon: 110.4954, elev: 525, name: 'Blotongan North Sweep' },     // 0
  { lat: -7.3144, lon: 110.4938, elev: 525, name: 'Blotongan Start/Finish' },    // 1 (S/F straight)
  { lat: -7.3175, lon: 110.4924, elev: 534, name: 'Blotongan South' },           // 2
  { lat: -7.3194, lon: 110.4892, elev: 552, name: 'JLS North-West Entry' },      // 3
  { lat: -7.3230, lon: 110.4872, elev: 580, name: 'JLS Kecandran Crest' },       // 4
  { lat: -7.3284, lon: 110.4870, elev: 604, name: 'JLS West Ridge' },            // 5
  { lat: -7.3340, lon: 110.4884, elev: 626, name: 'JLS Gamol Climb' },           // 6
  { lat: -7.3390, lon: 110.4914, elev: 642, name: 'JLS Bendung' },               // 7
  { lat: -7.3420, lon: 110.4968, elev: 650, name: 'JLS Salib Putih Sweep' },     // 8
  { lat: -7.3430, lon: 110.5034, elev: 636, name: 'JLS South Straight' },        // 9
  { lat: -7.3424, lon: 110.5098, elev: 616, name: 'JLS Cebongan' },              // 10
  { lat: -7.3412, lon: 110.5134, elev: 602, name: 'JLS East Entry' },            // 11
  { lat: -7.3392, lon: 110.5132, elev: 596, name: 'JLS East Exit' },             // 12
  { lat: -7.3374, lon: 110.5096, elev: 590, name: 'Sudirman South Link' },       // 13
  { lat: -7.3342, lon: 110.5067, elev: 584, name: 'Jl. Jend. Sudirman South' },  // 14
  { lat: -7.3302, lon: 110.5060, elev: 578, name: 'Jl. Jend. Sudirman Mid' },    // 15
  { lat: -7.3266, lon: 110.5055, elev: 574, name: 'Jl. Jend. Sudirman North' },  // 16
  { lat: -7.3246, lon: 110.5050, elev: 572, name: 'Bundaran Tamansari' },        // 17
  { lat: -7.3236, lon: 110.5028, elev: 570, name: 'Jl. Diponegoro Rumdin' },     // 18
  { lat: -7.3208, lon: 110.5008, elev: 560, name: 'Jl. Diponegoro UKSW' },       // 19
  { lat: -7.3170, lon: 110.4988, elev: 544, name: 'Jl. Diponegoro North' },      // 20
  { lat: -7.3124, lon: 110.4969, elev: 528, name: 'Blotongan Approach' },        // 21
];

export const SALATIGA_POINTS: Array<[number, number, number]> = SALATIGA_GPS_WAYPOINTS.map((wp) => {
  const [x, z] = salatigaLatLonToWorldXZ(wp.lat, wp.lon);
  const y = (wp.elev - SALATIGA_BASE_ELEV) * SALATIGA_ELEV_SCALE;
  return [x, y, z];
});

export const SALATIGA_LANDMARKS = {
  tamansari: { lat: -7.32505, lon: 110.50465, elev: 572, label: 'Bundaran Tamansari' },
  rumdinWalikota: { lat: -7.32519, lon: 110.50385, elev: 571, label: 'Rumdin Wali Kota' },
  ukswCampus: { lat: -7.32045, lon: 110.49925, elev: 560, label: 'UKSW Campus' },
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

function evalSplineXZ(pts: Array<[number, number, number]>, t: number): [number, number] {
  const n = pts.length;
  const p = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(p);
  const w = p - i;
  const P = (k: number) => pts[((k % n) + n) % n];
  const p0 = P(i - 1);
  const p1 = P(i);
  const p2 = P(i + 1);
  const p3 = P(i + 2);
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
  markerDefs: Array<{ pointIndex: number; label: string; anchor: 'start' | 'middle' | 'end'; dx: number; dy: number }>
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
    const [x, z] = evalSplineXZ(pts, i / SEG);
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
    for (let i = 0; i < SEG; i++) {
      const d = (xs[i] - pt[0]) ** 2 + (zs[i] - pt[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };

  const buildArcPath = (segA: number, segB: number, close = false) => {
    const count = segB >= segA ? segB - segA : SEG - segA + segB;
    const cmds: string[] = [];
    for (let k = 0; k <= count; k++) {
      const idx = (segA + k) % SEG;
      const [px, py] = tx(xs[idx], zs[idx]);
      cmds.push(`${k === 0 ? 'M' : 'L'}${px},${py}`);
    }
    if (close) cmds.push('Z');
    return cmds.join(' ');
  };

  const path = buildArcPath(0, SEG, true);

  const startSeg = findNearestSeg(pts[startIndex]);
  const [sx0, sy0] = tx(xs[startSeg], zs[startSeg]);
  const nextSeg = (startSeg + 2) % SEG;
  const [sx1, sy1] = tx(xs[nextSeg], zs[nextSeg]);
  const vx = sx1 - sx0;
  const vy = sy1 - sy0;
  const vLen = Math.hypot(vx, vy) || 1;
  const nx = -vy / vLen;
  const ny = vx / vLen;

  const drsPaths = drsPairs.map(([aIdx, bIdx]) => {
    const sa = (findNearestSeg(pts[aIdx]) + 4) % SEG;
    const sb = (findNearestSeg(pts[bIdx]) - 4 + SEG) % SEG;
    return buildArcPath(sa, sb, false);
  });

  let tunnelPath: string | null = null;
  if (tunnelPair) {
    const ta = (findNearestSeg(pts[tunnelPair[0]]) - 2 + SEG) % SEG;
    const tb = (findNearestSeg(pts[tunnelPair[1]]) + 2) % SEG;
    tunnelPath = buildArcPath(ta, tb, false);
  }

  const markers: CircuitSvgMarker[] = markerDefs.map((m) => {
    const pt = pts[m.pointIndex];
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
    startLine: {
      x1: +(sx0 - nx * 7).toFixed(1),
      y1: +(sy0 - ny * 7).toFixed(1),
      x2: +(sx0 + nx * 7).toFixed(1),
      y2: +(sy0 + ny * 7).toFixed(1),
    },
    startDot: { x: sx0, y: sy0 },
    drsPaths,
    tunnelPath,
    markers,
  };
}

// ============================================================================
// 4 · EXPORTED CIRCUIT DEFINITIONS
// ============================================================================
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
    worldPoints: MONACO_POINTS,
    startIndex: 2,
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
      ]
    ),
  },
  'salatiga-gp': {
    id: 'salatiga-gp',
    gpTitle: 'SALATIGA GP',
    circuitTitle: 'SALATIGA STREET CIRCUIT',
    subtitle: 'Salatiga, Central Java • Highland Elevation & JLS • 9.8 KM',
    lengthLabel: '9.8 KM',
    bootMark: 'S',
    bootNote: 'Building Salatiga Street Circuit…',
    recordsStorageKey: 'f1_salatiga_podium_records',
    playerTeam: 'Salatiga Racing',
    totalLaps: 3,
    worldPoints: SALATIGA_POINTS,
    startIndex: 1,
    drsPointPairs: [
      [1, 3],
      [8, 10],
      [14, 16],
    ],
    tunnelPointPair: null,
    checkpoints: [
      { pointIndex: 1, name: 'Blotongan S/F' },
      { pointIndex: 4, name: 'JLS Kecandran' },
      { pointIndex: 8, name: 'JLS Salib Putih' },
      { pointIndex: 11, name: 'JLS Cebongan' },
      { pointIndex: 15, name: 'Jl. Jend. Sudirman' },
      { pointIndex: 17, name: 'Bundaran Tamansari' },
      { pointIndex: 18, name: 'Rumdin Wali Kota' },
      { pointIndex: 19, name: 'Jl. Diponegoro UKSW' },
    ],
    minimapLabels: [
      { pointIndex: 1, label: 'BLOTONGAN', ox: -48, oy: -4 },
      { pointIndex: 8, label: 'JLS RIDGE', ox: -16, oy: 12 },
      { pointIndex: 15, label: 'SUDIRMAN', ox: 7, oy: 3 },
      { pointIndex: 17, label: 'TAMANSARI', ox: 7, oy: -5 },
      { pointIndex: 19, label: 'DIPONEGORO', ox: 6, oy: -4 },
    ],
    hasHarborWater: false,
    svgData: generateCircuitSvg(
      SALATIGA_POINTS,
      1,
      [
        [1, 3],
        [8, 10],
        [14, 16],
      ],
      null,
      [
        { pointIndex: 1, label: 'Blotongan S/F', anchor: 'end', dx: -8, dy: -2 },
        { pointIndex: 7, label: 'JLS', anchor: 'end', dx: -8, dy: 4 },
        { pointIndex: 15, label: 'Jl. Sudirman', anchor: 'start', dx: 7, dy: 4 },
        { pointIndex: 17, label: 'Tamansari', anchor: 'start', dx: 8, dy: -3 },
        { pointIndex: 19, label: 'Jl. Diponegoro', anchor: 'start', dx: 7, dy: -4 },
      ]
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
