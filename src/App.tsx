import { FormEvent, useEffect, useRef, useState } from 'react';
import { initAudio, initHud } from './game/audioHud.js';
import {
  EngineController,
  RaceFinishResult,
  WeatherType,
  startMonacoEngine,
} from './game/engine.ts';

const RECORDS_STORAGE_KEY = 'f1_monaco_podium_records';
const LAST_NAME_STORAGE_KEY = 'f1_monaco_last_driver_name';
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

function loadStoredRecords(): PodiumRecord[] {
  try {
    const raw = window.localStorage.getItem(RECORDS_STORAGE_KEY);
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

function saveStoredRecords(records: PodiumRecord[]): void {
  try {
    window.localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records));
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

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef<EngineController | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherType>('cerah');
  const [raceStarted, setRaceStarted] = useState(false);
  const [showWeatherMenu, setShowWeatherMenu] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [records, setRecords] = useState<PodiumRecord[]>(() => loadStoredRecords());
  const [finishResult, setFinishResult] = useState<RaceFinishResult | null>(null);
  const [driverName, setDriverName] = useState<string>(() => loadLastDriverName());
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  const [savedDriverName, setSavedDriverName] = useState<string | null>(null);
  const [showHallOfFameModal, setShowHallOfFameModal] = useState(false);
  const [chequeredCountdown, setChequeredCountdown] = useState<number | null>(null);

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

  const handleSelectStartWeather = (w: WeatherType) => {
    setWeather(w);
    controllerRef.current?.setWeather(w);
  };

  const handleStartRace = () => {
    initAudio();
    setShowWeatherMenu(false);
    setRaceStarted(true);
    controllerRef.current?.startRace(weather);
  };

  const handleRestartWithWeather = (w: WeatherType) => {
    initAudio();
    setWeather(w);
    setShowWeatherMenu(false);
    setRaceStarted(true);
    controllerRef.current?.restartWithWeather(w);
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
    saveStoredRecords(nextRecords);
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
          NO PODIUM RECORDS YET — FINISH TOP 3 TO SET A MONACO RECORD
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
          <div className="text-2xl font-black italic tracking-wider text-[#e10600]">MONACO GP</div>
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
        aria-label="Monaco GP 3D race view"
      />

      {/* Boot / loading gate */}
      <div id="boot">
        <div id="boot-mark">M</div>
        <div id="boot-title">MONACO GP</div>
        <div id="boot-sub">STREET CIRCUIT CHALLENGE</div>
        <div id="boot-track"><div id="boot-bar" /></div>
        <div id="boot-note">Building Circuit de Monaco…</div>
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
            <span className="head-title">MONACO GP</span>
            <span className="live-tag">LIVE</span>
          </header>
          <div id="tower-rows" />
          <footer id="tower-foot">
            CIRCUIT DE MONACO · <span id="tower-laps">3 LAPS</span>
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
            LAP <span id="lap-current">1</span>
            <span className="lap-sep">/</span>
            <span id="lap-total">3</span>
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
              <span id="minimap-label">CIRCUIT DE MONACO - 3.34 KM</span>
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

        {/* Top-right · Active Weather Badge + quick weather-switch restart menu */}
        {raceStarted && (
          <div className="pointer-events-auto fixed top-[14px] right-[126px] sm:right-[194px] z-20">
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                setShowWeatherMenu((prev) => !prev);
              }}
              aria-expanded={showWeatherMenu}
              title="Track weather & grip — click to switch weather and restart"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0b0f16]/82 border border-[rgba(242,239,230,0.18)] hover:border-[#00d2be] text-[#f2efe6] shadow-lg transition cursor-pointer"
            >
              <WeatherIcon type={activeWeatherOpt.id} className={`w-3.5 h-3.5 shrink-0 ${activeWeatherOpt.iconColorCls}`} />
              <span className="text-[10px] font-black tracking-[0.14em]">{activeWeatherOpt.shortLabel}</span>
              <span className={`hidden sm:inline-block px-1.5 py-0.5 rounded border text-[8px] font-black tracking-[0.1em] ${activeWeatherOpt.badgeCls}`}>
                {activeWeatherOpt.gripBadge.split('·')[0].trim()}
              </span>
            </button>

            {showWeatherMenu && (
              <div className="mt-1.5 w-[228px] rounded-xl bg-[#0d121a]/95 border border-white/20 p-2 shadow-2xl backdrop-blur-md">
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
                  CIRCUIT HALL OF FAME — TOP RECORDS
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
          <div id="finish-kicker">CHEQUERED FLAG · MONACO GP</div>
          <h1 id="finish-title">VICTORY</h1>
          <div id="finish-sub">CIRCUIT DE MONACO · 3 LAPS</div>
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
                CIRCUIT HALL OF FAME — TOP RECORDS
              </span>
              <span className="text-[9px] font-bold tracking-[0.14em] text-[#f2efe6]/50">
                TOP {MAX_HALL_OF_FAME}
              </span>
            </div>
            {renderHallOfFameRows(true)}
          </div>

          {/* Weather switcher row before Restart */}
          <div className="mt-3.5 rounded-lg border border-white/12 bg-[#070a10]/65 px-3 py-2 text-left">
            <div className="text-[9px] font-black tracking-[0.2em] text-[#f2efe6]/55 mb-1.5">
              RESTART IN DIFFERENT WEATHER
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

          <button id="race-again">
            RACE AGAIN <span className="key-cap">R</span>
          </button>
        </div>
      </div>

      {/* DNF · terminal car damage Game Over modal */}
      <div id="gameover-modal" role="dialog" aria-modal="true" aria-labelledby="gameover-title">
        <div id="gameover-card" className="panel">
          <div id="gameover-kicker">TERMINAL CAR DAMAGE · MONACO GP</div>
          <h1 id="gameover-title">GAME OVER — DNF</h1>
          <div id="gameover-sub">CHASSIS INTEGRITY FAILED · RETIRED FROM RACE</div>
          <div id="dnf-stats">
            <div className="dnf-stat">
              <label>LAP REACHED</label>
              <span id="dnf-lap" className="mono">LAP 1 / 3</span>
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

          <div className="mt-3.5 rounded-lg border border-white/12 bg-[#070a10]/65 px-3 py-2 text-left">
            <div className="text-[9px] font-black tracking-[0.2em] text-[#f2efe6]/55 mb-1.5">
              RESTART IN DIFFERENT WEATHER
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

          <button id="dnf-race-again">
            RACE AGAIN <span className="key-cap">R</span>
          </button>
        </div>
      </div>

      {/* Start Screen · Weather & Track Conditions Selection */}
      {!raceStarted && !webglError && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="start-title"
          className="fixed inset-0 z-30 flex items-center justify-center bg-gradient-to-b from-[#06090f]/75 via-[#06090f]/60 to-[#06090f]/82 backdrop-blur-[3px] p-4"
        >
          <div className="w-full max-w-[780px] rounded-2xl bg-[#0b0f16]/90 border border-white/18 border-t-[3px] border-t-[#e10600] px-5 py-6 sm:px-7 sm:py-7 shadow-[0_28px_80px_rgba(0,0,0,0.75)] text-[#f2efe6]">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#e10600]/15 border border-[#e10600]/45 text-[10px] font-black tracking-[0.28em] text-[#ff6a55]">
                CIRCUIT DE MONACO · 3 LAPS · 8 CARS
              </div>
              <h1
                id="start-title"
                className="mt-2.5 text-4xl sm:text-5xl font-black italic tracking-wide bg-gradient-to-r from-[#f2efe6] via-[#d8b24a] to-[#ff2d1a] bg-clip-text text-transparent"
              >
                MONACO GP
              </h1>
              <p className="mt-1 text-xs font-bold tracking-[0.26em] text-[#00d2be] uppercase">
                SELECT WEATHER CONDITIONS
              </p>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                    className={`relative flex flex-col justify-between text-left rounded-xl border p-4 transition cursor-pointer ${
                      selected
                        ? opt.activeCardCls
                        : 'border-white/15 bg-[#0e141e]/80 hover:border-white/35 hover:bg-[#131b28]/90'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className={`p-2 rounded-lg bg-white/[0.06] border border-white/10 ${opt.iconColorCls}`}>
                          <WeatherIcon type={opt.id} className="w-6 h-6" />
                        </div>
                        <span className={`px-2 py-0.5 rounded border text-[9px] font-black tracking-[0.12em] ${opt.badgeCls}`}>
                          {opt.gripBadge}
                        </span>
                      </div>
                      <h2 className="mt-3 text-base font-black italic tracking-wide text-[#f2efe6]">
                        {opt.label}
                      </h2>
                      <div className="text-[11px] font-bold tracking-[0.06em] text-[#00d2be]">
                        {opt.subtitle}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-[#f2efe6]/70">
                        {opt.description}
                      </p>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[10px] font-black tracking-[0.16em]">
                      <span className={selected ? 'text-[#22ff88]' : 'text-[#f2efe6]/45'}>
                        {selected ? '✓ SELECTED' : 'CLICK TO PREVIEW'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-white/10">
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
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-[#ff2d1a] to-[#e10600] text-[#f2efe6] text-sm font-black tracking-[0.24em] shadow-[0_10px_32px_rgba(225,6,0,0.5)] hover:brightness-110 active:scale-95 transition cursor-pointer"
              >
                START RACE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
