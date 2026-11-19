import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  CIRCUIT_LIST,
  CircuitConfig,
  CircuitId,
  getCircuitConfig,
} from './data/circuits.ts';
import { initAudio, initHud } from './game/audioHud.js';
import {
  EngineController,
  MultiplayerStartOptions,
  RaceFinishResult,
  WeatherType,
  startMonacoEngine,
} from './game/engine.ts';
import {
  ActiveRoomState,
  LIVERY_PRESETS,
  LobbyRoomInfo,
  MultiplayerManager,
  RaceStartPayload,
} from './game/multiplayer.ts';
import { isSupabaseConfigured } from './lib/supabaseClient.ts';

const LAST_NAME_STORAGE_KEY = 'f1_monaco_last_driver_name';
const LIVERY_STORAGE_KEY = 'f1_multiplayer_livery_color';
const MAX_HALL_OF_FAME = 10;

interface PodiumRecord {
  id: string;
  name: string;
  position: 1 | 2 | 3;
  bestLapTime: number | null;
  totalTime: number;
  createdAt: number;
}

function formatRaceTime(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t) || t <= 0) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function sortAndTrimRecords(records: PodiumRecord[]): PodiumRecord[] {
  return [...records]
    .sort((a, b) => {
      const aBest = a.bestLapTime != null && a.bestLapTime > 0 ? a.bestLapTime : Number.POSITIVE_INFINITY;
      const bBest = b.bestLapTime != null && b.bestLapTime > 0 ? b.bestLapTime : Number.POSITIVE_INFINITY;
      if (aBest !== bBest) return aBest - bBest;
      return a.totalTime - b.totalTime;
    })
    .slice(0, MAX_HALL_OF_FAME);
}

function loadStoredRecords(storageKey: string): PodiumRecord[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(
      (item): item is PodiumRecord =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        (item.position === 1 || item.position === 2 || item.position === 3) &&
        typeof item.totalTime === 'number' &&
        Number.isFinite(item.totalTime)
    );
    return sortAndTrimRecords(valid);
  } catch {
    return [];
  }
}

function saveStoredRecords(storageKey: string, records: PodiumRecord[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(records));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function loadLastDriverName(): string {
  try {
    return (window.localStorage.getItem(LAST_NAME_STORAGE_KEY) || '').slice(0, 16);
  } catch {
    return '';
  }
}

function saveLastDriverName(name: string): void {
  try {
    window.localStorage.setItem(LAST_NAME_STORAGE_KEY, name.slice(0, 16));
  } catch {
    // Ignore storage errors
  }
}

function loadLastLiveryColor(): string {
  try {
    const saved = window.localStorage.getItem(LIVERY_STORAGE_KEY);
    if (saved && LIVERY_PRESETS.some((p) => p.hex.toLowerCase() === saved.toLowerCase())) {
      return saved;
    }
  } catch {
    // Ignore storage errors
  }
  return LIVERY_PRESETS[0].hex;
}

function saveLastLiveryColor(hex: string): void {
  try {
    window.localStorage.setItem(LIVERY_STORAGE_KEY, hex);
  } catch {
    // Ignore storage errors
  }
}

function applyDriverNameToFinishDom(driverName: string): void {
  const podiumEl = document.getElementById('podium');
  if (podiumEl) {
    const drivers = podiumEl.querySelectorAll('.podium-driver');
    drivers.forEach((el) => {
      if (el.textContent?.trim() === 'YOU' || el.getAttribute('data-player-podium') === '1') {
        el.setAttribute('data-player-podium', '1');
        if (el.textContent !== driverName) el.textContent = driverName;
      }
    });
  }

  const rowsEl = document.getElementById('finish-rows');
  if (rowsEl) {
    const playerNameEl = rowsEl.querySelector('.frow.player .fname');
    if (playerNameEl) {
      for (const node of Array.from(playerNameEl.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.textContent !== driverName) node.textContent = driverName;
          break;
        }
      }
    }
  }
}

function getMedalBadgeClass(pos: 1 | 2 | 3): string {
  if (pos === 1) {
    return 'bg-gradient-to-b from-[#f3d479] to-[#c79a2b] text-[#0b0f16] shadow-[0_0_10px_rgba(216,178,74,0.45)]';
  }
  if (pos === 2) {
    return 'bg-gradient-to-b from-[#e2e8f0] to-[#94a3b8] text-[#0b0f16]';
  }
  return 'bg-gradient-to-b from-[#e0a272] to-[#9c5a34] text-[#0b0f16]';
}

interface WeatherOption {
  id: WeatherType;
  label: string;
  shortLabel: string;
  subtitle: string;
  gripBadge: string;
  description: string;
  activeCardCls: string;
  badgeCls: string;
  iconColorCls: string;
}

const WEATHER_OPTIONS: WeatherOption[] = [
  {
    id: 'cerah',
    label: 'CERAH',
    shortLabel: 'CERAH',
    subtitle: 'Sunny Mediterranean',
    gripBadge: '100% GRIP · DRY',
    description: 'Clear azure sky, golden sunlight, white clouds & dry high-grip asphalt.',
    activeCardCls:
      'border-[#facc15] bg-gradient-to-b from-[#facc15]/18 to-[#0b0f16]/90 shadow-[0_0_24px_rgba(250,204,21,0.28)]',
    badgeCls: 'bg-[#facc15]/20 text-[#fde047] border-[#facc15]/45',
    iconColorCls: 'text-[#facc15]',
  },
  {
    id: 'hujan',
    label: 'HUJAN LEBAT',
    shortLabel: 'HUJAN',
    subtitle: 'Heavy Storm & Thunder',
    gripBadge: '72% GRIP · WET',
    description: 'Stormy sky, diagonal downpour, lightning flashes, tire spray & wet drift.',
    activeCardCls:
      'border-[#38bdf8] bg-gradient-to-b from-[#38bdf8]/20 to-[#0b0f16]/90 shadow-[0_0_24px_rgba(56,189,248,0.3)]',
    badgeCls: 'bg-[#38bdf8]/20 text-[#7dd3fc] border-[#38bdf8]/45',
    iconColorCls: 'text-[#38bdf8]',
  },
  {
    id: 'kabut',
    label: 'BERKABUT & GERIMIS',
    shortLabel: 'KABUT',
    subtitle: 'Misty Drizzle',
    gripBadge: '86% GRIP · DAMP',
    description: 'Dense coastal sea-fog limiting forward sight, fine drizzle & damp tarmac.',
    activeCardCls:
      'border-[#00d2be] bg-gradient-to-b from-[#94a3b8]/22 to-[#0b0f16]/90 shadow-[0_0_24px_rgba(0,210,190,0.26)]',
    badgeCls: 'bg-[#94a3b8]/20 text-[#cbd5e1] border-[#94a3b8]/45',
    iconColorCls: 'text-[#cbd5e1]',
  },
];

function WeatherIcon({ type, className = 'w-6 h-6' }: { type: WeatherType; className?: string }) {
  if (type === 'cerah') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="4.5" fill="currentColor" />
        <path strokeLinecap="round" d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
      </svg>
    );
  }
  if (type === 'hujan') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="currentColor"
          fillOpacity="0.22"
          d="M6.5 15h10.8a3.7 3.7 0 0 0 .4-7.38A5.2 5.2 0 0 0 7.6 6.7 4 4 0 0 0 6.5 15Z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" className="text-[#facc15]" stroke="currentColor" d="M13 13.5l-2 3.5h2.5l-1.5 3.5" />
        <path strokeLinecap="round" d="M7.5 17.5l-1 2.5M17 17.5l-1 2.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.2"
        d="M6.2 13.5h11.3a3.4 3.4 0 0 0 .3-6.78 4.8 4.8 0 0 0-9.3-.8A3.8 3.8 0 0 0 6.2 13.5Z"
      />
      <path strokeLinecap="round" d="M4.5 16.5h15M6.5 19.5h11" />
    </svg>
  );
}

function CircuitSvgMap({ config, selected }: { config: CircuitConfig; selected: boolean }) {
  const { svgData, id } = config;
  const isSalatiga = id === 'salatiga-gp';
  const filterId = `track-glow-${id}`;
  const haloColor = isSalatiga ? '#22ff88' : '#00d2be';
  const coreColor = isSalatiga ? (selected ? '#fef08a' : '#f2efe6') : '#f2efe6';
  const accentLabelColor = isSalatiga ? '#a7f3d0' : '#bae6fd';

  return (
    <svg
      viewBox={svgData.viewBox}
      className="w-full h-[112px] sm:h-[124px] select-none overflow-visible"
      role="img"
      aria-label={`${config.circuitTitle} track layout`}
    >
      <defs>
        <filter id={filterId} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer neon glow silhouette */}
      <path
        d={svgData.path}
        fill="none"
        stroke={haloColor}
        strokeWidth={selected ? 7 : 5}
        strokeOpacity={selected ? 0.36 : 0.20}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${filterId})`}
      />

      {/* Crisp main track ribbon */}
      <path
        d={svgData.path}
        fill="none"
        stroke={coreColor}
        strokeWidth="2.8"
        strokeOpacity={selected ? 0.96 : 0.78}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* DRS straight highlights */}
      {svgData.drsPaths.map((dp, i) => (
        <path
          key={i}
          d={dp}
          fill="none"
          stroke={isSalatiga ? '#facc15' : '#22ff88'}
          strokeWidth="3.2"
          strokeOpacity="0.9"
          strokeLinecap="round"
        />
      ))}

      {/* Tunnel highlight (Monaco) */}
      {svgData.tunnelPath && (
        <path
          d={svgData.tunnelPath}
          fill="none"
          stroke="#ffb020"
          strokeWidth="3.5"
          strokeDasharray="4 3"
          strokeLinecap="round"
        />
      )}

      {/* Red Start / Finish perpendicular line + dot */}
      <line
        x1={svgData.startLine.x1}
        y1={svgData.startLine.y1}
        x2={svgData.startLine.x2}
        y2={svgData.startLine.y2}
        stroke="#ff2d1a"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle
        cx={svgData.startDot.x}
        cy={svgData.startDot.y}
        r="3.4"
        fill="#ff2d1a"
        stroke="#f2efe6"
        strokeWidth="1.2"
      />

      {/* Gold Finish marker for point-to-point open stages */}
      {!svgData.isClosed && svgData.finishDot && (
        <g>
          <circle
            cx={svgData.finishDot.x}
            cy={svgData.finishDot.y}
            r="5.2"
            fill="none"
            stroke="#facc15"
            strokeWidth="1.3"
            strokeOpacity="0.85"
          />
          <circle
            cx={svgData.finishDot.x}
            cy={svgData.finishDot.y}
            r="3.2"
            fill="#facc15"
            stroke="#0b0f16"
            strokeWidth="1"
          />
        </g>
      )}

      {/* Corner & Landmark Annotations */}
      {svgData.markers.map((m, idx) => (
        <g key={idx}>
          <circle cx={m.x} cy={m.y} r="2.2" fill={haloColor} />
          <text
            x={m.x + m.dx}
            y={m.y + m.dy}
            textAnchor={m.anchor}
            fill={accentLabelColor}
            fillOpacity={selected ? 0.94 : 0.72}
            fontSize="7.4"
            fontWeight="700"
            fontFamily="Titillium Web, sans-serif"
            letterSpacing="0.04em"
          >
            {m.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef<EngineController | null>(null);
  const [mpManager] = useState(() => new MultiplayerManager());
  const [webglError, setWebglError] = useState<string | null>(null);
  const [gameMode, setGameMode] = useState<'single' | 'multi'>('single');
  const [circuit, setCircuit] = useState<CircuitId>('monaco-gp');
  const [weather, setWeather] = useState<WeatherType>('cerah');
  const [raceStarted, setRaceStarted] = useState(false);
  const [showWeatherMenu, setShowWeatherMenu] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [records, setRecords] = useState<PodiumRecord[]>(() =>
    loadStoredRecords(getCircuitConfig('monaco-gp').recordsStorageKey)
  );
  const [finishResult, setFinishResult] = useState<RaceFinishResult | null>(null);
  const [driverName, setDriverName] = useState<string>(() => loadLastDriverName());
  const [liveryColor, setLiveryColor] = useState<string>(() => loadLastLiveryColor());
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  const [savedDriverName, setSavedDriverName] = useState<string | null>(null);
  const [showHallOfFameModal, setShowHallOfFameModal] = useState(false);
  const [chequeredCountdown, setChequeredCountdown] = useState<number | null>(null);

  const [lobbyStatus, setLobbyStatus] = useState<'IDLE' | 'CONNECTING' | 'CONNECTED' | 'ERROR' | 'UNCONFIGURED'>(() =>
    isSupabaseConfigured ? 'IDLE' : 'UNCONFIGURED'
  );
  const [publicRooms, setPublicRooms] = useState<LobbyRoomInfo[]>([]);
  const [activeRoom, setActiveRoom] = useState<ActiveRoomState | null>(null);
  const [roomNameInput, setRoomNameInput] = useState<string>('');
  const [mpError, setMpError] = useState<string | null>(null);
  const [mpBusy, setMpBusy] = useState<boolean>(false);
  const [inMultiplayerRace, setInMultiplayerRace] = useState<boolean>(false);

  const raceStartedRef = useRef(raceStarted);
  raceStartedRef.current = raceStarted;

  const activeCircuit = getCircuitConfig(circuit);
  const isMultiplayerHost = !!activeRoom && activeRoom.hostId === mpManager.getPlayerId();

  useEffect(() => {
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
      if (e.code === 'Escape') {
        setShowHallOfFameModal(false);
        setShowWeatherMenu(false);
        return;
      }
      if (e.code === 'KeyN' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setShowMinimap((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cleanupHud = initHud();
    const cleanupEngine = startMonacoEngine(canvas, {
      initialWeather: 'cerah',
      initialCircuit: 'monaco-gp',
      onReady: (ctrl) => {
        controllerRef.current = ctrl;
      },
      onWebGLError: (msg) => setWebglError(msg),
      onChequeredCountdown: (sec) => setChequeredCountdown(sec),
      onRaceFinish: (result) => {
        setFinishResult(result);
        setSavedRecordId(null);
        setSavedDriverName(null);
        setChequeredCountdown(null);
        if (result) {
          setShowHallOfFameModal(false);
          setShowWeatherMenu(false);
          setDriverName((prev) => prev || loadLastDriverName());
        }
      },
    });

    return () => {
      controllerRef.current = null;
      cleanupEngine();
      cleanupHud();
    };
  }, []);

  useEffect(() => {
    if (!finishResult) return;
    if (finishResult.isForcedFinish) {
      const titleEl = document.getElementById('finish-title');
      const forcedTitle = `P${finishResult.playerPosition} — ${finishResult.gapText || 'TIME EXPIRED'}`;
      if (titleEl && titleEl.textContent !== forcedTitle) {
        titleEl.textContent = forcedTitle;
      }
    }
    if (savedDriverName) {
      applyDriverNameToFinishDom(savedDriverName);
    }
    const podiumEl = document.getElementById('podium');
    const rowsEl = document.getElementById('finish-rows');
    const titleEl = document.getElementById('finish-title');
    const observer = new MutationObserver(() => {
      if (finishResult.isForcedFinish && titleEl) {
        const forcedTitle = `P${finishResult.playerPosition} — ${finishResult.gapText || 'TIME EXPIRED'}`;
        if (titleEl.textContent !== forcedTitle) titleEl.textContent = forcedTitle;
      }
      if (savedDriverName) {
        applyDriverNameToFinishDom(savedDriverName);
      }
    });
    if (podiumEl) observer.observe(podiumEl, { childList: true, subtree: true });
    if (rowsEl) observer.observe(rowsEl, { childList: true, subtree: true });
    if (finishResult.isForcedFinish && titleEl) {
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
    return () => observer.disconnect();
  }, [finishResult, savedDriverName]);

  const launchMultiplayerRace = useCallback(
    (payload: RaceStartPayload) => {
      initAudio();
      setShowWeatherMenu(false);
      setShowHallOfFameModal(false);
      setFinishResult(null);
      setSavedRecordId(null);
      setSavedDriverName(null);
      setChequeredCountdown(null);
      setMpError(null);
      setCircuit(payload.circuit);
      setWeather(payload.weather);
      setRecords(loadStoredRecords(getCircuitConfig(payload.circuit).recordsStorageKey));
      setInMultiplayerRace(true);
      setRaceStarted(true);

      const myId = mpManager.getPlayerId();
      const mySlot = payload.slots.find((s) => s.playerId === myId);
      const effectiveName =
        mySlot?.name || driverName.trim() || `DRIVER-${myId.slice(0, 4).toUpperCase()}`;
      const effectiveColor = mySlot?.liveryColor || liveryColor || '#e10600';
      const isHostNow = payload.hostId === myId || mpManager.isHost();

      const mpOpts: MultiplayerStartOptions = {
        isHost: isHostNow,
        localPlayerId: myId,
        driverName: effectiveName,
        liveryColor: effectiveColor,
        slots: payload.slots,
        startAtMs: payload.startAtMs,
        onSendPlayerTelemetry: (pkt) => mpManager.sendPlayerTelemetry(pkt),
        onSendAiTelemetry: (pkt) => mpManager.sendAiTelemetry(pkt),
        onHostRestart: () => {
          void mpManager.startRaceForAll(true).then((restartPayload) => {
            if (restartPayload) launchMultiplayerRaceRef.current(restartPayload);
          });
        },
      };

      controllerRef.current?.startMultiplayerRace(payload.weather, payload.circuit, mpOpts);
    },
    [driverName, liveryColor, mpManager]
  );

  const launchMultiplayerRaceRef = useRef(launchMultiplayerRace);
  launchMultiplayerRaceRef.current = launchMultiplayerRace;

  const getRoomCallbacks = useCallback(
    () => ({
      onRoomUpdate: (room: ActiveRoomState) => {
        setActiveRoom(room);
        if (!raceStartedRef.current) {
          setCircuit(room.circuit);
          setWeather(room.weather);
          setRecords(loadStoredRecords(getCircuitConfig(room.circuit).recordsStorageKey));
          controllerRef.current?.setCircuit(room.circuit);
          controllerRef.current?.setWeather(room.weather);
        }
      },
      onRaceStart: (payload: RaceStartPayload) => {
        launchMultiplayerRaceRef.current(payload);
      },
      onRaceRestart: (payload: RaceStartPayload) => {
        launchMultiplayerRaceRef.current(payload);
      },
      onPlayerTelemetry: (pkt: Parameters<EngineController['receiveRemotePlayerTelemetry']>[0]) => {
        controllerRef.current?.receiveRemotePlayerTelemetry(pkt);
      },
      onAiTelemetry: (pkt: Parameters<EngineController['receiveRemoteAiTelemetry']>[0]) => {
        controllerRef.current?.receiveRemoteAiTelemetry(pkt);
      },
      onPlayerLeave: (playerId: string) => {
        controllerRef.current?.removeRemotePlayer(playerId);
      },
      onError: (msg: string) => {
        setMpError(msg);
      },
    }),
    []
  );

  // Sync driver identity to MultiplayerManager + 3D preview car
  useEffect(() => {
    mpManager.setProfile(driverName, liveryColor);
    if (!raceStarted) {
      if (gameMode === 'multi') {
        const displayName = driverName.trim() || `DRIVER-${mpManager.getPlayerId().slice(0, 4).toUpperCase()}`;
        controllerRef.current?.setPlayerProfile(displayName, liveryColor);
      } else {
        controllerRef.current?.setPlayerProfile('YOU', '#e10600');
      }
    }
  }, [driverName, liveryColor, gameMode, raceStarted, mpManager]);

  // Connect/disconnect global Supabase Presence lobby when browsing Multiplayer rooms
  useEffect(() => {
    if (gameMode === 'multi' && !raceStarted) {
      void mpManager.connectLobby({
        onRoomsChange: (rooms) => setPublicRooms(rooms),
        onStatusChange: (status) => setLobbyStatus(status),
      });
    } else if (gameMode === 'single' && !activeRoom && !inMultiplayerRace) {
      void mpManager.disconnectLobby();
    }
  }, [gameMode, raceStarted, activeRoom, inMultiplayerRace, mpManager]);

  // Clean up all Realtime channels on unmount
  useEffect(() => {
    return () => {
      void mpManager.dispose();
    };
  }, [mpManager]);

  const handleSelectCircuit = (cId: CircuitId) => {
    setCircuit(cId);
    setRecords(loadStoredRecords(getCircuitConfig(cId).recordsStorageKey));
    setSavedRecordId(null);
    setSavedDriverName(null);
    controllerRef.current?.setCircuit(cId);
    if (gameMode === 'multi' && activeRoom && isMultiplayerHost) {
      void mpManager.updateHostRoomConfig(cId, weather);
    }
  };

  const handleSelectStartWeather = (w: WeatherType) => {
    setWeather(w);
    controllerRef.current?.setWeather(w);
    if (gameMode === 'multi' && activeRoom && isMultiplayerHost) {
      void mpManager.updateHostRoomConfig(circuit, w);
    }
  };

  const handleDriverNameChange = (val: string) => {
    const cleaned = val.slice(0, 16);
    setDriverName(cleaned);
    saveLastDriverName(cleaned);
  };

  const handleSelectLivery = (hex: string) => {
    setLiveryColor(hex);
    saveLastLiveryColor(hex);
  };

  const handleCreatePublicRoom = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!isSupabaseConfigured || mpBusy) return;
    setMpBusy(true);
    setMpError(null);
    try {
      const created = await mpManager.createPublicRoom(
        {
          roomName: roomNameInput,
          circuit,
          weather,
          driverName,
          liveryColor,
        },
        getRoomCallbacks()
      );
      if (created) {
        setActiveRoom(created);
      }
    } finally {
      setMpBusy(false);
    }
  };

  const handleJoinPublicRoom = async (room: LobbyRoomInfo) => {
    if (!isSupabaseConfigured || mpBusy) return;
    if (room.playerCount >= room.maxPlayers) {
      setMpError('This room is already full (8/8 drivers).');
      return;
    }
    setMpBusy(true);
    setMpError(null);
    try {
      const joined = await mpManager.joinPublicRoom(
        room,
        { driverName, liveryColor },
        getRoomCallbacks()
      );
      if (joined) {
        setActiveRoom(joined);
        setCircuit(joined.circuit);
        setWeather(joined.weather);
        setRecords(loadStoredRecords(getCircuitConfig(joined.circuit).recordsStorageKey));
        controllerRef.current?.setCircuit(joined.circuit);
        controllerRef.current?.setWeather(joined.weather);
      }
    } finally {
      setMpBusy(false);
    }
  };

  const handleLeaveMultiplayerRoom = async () => {
    setMpError(null);
    await mpManager.leaveRoom();
    setActiveRoom(null);
    if (inMultiplayerRace) {
      controllerRef.current?.stopMultiplayerToSinglePreview();
      setInMultiplayerRace(false);
      setRaceStarted(false);
      setFinishResult(null);
      setChequeredCountdown(null);
      setShowWeatherMenu(false);
    }
  };

  const handleHostStartRaceForAll = async () => {
    if (!activeRoom || !isMultiplayerHost || mpBusy) return;
    setMpBusy(true);
    setMpError(null);
    try {
      const payload = await mpManager.startRaceForAll(false);
      if (payload) {
        launchMultiplayerRace(payload);
      }
    } finally {
      setMpBusy(false);
    }
  };

  const handleHostRestartRaceForAll = async (overrideWeather?: WeatherType) => {
    if (!activeRoom || !isMultiplayerHost) return;
    initAudio();
    const targetWeather = overrideWeather ?? weather;
    if (overrideWeather && overrideWeather !== weather) {
      setWeather(overrideWeather);
      await mpManager.updateHostRoomConfig(circuit, overrideWeather, 'RACING');
    }
    const payload = await mpManager.startRaceForAll(true);
    if (payload) {
      launchMultiplayerRace(payload);
    }
  };

  const handleStartRace = () => {
    initAudio();
    setShowWeatherMenu(false);
    setInMultiplayerRace(false);
    setRaceStarted(true);
    controllerRef.current?.setPlayerProfile('YOU', '#e10600');
    controllerRef.current?.startRace(weather, circuit);
  };

  const handleRestartWithWeather = (w: WeatherType) => {
    if (inMultiplayerRace) {
      if (isMultiplayerHost) {
        void handleHostRestartRaceForAll(w);
      }
      return;
    }
    initAudio();
    setWeather(w);
    setShowWeatherMenu(false);
    setRaceStarted(true);
    controllerRef.current?.restartWithWeather(w, circuit);
  };

  const activeWeatherOpt = WEATHER_OPTIONS.find((opt) => opt.id === weather) || WEATHER_OPTIONS[0];

  const handleSaveRecord = (e?: FormEvent) => {
    e?.preventDefault();
    if (!finishResult || finishResult.playerPosition > 3 || savedRecordId) return;
    const cleaned = driverName.trim().slice(0, 16);
    if (!cleaned) {
      nameInputRef.current?.focus();
      return;
    }
    const pos = finishResult.playerPosition as 1 | 2 | 3;
    const newEntry: PodiumRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: cleaned,
      position: pos,
      bestLapTime: finishResult.bestLapTime,
      totalTime: finishResult.totalRaceTime,
      createdAt: Date.now(),
    };
    const nextRecords = sortAndTrimRecords([...records, newEntry]);
    setRecords(nextRecords);
    saveStoredRecords(activeCircuit.recordsStorageKey, nextRecords);
    saveLastDriverName(cleaned);
    setDriverName(cleaned);
    setSavedRecordId(newEntry.id);
    setSavedDriverName(cleaned);
    applyDriverNameToFinishDom(cleaned);
  };

  const renderHallOfFameRows = (compact: boolean) => {
    if (records.length === 0) {
      return (
        <div className="py-4 px-3 text-center text-[11px] font-semibold tracking-[0.14em] text-[#f2efe6]/55">
          NO PODIUM RECORDS YET — FINISH TOP 3 TO SET A {activeCircuit.gpTitle} RECORD
        </div>
      );
    }
    return (
      <div className={compact ? 'max-h-[144px] overflow-y-auto divide-y divide-white/10 pr-1' : 'max-h-[340px] overflow-y-auto divide-y divide-white/10 pr-1'}>
        <div className="grid grid-cols-[34px_1fr_44px_82px_82px] items-center gap-2 px-2 py-1 text-[9px] font-bold tracking-[0.18em] text-[#f2efe6]/50 uppercase sticky top-0 bg-[#0d121a]/95">
          <span>RNK</span>
          <span>DRIVER</span>
          <span className="text-center">FIN</span>
          <span className="text-right">BEST LAP</span>
          <span className="text-right">TOTAL</span>
        </div>
        {records.map((rec, idx) => {
          const isNew = rec.id === savedRecordId;
          return (
            <div
              key={rec.id}
              className={`grid grid-cols-[34px_1fr_44px_82px_82px] items-center gap-2 px-2 py-1.5 text-xs rounded ${
                isNew
                  ? 'bg-[#22ff88]/15 ring-1 ring-[#22ff88]/50'
                  : idx === 0
                    ? 'bg-[#d8b24a]/10'
                    : ''
              }`}
            >
              <span className="font-black italic text-[13px] text-[#f2efe6]/75">#{idx + 1}</span>
              <span className="font-bold tracking-wide text-[#f2efe6] truncate text-left">
                {rec.name}
              </span>
              <span
                className={`mx-auto inline-flex items-center justify-center w-8 h-5 rounded text-[10px] font-black italic ${getMedalBadgeClass(
                  rec.position
                )}`}
              >
                P{rec.position}
              </span>
              <span className="text-right font-mono text-[11px] font-bold text-[#b36bff] tabular-nums">
                {formatRaceTime(rec.bestLapTime)}
              </span>
              <span className="text-right font-mono text-[11px] font-bold text-[#d8b24a] tabular-nums">
                {formatRaceTime(rec.totalTime)}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  if (webglError) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-[#0b0f16] text-[#f2efe6] p-6 text-center">
        <div className="max-w-md space-y-3">
          <div className="text-2xl font-black italic tracking-wider text-[#e10600]">{activeCircuit.gpTitle}</div>
          <p className="text-sm opacity-80">{webglError}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        id="game-canvas"
        aria-label={`${activeCircuit.gpTitle} 3D race view`}
      />

      {/* Boot / loading gate */}
      <div id="boot">
        <div id="boot-mark">{activeCircuit.bootMark}</div>
        <div id="boot-title">{activeCircuit.gpTitle}</div>
        <div id="boot-sub">STREET CIRCUIT CHALLENGE</div>
        <div id="boot-track"><div id="boot-bar" /></div>
        <div id="boot-note">{activeCircuit.bootNote}</div>
        <button id="boot-retry" onClick={() => window.location.reload()} hidden>
          RETRY
        </button>
      </div>

      {/* Broadcast HUD overlay */}
      <div id="hud">
        <div className="vignette" aria-hidden="true" />
        <div id="flash" aria-hidden="true" />

        {/* Top-left · live leaderboard tower */}
        <section id="tower" className="panel" aria-label="Live standings">
          <header className="panel-head">
            <span className="live-dot" aria-hidden="true" />
            <span className="head-title">{activeCircuit.gpTitle}</span>
            <span className="live-tag">LIVE</span>
          </header>
          <div id="tower-rows" />
          <footer id="tower-foot">
            {activeCircuit.circuitTitle} ·{' '}
            <span id="tower-laps">
              {activeCircuit.totalLaps === 1 ? `1 STAGE · ${activeCircuit.lengthLabel}` : `${activeCircuit.totalLaps} LAPS`}
            </span>
          </footer>
        </section>

        {/* Top-right · lap / timing / start gantry */}
        <section id="lap-panel" className="panel" aria-label="Lap and timing">
          <header className="panel-head">
            <span className="head-title" id="session-label">RACE</span>
            <button id="audio-toggle" aria-pressed="true" title="Mute / unmute (M)">
              <span id="audio-icon">🔊</span>
              <span id="audio-text">AUDIO ON</span>
            </button>
          </header>
          <div id="lap-count">
            {activeCircuit.totalLaps === 1 ? 'STAGE' : 'LAP'} <span id="lap-current">1</span>
            <span className="lap-sep">/</span>
            <span id="lap-total">{activeCircuit.totalLaps}</span>
          </div>
          <div className="timer-row">
            <label>CURRENT</label>
            <span id="lap-time" className="mono">0:00.000</span>
          </div>
          <div className="timer-row">
            <label>BEST</label>
            <span id="best-time" className="mono">--:--.---</span>
          </div>
          <div className="timer-row">
            <label>LAST</label>
            <span id="last-time" className="mono">--:--.---</span>
          </div>
          <div id="gantry-wrap">
            <div id="gantry" aria-label="Start lights">
              <div className="gantry-light" />
              <div className="gantry-light" />
              <div className="gantry-light" />
              <div className="gantry-light" />
              <div className="gantry-light" />
            </div>
            <div id="gantry-status">START SEQUENCE</div>
          </div>
        </section>

        {/* Bottom-left · live minimap + [N] MAP toggle */}
        {showMinimap ? (
          <section id="minimap-panel" className="panel" aria-label="Circuit map">
            <div id="minimap-head">
              <span id="checkpoint-name">START / FINISH</span>
              <button
                type="button"
                id="minimap-toggle"
                onClick={() => setShowMinimap(false)}
                aria-pressed="true"
                title="Hide track minimap (N)"
              >
                [N] MAP
              </button>
            </div>
            <canvas id="minimap" />
            <div id="minimap-meta">
              <span id="minimap-label">{activeCircuit.circuitTitle} - {activeCircuit.lengthLabel}</span>
            </div>
          </section>
        ) : (
          <button
            type="button"
            id="minimap-restore"
            className="panel"
            onClick={() => setShowMinimap(true)}
            aria-pressed="false"
            title="Show track minimap (N)"
          >
            [N] MAP
          </button>
        )}

        {/* Bottom-right · telemetry cluster */}
        <section id="telemetry" className="panel" aria-label="Car telemetry">
          <div id="rpm-bar" aria-label="RPM shift lights" />
          <div id="tele-main">
            <div id="gear-box">
              <label>GEAR</label>
              <div id="gear-value">1</div>
            </div>
            <div id="speed-box">
              <div id="speed-value">0</div>
              <div id="speed-unit">KM/H</div>
            </div>
            <div id="drs-badge">DRS</div>
          </div>
          <div id="pedal-bars">
            <div className="pedal">
              <label>THR</label>
              <div className="pedal-track">
                <div id="throttle-bar" />
              </div>
            </div>
            <div className="pedal">
              <label>BRK</label>
              <div className="pedal-track">
                <div id="brake-bar" />
              </div>
            </div>
          </div>
          <div id="health-wrap">
            <div id="health-head">
              <span id="health-label">CAR INTEGRITY</span>
              <span id="health-value" className="mono">100%</span>
            </div>
            <div id="health-track">
              <div id="health-fill" />
            </div>
          </div>
        </section>

        {/* Bottom-center · control legend */}
        <div id="controls-hint">
          <span><b>W/↑</b> THROTTLE</span>
          <span><b>S/↓</b> BRAKE</span>
          <span><b>A·D</b> STEER</span>
          <span><b>SPACE</b> DRS</span>
          <span><b>C</b> CAMERA</span>
          <span><b>N</b> MAP</span>
          <span><b>R</b> RESET</span>
          <span><b>M</b> MUTE</span>
        </div>

        {/* Center · race announcements */}
        <div id="announce" aria-live="polite">
          <div id="announce-text" />
          <div id="announce-sub" />
        </div>

        {/* Top-center · Hall of Fame / Top Circuit Records trophy button */}
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            setShowWeatherMenu(false);
            setShowHallOfFameModal(true);
          }}
          title="Circuit Hall of Fame — Top Records"
          aria-label="Open Circuit Hall of Fame"
          className="pointer-events-auto fixed top-[14px] left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0b0f16]/80 border border-[rgba(242,239,230,0.18)] hover:border-[#d8b24a] hover:bg-[#141b26]/90 text-[#f2efe6] shadow-lg transition cursor-pointer"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-3.5 h-3.5 text-[#d8b24a] shrink-0"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5 3h14v3h3v3c0 2.5-1.7 4.6-4 5.1-.8 1.8-2.4 3.1-4.5 3.6V20h3.5v2H7v-2h3.5v-2.3c-2.1-.5-3.7-1.8-4.5-3.6C3.7 13.6 2 11.5 2 9V6h3V3zm0 5H4v1c0 1.4.8 2.6 2 3.1V8zm14 0v4.1c1.2-.5 2-1.7 2-3.1V8h-2z" />
          </svg>
          <span className="text-[10px] font-black tracking-[0.18em]">RECORDS</span>
          {records.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-[#d8b24a]/20 text-[#d8b24a] text-[9px] font-black tabular-nums">
              {records.length}
            </span>
          )}
        </button>

        {/* Top-right · Active Weather Badge (+ Multiplayer Room Leave / Single Player Weather Switch) */}
        {raceStarted && (
          <div className="pointer-events-auto fixed top-[14px] right-[126px] sm:right-[194px] z-20 flex items-center gap-1.5">
            {inMultiplayerRace && (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  void handleLeaveMultiplayerRoom();
                }}
                title="Leave online room and return to lobby"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#2a0c10]/88 border border-[#ff2d1a]/55 hover:border-[#ff2d1a] hover:bg-[#3f1116] text-[#f2efe6] shadow-lg transition cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#22ff88] animate-pulse" aria-hidden="true" />
                <span className="hidden md:inline text-[10px] font-black tracking-[0.14em] text-[#f2efe6]/85">
                  #{activeRoom?.roomId || 'LIVE'}
                </span>
                <span className="text-[10px] font-black tracking-[0.14em] text-[#ff6a55]">LEAVE</span>
              </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                if (inMultiplayerRace) return;
                setShowWeatherMenu((prev) => !prev);
              }}
              aria-expanded={!inMultiplayerRace && showWeatherMenu}
              title={
                inMultiplayerRace
                  ? 'Active room weather'
                  : 'Track weather & grip — click to switch weather and restart'
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0b0f16]/82 border border-[rgba(242,239,230,0.18)] text-[#f2efe6] shadow-lg transition ${
                inMultiplayerRace ? 'cursor-default' : 'hover:border-[#00d2be] cursor-pointer'
              }`}
            >
              <WeatherIcon type={activeWeatherOpt.id} className={`w-3.5 h-3.5 shrink-0 ${activeWeatherOpt.iconColorCls}`} />
              <span className="text-[10px] font-black tracking-[0.14em]">{activeWeatherOpt.shortLabel}</span>
              <span className={`hidden sm:inline-block px-1.5 py-0.5 rounded border text-[8px] font-black tracking-[0.1em] ${activeWeatherOpt.badgeCls}`}>
                {activeWeatherOpt.gripBadge.split('·')[0].trim()}
              </span>
            </button>

            {!inMultiplayerRace && showWeatherMenu && (
              <div className="absolute top-full right-0 mt-1.5 w-[228px] rounded-xl bg-[#0d121a]/95 border border-white/20 p-2 shadow-2xl backdrop-blur-md">
                <div className="px-2 pb-1.5 mb-1.5 border-b border-white/10 text-[9px] font-black tracking-[0.18em] text-[#f2efe6]/55">
                  SWITCH WEATHER &amp; RESTART
                </div>
                <div className="space-y-1">
                  {WEATHER_OPTIONS.map((opt) => {
                    const isCurrent = opt.id === weather;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          handleRestartWithWeather(opt.id);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-left transition cursor-pointer ${
                          isCurrent
                            ? 'border-[#00d2be]/70 bg-[#00d2be]/15 text-white'
                            : 'border-white/10 bg-white/[0.03] hover:bg-white/10 text-[#f2efe6]/85'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <WeatherIcon type={opt.id} className={`w-4 h-4 shrink-0 ${opt.iconColorCls}`} />
                          <div className="min-w-0">
                            <div className="text-[10px] font-black tracking-[0.12em] truncate">{opt.label}</div>
                            <div className="text-[9px] text-[#f2efe6]/55 truncate">{opt.subtitle}</div>
                          </div>
                        </div>
                        <span className="text-[8px] font-black tracking-[0.1em] text-[#00d2be] shrink-0">
                          {isCurrent ? 'ACTIVE' : 'GO'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chequered Flag post-leader countdown warning banner */}
        {chequeredCountdown !== null && !finishResult && (
          <div
            role="status"
            aria-live="polite"
            className={`pointer-events-none fixed top-[52px] left-1/2 -translate-x-1/2 z-20 flex flex-col items-center px-4 py-2 rounded-lg border backdrop-blur-md shadow-2xl ${
              chequeredCountdown <= 5
                ? 'bg-[#2a0909]/90 border-[#ff2d1a]/80 shadow-[0_0_26px_rgba(255,45,26,0.45)] animate-pulse'
                : 'bg-[#0b0f16]/90 border-[#ffb020]/75 shadow-[0_0_24px_rgba(255,176,32,0.28)]'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className="grid grid-cols-2 grid-rows-2 w-3 h-3 rounded-[2px] border border-white/40 overflow-hidden shrink-0"
                aria-hidden="true"
              >
                <span className="bg-[#f2efe6]" />
                <span className="bg-[#0b0f16]" />
                <span className="bg-[#0b0f16]" />
                <span className="bg-[#f2efe6]" />
              </span>
              <span
                className={`text-xs font-black italic tracking-[0.16em] tabular-nums ${
                  chequeredCountdown <= 5 ? 'text-[#ff6a55]' : 'text-[#ffb020]'
                }`}
              >
                LEADER FINISHED — {chequeredCountdown}s REMAINING
              </span>
            </div>
            <span className="mt-0.5 text-[9px] font-bold tracking-[0.22em] text-[#f2efe6]/70">
              CHEQUERED FLAG · CROSS FINISH LINE TO COMPLETE RACE
            </span>
          </div>
        )}

        {/* Touch controls (coarse pointers only) */}
        <div id="touch">
          <div id="touch-left">
            <button className="tbtn" data-key="KeyA" aria-label="Steer left">◀</button>
            <button className="tbtn" data-key="KeyD" aria-label="Steer right">▶</button>
          </div>
          <div id="touch-right">
            <button className="tbtn small drs" data-key="Space" aria-label="DRS">DRS</button>
            <button className="tbtn brake" data-key="KeyS" aria-label="Brake">BRK</button>
            <button className="tbtn gas" data-key="KeyW" aria-label="Throttle">GAS</button>
          </div>
          <div id="touch-meta">
            <button className="tbtn tiny" data-key="KeyC" aria-label="Camera">CAM</button>
            <button className="tbtn tiny" data-key="KeyR" aria-label="Reset">RST</button>
          </div>
        </div>
      </div>

      {/* Standalone Circuit Hall of Fame modal (via HUD trophy button) */}
      {showHallOfFameModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Circuit Hall of Fame"
          onClick={() => setShowHallOfFameModal(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-[#05080c]/80 backdrop-blur-sm p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[540px] rounded-[14px] bg-[#0d121a]/95 border border-[rgba(242,239,230,0.22)] border-t-[3px] border-t-[#d8b24a] p-5 shadow-2xl text-[#f2efe6]"
          >
            <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4 text-[#d8b24a]"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M5 3h14v3h3v3c0 2.5-1.7 4.6-4 5.1-.8 1.8-2.4 3.1-4.5 3.6V20h3.5v2H7v-2h3.5v-2.3c-2.1-.5-3.7-1.8-4.5-3.6C3.7 13.6 2 11.5 2 9V6h3V3zm0 5H4v1c0 1.4.8 2.6 2 3.1V8zm14 0v4.1c1.2-.5 2-1.7 2-3.1V8h-2z" />
                </svg>
                <span className="text-xs font-black tracking-[0.22em] text-[#d8b24a]">
                  {activeCircuit.gpTitle} HALL OF FAME — TOP RECORDS
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowHallOfFameModal(false)}
                className="px-2 py-0.5 rounded border border-white/20 text-[11px] font-bold text-[#f2efe6]/75 hover:text-white hover:border-white/40 cursor-pointer"
              >
                ✕
              </button>
            </div>
            {renderHallOfFameRows(false)}
          </div>
        </div>
      )}

      {/* Chequered flag · podium modal */}
      <div id="finish-modal" role="dialog" aria-modal="true" aria-labelledby="finish-title">
        <div id="finish-card" className="panel">
          <div id="confetti" aria-hidden="true" />
          <div id="finish-kicker">CHEQUERED FLAG · {activeCircuit.gpTitle}</div>
          <h1 id="finish-title">VICTORY</h1>
          <div id="finish-sub">
            {activeCircuit.circuitTitle} ·{' '}
            {activeCircuit.totalLaps === 1 ? `${activeCircuit.lengthLabel} STAGE` : `${activeCircuit.totalLaps} LAPS`}
          </div>
          <div id="podium" />

          {/* Podium Name Entry Form (only when playerPosition <= 3 and finished full race) */}
          {finishResult && !finishResult.isForcedFinish && finishResult.playerPosition <= 3 && (
            <form
              onSubmit={handleSaveRecord}
              className="mb-4 rounded-lg border border-[#d8b24a]/40 bg-[#070a10]/85 px-3.5 py-2.5 text-left"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-black tracking-[0.2em] text-[#d8b24a]">
                  PODIUM RECORD — ENTER YOUR NAME
                </span>
                {savedRecordId && (
                  <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-[#22ff88]/20 border border-[#22ff88]/50 text-[10px] font-black tracking-[0.14em] text-[#22ff88]">
                    ✓ RECORD SAVED!
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={nameInputRef}
                  type="text"
                  maxLength={16}
                  value={driverName}
                  disabled={!!savedRecordId}
                  onChange={(e) => setDriverName(e.target.value.slice(0, 16))}
                  onKeyDown={(e) => {
                    e.nativeEvent.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveRecord();
                    }
                  }}
                  onKeyUp={(e) => e.nativeEvent.stopPropagation()}
                  placeholder="DRIVER NAME"
                  aria-label="Driver name for podium record"
                  className="flex-1 min-w-0 rounded-md bg-[#111722] border border-white/20 px-3 py-1.5 text-xs font-bold tracking-[0.08em] text-[#f2efe6] placeholder:text-[#f2efe6]/35 focus:outline-none focus:border-[#d8b24a] disabled:opacity-70"
                />
                <button
                  type="submit"
                  disabled={!!savedRecordId || driverName.trim().length === 0}
                  className="shrink-0 rounded-md px-3.5 py-1.5 text-[11px] font-black tracking-[0.16em] text-[#0b0f16] bg-gradient-to-r from-[#f3d479] to-[#d8b24a] hover:brightness-110 active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition"
                >
                  {savedRecordId ? 'SAVED' : 'SAVE RECORD'}
                </button>
              </div>
            </form>
          )}

          <div id="finish-rows" />

          {/* Persistent Circuit Hall of Fame */}
          <div className="mt-3.5 rounded-lg border border-white/15 bg-[#070a10]/75 px-3 py-2.5 text-left">
            <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-white/10">
              <span className="text-[10px] font-black tracking-[0.2em] text-[#d8b24a]">
                {activeCircuit.gpTitle} HALL OF FAME — TOP RECORDS
              </span>
              <span className="text-[9px] font-bold tracking-[0.14em] text-[#f2efe6]/50">
                TOP {MAX_HALL_OF_FAME}
              </span>
            </div>
            {renderHallOfFameRows(true)}
          </div>

          {/* Weather switcher row before Restart (Single Player, or Host in Online Multiplayer) */}
          {(!inMultiplayerRace || isMultiplayerHost) && (
            <div className="mt-3.5 rounded-lg border border-white/12 bg-[#070a10]/65 px-3 py-2 text-left">
              <div className="text-[9px] font-black tracking-[0.2em] text-[#f2efe6]/55 mb-1.5">
                {inMultiplayerRace ? 'HOST: RESTART FOR ALL IN DIFFERENT WEATHER' : 'RESTART IN DIFFERENT WEATHER'}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {WEATHER_OPTIONS.map((opt) => {
                  const isSelected = opt.id === weather;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        handleRestartWithWeather(opt.id);
                      }}
                      className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border text-[10px] font-black tracking-[0.1em] transition cursor-pointer ${
                        isSelected
                          ? 'border-[#00d2be] bg-[#00d2be]/15 text-white'
                          : 'border-white/15 bg-white/[0.04] hover:bg-white/10 text-[#f2efe6]/80'
                      }`}
                    >
                      <WeatherIcon type={opt.id} className={`w-3.5 h-3.5 shrink-0 ${opt.iconColorCls}`} />
                      <span className="truncate">{opt.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {inMultiplayerRace && !isMultiplayerHost && (
            <div className="mt-3.5 rounded-lg border border-[#00d2be]/30 bg-[#00d2be]/10 px-3 py-2 text-[11px] font-bold tracking-[0.14em] text-[#5eead4]">
              ONLINE ROOM #{activeRoom?.roomId} · WAITING FOR HOST TO RESTART…
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
            <button
              id="race-again"
              hidden={inMultiplayerRace && !isMultiplayerHost}
            >
              {inMultiplayerRace ? 'RESTART FOR ALL' : 'RACE AGAIN'} <span className="key-cap">R</span>
            </button>
            {inMultiplayerRace && (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  void handleLeaveMultiplayerRoom();
                }}
                className="px-5 py-2.5 rounded-lg border border-[#ff2d1a]/55 bg-[#2a0c10]/85 hover:bg-[#3f1116] text-xs font-black tracking-[0.18em] text-[#f2efe6] transition cursor-pointer"
              >
                LEAVE ONLINE ROOM
              </button>
            )}
          </div>
        </div>
      </div>

      {/* DNF · terminal car damage Game Over modal */}
      <div id="gameover-modal" role="dialog" aria-modal="true" aria-labelledby="gameover-title">
        <div id="gameover-card" className="panel">
          <div id="gameover-kicker">TERMINAL CAR DAMAGE · {activeCircuit.gpTitle}</div>
          <h1 id="gameover-title">GAME OVER — DNF</h1>
          <div id="gameover-sub">CHASSIS INTEGRITY FAILED · RETIRED FROM RACE</div>
          <div id="dnf-stats">
            <div className="dnf-stat">
              <label>{activeCircuit.totalLaps === 1 ? 'STAGE PROGRESS' : 'LAP REACHED'}</label>
              <span id="dnf-lap" className="mono">
                {activeCircuit.totalLaps === 1 ? 'STAGE 1 / 1' : `LAP 1 / ${activeCircuit.totalLaps}`}
              </span>
            </div>
            <div className="dnf-stat">
              <label>SURVIVAL TIME</label>
              <span id="dnf-time" className="mono">0:00.000</span>
            </div>
            <div className="dnf-stat">
              <label>POSITION</label>
              <span id="dnf-pos" className="mono">P8</span>
            </div>
          </div>

          {(!inMultiplayerRace || isMultiplayerHost) && (
            <div className="mt-3.5 rounded-lg border border-white/12 bg-[#070a10]/65 px-3 py-2 text-left">
              <div className="text-[9px] font-black tracking-[0.2em] text-[#f2efe6]/55 mb-1.5">
                {inMultiplayerRace ? 'HOST: RESTART FOR ALL IN DIFFERENT WEATHER' : 'RESTART IN DIFFERENT WEATHER'}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {WEATHER_OPTIONS.map((opt) => {
                  const isSelected = opt.id === weather;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        handleRestartWithWeather(opt.id);
                      }}
                      className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border text-[10px] font-black tracking-[0.1em] transition cursor-pointer ${
                        isSelected
                          ? 'border-[#00d2be] bg-[#00d2be]/15 text-white'
                          : 'border-white/15 bg-white/[0.04] hover:bg-white/10 text-[#f2efe6]/80'
                      }`}
                    >
                      <WeatherIcon type={opt.id} className={`w-3.5 h-3.5 shrink-0 ${opt.iconColorCls}`} />
                      <span className="truncate">{opt.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {inMultiplayerRace && !isMultiplayerHost && (
            <div className="mt-3.5 rounded-lg border border-[#00d2be]/30 bg-[#00d2be]/10 px-3 py-2 text-[11px] font-bold tracking-[0.14em] text-[#5eead4]">
              ONLINE ROOM #{activeRoom?.roomId} · WAITING FOR HOST TO RESTART…
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
            <button
              id="dnf-race-again"
              hidden={inMultiplayerRace && !isMultiplayerHost}
            >
              {inMultiplayerRace ? 'RESTART FOR ALL' : 'RACE AGAIN'} <span className="key-cap">R</span>
            </button>
            {inMultiplayerRace && (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  void handleLeaveMultiplayerRoom();
                }}
                className="px-5 py-2.5 rounded-lg border border-[#ff2d1a]/55 bg-[#2a0c10]/85 hover:bg-[#3f1116] text-xs font-black tracking-[0.18em] text-[#f2efe6] transition cursor-pointer"
              >
                LEAVE ONLINE ROOM
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Start Screen · Single Player / Online Multiplayer + Circuit & Weather Selection */}
      {!raceStarted && !webglError && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="start-title"
          className="fixed inset-0 z-30 flex items-center justify-center bg-gradient-to-b from-[#06090f]/74 via-[#06090f]/58 to-[#06090f]/82 backdrop-blur-[3px] p-3 sm:p-4"
        >
          <div className="w-full max-w-[880px] max-h-[94vh] overflow-y-auto rounded-2xl bg-[#0b0f16]/92 border border-white/18 border-t-[3px] border-t-[#e10600] px-4 py-4 sm:px-6 sm:py-5 shadow-[0_28px_80px_rgba(0,0,0,0.78)] text-[#f2efe6]">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded bg-[#e10600]/15 border border-[#e10600]/45 text-[10px] font-black tracking-[0.26em] text-[#ff6a55]">
                {activeCircuit.circuitTitle} · {activeCircuit.lengthLabel} ·{' '}
                {activeCircuit.totalLaps === 1 ? '1 STAGE · POINT-TO-POINT' : `${activeCircuit.totalLaps} LAPS`} · 8 CARS
              </div>
              <h1
                id="start-title"
                className="mt-1.5 text-3xl sm:text-4xl font-black italic tracking-wide bg-gradient-to-r from-[#f2efe6] via-[#d8b24a] to-[#ff2d1a] bg-clip-text text-transparent"
              >
                {activeCircuit.gpTitle}
              </h1>

              {/* Mode Switcher: SINGLE PLAYER / ONLINE MULTIPLAYER */}
              <div className="mt-3 inline-grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#06090f]/85 border border-white/15">
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    if (activeRoom) void handleLeaveMultiplayerRoom();
                    setGameMode('single');
                  }}
                  aria-pressed={gameMode === 'single'}
                  className={`px-4 py-2 rounded-lg text-[11px] font-black tracking-[0.18em] transition cursor-pointer ${
                    gameMode === 'single'
                      ? 'bg-gradient-to-r from-[#ff2d1a] to-[#e10600] text-[#f2efe6] shadow-[0_4px_16px_rgba(225,6,0,0.4)]'
                      : 'text-[#f2efe6]/65 hover:text-[#f2efe6] hover:bg-white/5'
                  }`}
                >
                  SINGLE PLAYER
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setGameMode('multi');
                  }}
                  aria-pressed={gameMode === 'multi'}
                  className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[11px] font-black tracking-[0.18em] transition cursor-pointer ${
                    gameMode === 'multi'
                      ? 'bg-gradient-to-r from-[#00d2be] to-[#0284c7] text-[#06090f] shadow-[0_4px_16px_rgba(0,210,190,0.35)]'
                      : 'text-[#f2efe6]/65 hover:text-[#f2efe6] hover:bg-white/5'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isSupabaseConfigured ? 'bg-[#22ff88]' : 'bg-[#ffb020]'
                    }`}
                    aria-hidden="true"
                  />
                  <span>ONLINE MULTIPLAYER</span>
                  {publicRooms.length > 0 && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-black tabular-nums ${
                        gameMode === 'multi' ? 'bg-[#06090f]/25 text-[#06090f]' : 'bg-[#00d2be]/20 text-[#5eead4]'
                      }`}
                    >
                      {publicRooms.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {gameMode === 'single' ? (
              <>
                {/* 1 · SELECT CIRCUIT */}
                <div className="mt-3.5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[11px] font-black tracking-[0.24em] text-[#00d2be] uppercase">
                      SELECT CIRCUIT
                    </p>
                    <span className="text-[10px] font-bold tracking-[0.14em] text-[#f2efe6]/50">
                      2 STREET CIRCUITS
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {CIRCUIT_LIST.map((cCfg, idx) => {
                      const selected = circuit === cCfg.id;
                      const isSalatiga = cCfg.id === 'salatiga-gp';
                      const activeCls = isSalatiga
                        ? 'border-[#22ff88] bg-gradient-to-b from-[#22ff88]/16 via-[#0d1614]/92 to-[#0b0f16]/95 shadow-[0_0_26px_rgba(34,255,136,0.28)]'
                        : 'border-[#00d2be] bg-gradient-to-b from-[#00d2be]/16 via-[#0c141d]/92 to-[#0b0f16]/95 shadow-[0_0_26px_rgba(0,210,190,0.28)]';
                      const tagCls = isSalatiga
                        ? 'bg-[#22ff88]/18 text-[#4ade80] border-[#22ff88]/45'
                        : 'bg-[#00d2be]/18 text-[#5eead4] border-[#00d2be]/45';

                      return (
                        <button
                          key={cCfg.id}
                          type="button"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            handleSelectCircuit(cCfg.id);
                          }}
                          aria-pressed={selected}
                          className={`group relative flex flex-col justify-between text-left rounded-xl border p-3.5 transition cursor-pointer ${
                            selected
                              ? activeCls
                              : 'border-white/15 bg-[#0e141e]/82 hover:border-white/35 hover:bg-[#131b28]/92'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[10px] font-black tracking-[0.2em] text-[#f2efe6]/55">
                                {idx + 1}. {cCfg.gpTitle}
                              </div>
                              <h2 className="text-sm sm:text-base font-black italic tracking-wide text-[#f2efe6]">
                                {cCfg.circuitTitle}
                              </h2>
                            </div>
                            <span
                              className={`shrink-0 px-2 py-0.5 rounded border text-[9px] font-black tracking-[0.12em] ${
                                selected
                                  ? 'bg-[#22ff88]/20 text-[#22ff88] border-[#22ff88]/55'
                                  : tagCls
                              }`}
                            >
                              {selected ? '✓ SELECTED' : cCfg.lengthLabel}
                            </span>
                          </div>

                          <div className="my-2 rounded-lg bg-[#06090f]/75 border border-white/10 px-2 py-1">
                            <CircuitSvgMap config={cCfg} selected={selected} />
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/10">
                            <span className="text-[11px] font-semibold tracking-[0.03em] text-[#f2efe6]/80">
                              {cCfg.subtitle}
                            </span>
                            <span className={`shrink-0 text-[9px] font-black tracking-[0.14em] ${selected ? 'text-[#22ff88]' : 'text-[#f2efe6]/45'}`}>
                              {selected ? 'PREVIEWING' : 'SELECT'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2 · SELECT WEATHER CONDITIONS */}
                <div className="mt-4">
                  <p className="text-[11px] font-black tracking-[0.24em] text-[#00d2be] uppercase mb-2">
                    SELECT WEATHER CONDITIONS
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {WEATHER_OPTIONS.map((opt) => {
                      const selected = weather === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            handleSelectStartWeather(opt.id);
                          }}
                          aria-pressed={selected}
                          className={`relative flex flex-col justify-between text-left rounded-xl border p-3 transition cursor-pointer ${
                            selected
                              ? opt.activeCardCls
                              : 'border-white/15 bg-[#0e141e]/80 hover:border-white/35 hover:bg-[#131b28]/90'
                          }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <div className={`p-1.5 rounded-lg bg-white/[0.06] border border-white/10 ${opt.iconColorCls}`}>
                                <WeatherIcon type={opt.id} className="w-5 h-5" />
                              </div>
                              <span className={`px-2 py-0.5 rounded border text-[9px] font-black tracking-[0.12em] ${opt.badgeCls}`}>
                                {opt.gripBadge}
                              </span>
                            </div>
                            <h3 className="mt-2 text-sm font-black italic tracking-wide text-[#f2efe6]">
                              {opt.label}
                            </h3>
                            <div className="text-[10px] font-bold tracking-[0.06em] text-[#00d2be]">
                              {opt.subtitle}
                            </div>
                            <p className="mt-1 text-[11px] leading-snug text-[#f2efe6]/70">
                              {opt.description}
                            </p>
                          </div>

                          <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[9px] font-black tracking-[0.16em]">
                            <span className={selected ? 'text-[#22ff88]' : 'text-[#f2efe6]/45'}>
                              {selected ? '✓ SELECTED' : 'CLICK TO PREVIEW'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 pt-3.5 border-t border-white/10">
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 text-[10px] font-bold tracking-[0.12em] text-[#f2efe6]/60">
                    <span><b className="text-[#f2efe6]">W/S</b> THROTTLE·BRAKE</span>
                    <span><b className="text-[#f2efe6]">A/D</b> STEER</span>
                    <span><b className="text-[#f2efe6]">SPACE</b> DRS</span>
                    <span><b className="text-[#f2efe6]">C</b> CAM</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      handleStartRace();
                    }}
                    className="w-full sm:w-auto px-8 py-3 rounded-xl bg-gradient-to-r from-[#ff2d1a] to-[#e10600] text-[#f2efe6] text-sm font-black tracking-[0.24em] shadow-[0_10px_32px_rgba(225,6,0,0.5)] hover:brightness-110 active:scale-95 transition cursor-pointer"
                  >
                    START RACE
                  </button>
                </div>
              </>
            ) : (
              /* ONLINE MULTIPLAYER VIEW */
              <div className="mt-4 space-y-3.5">
                {!isSupabaseConfigured && (
                  <div className="rounded-xl border border-[#ffb020]/55 bg-[#ffb020]/12 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold text-[#fde68a]">
                      Configure <code className="px-1.5 py-0.5 rounded bg-black/40 font-mono">VITE_SUPABASE_URL</code> &amp;{' '}
                      <code className="px-1.5 py-0.5 rounded bg-black/40 font-mono">VITE_SUPABASE_ANON_KEY</code>
                    </div>
                    <span className="text-[10px] font-black tracking-[0.14em] text-[#ffb020]">
                      SINGLE PLAYER READY
                    </span>
                  </div>
                )}

                {mpError && (
                  <div className="rounded-xl border border-[#ff2d1a]/55 bg-[#ff2d1a]/15 px-4 py-2 text-xs font-bold text-[#fca5a5]">
                    {mpError}
                  </div>
                )}

                {/* Driver Identity & Car Livery Picker */}
                <div className="rounded-xl border border-white/15 bg-[#070b12]/80 p-3.5">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-center">
                    <div>
                      <label className="block text-[10px] font-black tracking-[0.2em] text-[#00d2be] mb-1.5">
                        DRIVER NAME
                      </label>
                      <input
                        type="text"
                        maxLength={16}
                        value={driverName}
                        onChange={(e) => handleDriverNameChange(e.target.value)}
                        onKeyDown={(e) => e.nativeEvent.stopPropagation()}
                        onKeyUp={(e) => e.nativeEvent.stopPropagation()}
                        placeholder="ENTER DRIVER NAME"
                        className="w-full rounded-lg bg-[#101723] border border-white/20 px-3 py-2 text-xs font-bold tracking-[0.1em] text-[#f2efe6] placeholder:text-[#f2efe6]/35 focus:outline-none focus:border-[#00d2be]"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10px] font-black tracking-[0.2em] text-[#00d2be]">
                          CAR LIVERY COLOR
                        </span>
                        <span className="text-[10px] font-bold text-[#f2efe6]/60">
                          {LIVERY_PRESETS.find((p) => p.hex === liveryColor)?.label || 'Custom'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {LIVERY_PRESETS.map((preset) => {
                          const isChosen = preset.hex.toLowerCase() === liveryColor.toLowerCase();
                          return (
                            <button
                              key={preset.hex}
                              type="button"
                              title={preset.label}
                              aria-label={`Select ${preset.label} livery`}
                              aria-pressed={isChosen}
                              onClick={(e) => {
                                e.currentTarget.blur();
                                handleSelectLivery(preset.hex);
                              }}
                              style={{ backgroundColor: preset.hex }}
                              className={`w-7 h-7 rounded-lg transition cursor-pointer ${
                                isChosen
                                  ? 'ring-2 ring-[#f2efe6] ring-offset-2 ring-offset-[#070b12] scale-110 shadow-lg'
                                  : 'opacity-75 hover:opacity-100 border border-white/25'
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {!activeRoom ? (
                  /* LOBBY: CREATE ROOM + PUBLIC ROOM BROWSER */
                  <div className="grid grid-cols-1 md:grid-cols-[0.95fr_1.05fr] gap-3.5">
                    {/* Create Public Room Panel */}
                    <form
                      onSubmit={handleCreatePublicRoom}
                      className="rounded-xl border border-white/15 bg-[#0e141e]/85 p-3.5 flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black tracking-[0.22em] text-[#00d2be]">
                            HOST A PUBLIC RACE
                          </span>
                          <span className="text-[9px] font-bold tracking-[0.14em] text-[#f2efe6]/50">
                            UP TO 8 DRIVERS
                          </span>
                        </div>

                        <div>
                          <label className="block text-[9px] font-black tracking-[0.18em] text-[#f2efe6]/55 mb-1">
                            ROOM NAME (OPTIONAL)
                          </label>
                          <input
                            type="text"
                            maxLength={24}
                            value={roomNameInput}
                            onChange={(e) => setRoomNameInput(e.target.value)}
                            onKeyDown={(e) => e.nativeEvent.stopPropagation()}
                            onKeyUp={(e) => e.nativeEvent.stopPropagation()}
                            placeholder="E.G. SALATIGA NIGHT GP"
                            className="w-full rounded-lg bg-[#080c12] border border-white/18 px-3 py-2 text-xs font-bold tracking-[0.06em] text-[#f2efe6] placeholder:text-[#f2efe6]/30 focus:outline-none focus:border-[#00d2be]"
                          />
                        </div>

                        <div>
                          <div className="text-[9px] font-black tracking-[0.18em] text-[#f2efe6]/55 mb-1">
                            CIRCUIT
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {CIRCUIT_LIST.map((cCfg) => {
                              const sel = circuit === cCfg.id;
                              return (
                                <button
                                  key={cCfg.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.currentTarget.blur();
                                    handleSelectCircuit(cCfg.id);
                                  }}
                                  className={`px-2.5 py-2 rounded-lg border text-left transition cursor-pointer ${
                                    sel
                                      ? 'border-[#00d2be] bg-[#00d2be]/15 text-white'
                                      : 'border-white/12 bg-white/[0.03] hover:bg-white/10 text-[#f2efe6]/75'
                                  }`}
                                >
                                  <div className="text-[10px] font-black tracking-[0.1em] truncate">{cCfg.gpTitle}</div>
                                  <div className="text-[9px] text-[#f2efe6]/55 truncate">{cCfg.lengthLabel}</div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <div className="text-[9px] font-black tracking-[0.18em] text-[#f2efe6]/55 mb-1">
                            WEATHER
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {WEATHER_OPTIONS.map((opt) => {
                              const sel = weather === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.currentTarget.blur();
                                    handleSelectStartWeather(opt.id);
                                  }}
                                  className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-black tracking-[0.08em] transition cursor-pointer ${
                                    sel
                                      ? 'border-[#00d2be] bg-[#00d2be]/15 text-white'
                                      : 'border-white/12 bg-white/[0.03] hover:bg-white/10 text-[#f2efe6]/75'
                                  }`}
                                >
                                  <WeatherIcon type={opt.id} className={`w-3.5 h-3.5 shrink-0 ${opt.iconColorCls}`} />
                                  <span>{opt.shortLabel}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={!isSupabaseConfigured || mpBusy}
                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#ff2d1a] to-[#e10600] text-[#f2efe6] text-xs font-black tracking-[0.2em] shadow-[0_8px_24px_rgba(225,6,0,0.4)] hover:brightness-110 active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        {mpBusy ? 'CREATING ROOM…' : 'CREATE PUBLIC ROOM'}
                      </button>
                    </form>

                    {/* Active Public Rooms Browser */}
                    <div className="rounded-xl border border-white/15 bg-[#0e141e]/85 p-3.5 flex flex-col">
                      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-white/10">
                        <span className="text-[11px] font-black tracking-[0.22em] text-[#00d2be]">
                          ACTIVE PUBLIC ROOMS
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[9px] font-black tracking-[0.14em] ${
                            lobbyStatus === 'CONNECTED'
                              ? 'border-[#22ff88]/45 bg-[#22ff88]/12 text-[#4ade80]'
                              : lobbyStatus === 'CONNECTING'
                                ? 'border-[#00d2be]/45 bg-[#00d2be]/12 text-[#5eead4]'
                                : 'border-[#ffb020]/45 bg-[#ffb020]/12 text-[#fde68a]'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
                          {lobbyStatus === 'CONNECTED'
                            ? 'LIVE PRESENCE'
                            : lobbyStatus === 'CONNECTING'
                              ? 'CONNECTING'
                              : lobbyStatus}
                        </span>
                      </div>

                      {publicRooms.length === 0 ? (
                        <div className="flex-1 min-h-[190px] grid place-items-center text-center px-4">
                          <div className="space-y-1.5">
                            <div className="text-xs font-black tracking-[0.16em] text-[#f2efe6]/70">
                              NO ACTIVE PUBLIC ROOMS
                            </div>
                            <p className="text-[11px] text-[#f2efe6]/45 max-w-[260px]">
                              Create a public room on the left — anyone opening this game will see it appear live here.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                          {publicRooms.map((room) => {
                            const cCfg = getCircuitConfig(room.circuit);
                            const wOpt = WEATHER_OPTIONS.find((o) => o.id === room.weather) || WEATHER_OPTIONS[0];
                            const full = room.playerCount >= room.maxPlayers;
                            return (
                              <div
                                key={room.roomId}
                                className="flex items-center justify-between gap-2 rounded-lg border border-white/12 bg-[#080c12]/90 px-3 py-2.5"
                              >
                                <div className="min-w-0 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-black tracking-wide text-[#f2efe6] truncate">
                                      {room.roomName}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded bg-white/10 text-[9px] font-mono font-bold text-[#f2efe6]/75">
                                      #{room.roomId}
                                    </span>
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[8px] font-black tracking-[0.12em] ${
                                        room.status === 'RACING'
                                          ? 'bg-[#ffb020]/20 text-[#fbbf24]'
                                          : 'bg-[#22ff88]/20 text-[#4ade80]'
                                      }`}
                                    >
                                      {room.status}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] font-semibold text-[#f2efe6]/60">
                                    <span>HOST: <b className="text-[#f2efe6]/85">{room.hostName}</b></span>
                                    <span className="text-[#00d2be]">{cCfg.id === 'salatiga-gp' ? 'Salatiga' : 'Monaco'}</span>
                                    <span>{wOpt.shortLabel}</span>
                                    <span className="font-mono text-[#f2efe6]/85">
                                      {room.playerCount}/{room.maxPlayers} DRIVERS
                                    </span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={full || mpBusy}
                                  onClick={(e) => {
                                    e.currentTarget.blur();
                                    void handleJoinPublicRoom(room);
                                  }}
                                  className="shrink-0 px-3.5 py-2 rounded-lg bg-[#00d2be] hover:bg-[#2ee6d3] text-[#06090f] text-[10px] font-black tracking-[0.16em] disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                                >
                                  {full ? 'FULL' : 'JOIN'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* INSIDE A PUBLIC ROOM: WAITING GRID & HOST CONTROLS */
                  <div className="rounded-xl border border-[#00d2be]/40 bg-[#0b121c]/90 p-4 space-y-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/10">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm sm:text-base font-black italic tracking-wide text-[#f2efe6]">
                          {activeRoom.roomName}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-white/10 font-mono text-[10px] font-bold text-[#5eead4]">
                          #{activeRoom.roomId}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded border text-[9px] font-black tracking-[0.14em] ${
                            isMultiplayerHost
                              ? 'border-[#d8b24a]/60 bg-[#d8b24a]/15 text-[#f3d479]'
                              : 'border-[#00d2be]/45 bg-[#00d2be]/15 text-[#5eead4]'
                          }`}
                        >
                          {isMultiplayerHost ? 'YOU ARE HOST' : 'GUEST DRIVER'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          void handleLeaveMultiplayerRoom();
                        }}
                        className="px-3 py-1.5 rounded-lg border border-[#ff2d1a]/50 bg-[#2a0c10]/80 hover:bg-[#3f1116] text-[10px] font-black tracking-[0.16em] text-[#ff6a55] transition cursor-pointer"
                      >
                        LEAVE ROOM
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[1.05fr_0.95fr] gap-3.5">
                      {/* Joined Drivers Grid */}
                      <div className="rounded-lg border border-white/12 bg-[#070a10]/80 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-black tracking-[0.2em] text-[#00d2be]">
                            STARTING GRID ({activeRoom.members.length}/8 HUMAN)
                          </span>
                          <span className="text-[9px] font-bold text-[#f2efe6]/55">
                            +{Math.max(0, 8 - activeRoom.members.length)} AI FILL
                          </span>
                        </div>
                        <div className="space-y-1.5 max-h-[210px] overflow-y-auto pr-1">
                          {activeRoom.members.map((m) => {
                            const isMe = m.playerId === mpManager.getPlayerId();
                            return (
                              <div
                                key={m.playerId}
                                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${
                                  isMe
                                    ? 'border-[#00d2be]/60 bg-[#00d2be]/12'
                                    : 'border-white/10 bg-white/[0.03]'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-[10px] font-black text-[#f2efe6]/55 w-5">
                                    P{m.gridSlot + 1}
                                  </span>
                                  <span
                                    className="w-3 h-3 rounded-sm shrink-0 border border-white/30"
                                    style={{ backgroundColor: m.liveryColor }}
                                  />
                                  <span className="font-bold text-[#f2efe6] truncate">
                                    {m.name}
                                  </span>
                                  {isMe && (
                                    <span className="text-[9px] font-black tracking-[0.12em] text-[#22ff88]">
                                      (YOU)
                                    </span>
                                  )}
                                </div>
                                {m.isHost && (
                                  <span className="px-1.5 py-0.5 rounded bg-[#d8b24a]/20 text-[#f3d479] text-[9px] font-black tracking-[0.12em]">
                                    HOST
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Room Circuit & Weather Settings (Host editable, Guest synced read-only) */}
                      <div className="rounded-lg border border-white/12 bg-[#070a10]/80 p-3 flex flex-col justify-between space-y-2.5">
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black tracking-[0.2em] text-[#00d2be]">
                              RACE SETTINGS
                            </span>
                            <span className="text-[9px] font-bold text-[#f2efe6]/50">
                              {isMultiplayerHost ? 'SYNCED TO ALL' : 'HOST CONTROLLED'}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            {CIRCUIT_LIST.map((cCfg) => {
                              const sel = activeRoom.circuit === cCfg.id;
                              return (
                                <button
                                  key={cCfg.id}
                                  type="button"
                                  disabled={!isMultiplayerHost}
                                  onClick={(e) => {
                                    e.currentTarget.blur();
                                    handleSelectCircuit(cCfg.id);
                                  }}
                                  className={`px-2.5 py-2 rounded-lg border text-left transition ${
                                    sel
                                      ? 'border-[#00d2be] bg-[#00d2be]/15 text-white'
                                      : 'border-white/10 bg-white/[0.02] text-[#f2efe6]/60'
                                  } ${isMultiplayerHost ? 'cursor-pointer hover:bg-white/10' : 'cursor-default'}`}
                                >
                                  <div className="text-[10px] font-black tracking-[0.1em] truncate">{cCfg.gpTitle}</div>
                                  <div className="text-[9px] text-[#f2efe6]/55 truncate">{cCfg.lengthLabel}</div>
                                </button>
                              );
                            })}
                          </div>

                          <div className="grid grid-cols-3 gap-1.5">
                            {WEATHER_OPTIONS.map((opt) => {
                              const sel = activeRoom.weather === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  disabled={!isMultiplayerHost}
                                  onClick={(e) => {
                                    e.currentTarget.blur();
                                    handleSelectStartWeather(opt.id);
                                  }}
                                  className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-black tracking-[0.08em] transition ${
                                    sel
                                      ? 'border-[#00d2be] bg-[#00d2be]/15 text-white'
                                      : 'border-white/10 bg-white/[0.02] text-[#f2efe6]/60'
                                  } ${isMultiplayerHost ? 'cursor-pointer hover:bg-white/10' : 'cursor-default'}`}
                                >
                                  <WeatherIcon type={opt.id} className={`w-3.5 h-3.5 shrink-0 ${opt.iconColorCls}`} />
                                  <span>{opt.shortLabel}</span>
                                </button>
                              );
                            })}
                          </div>

                          <div className="rounded-lg bg-[#05080d] border border-white/10 px-2 py-1">
                            <CircuitSvgMap config={getCircuitConfig(activeRoom.circuit)} selected={true} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-white/10">
                      <span className="text-[10px] font-bold tracking-[0.14em] text-[#f2efe6]/60">
                        {isMultiplayerHost
                          ? 'ALL DRIVERS IN ROOM WILL LAUNCH TOGETHER ON THE GRID'
                          : activeRoom.status === 'RACING'
                            ? 'RACE IN PROGRESS — WAIT FOR HOST NEXT START'
                            : 'WAITING FOR HOST TO START RACE…'}
                      </span>
                      {isMultiplayerHost ? (
                        <button
                          type="button"
                          disabled={mpBusy}
                          onClick={(e) => {
                            e.currentTarget.blur();
                            void handleHostStartRaceForAll();
                          }}
                          className="w-full sm:w-auto px-7 py-2.5 rounded-xl bg-gradient-to-r from-[#ff2d1a] to-[#e10600] text-[#f2efe6] text-xs font-black tracking-[0.2em] shadow-[0_10px_28px_rgba(225,6,0,0.45)] hover:brightness-110 active:scale-95 disabled:opacity-50 transition cursor-pointer"
                        >
                          {mpBusy ? 'STARTING…' : 'START RACE FOR ALL'}
                        </button>
                      ) : (
                        <div className="px-4 py-2 rounded-lg border border-[#00d2be]/40 bg-[#00d2be]/10 text-[10px] font-black tracking-[0.18em] text-[#5eead4]">
                          READY ON GRID
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
