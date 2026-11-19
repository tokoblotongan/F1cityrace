import { FormEvent, useEffect, useRef, useState } from 'react';
import { initHud } from './game/audioHud.js';
import { RaceFinishResult, startMonacoEngine } from './game/engine.ts';

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

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [records, setRecords] = useState<PodiumRecord[]>(() => loadStoredRecords());
  const [finishResult, setFinishResult] = useState<RaceFinishResult | null>(null);
  const [driverName, setDriverName] = useState<string>(() => loadLastDriverName());
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  const [savedDriverName, setSavedDriverName] = useState<string | null>(null);
  const [showHallOfFameModal, setShowHallOfFameModal] = useState(false);

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
      onWebGLError: (msg) => setWebglError(msg),
      onRaceFinish: (result) => {
        setFinishResult(result);
        setSavedRecordId(null);
        setSavedDriverName(null);
        if (result) {
          setShowHallOfFameModal(false);
          setDriverName((prev) => prev || loadLastDriverName());
        }
      },
    });

    return () => {
      cleanupEngine();
      cleanupHud();
    };
  }, []);

  useEffect(() => {
    if (!finishResult || !savedDriverName) return;
    applyDriverNameToFinishDom(savedDriverName);
    const podiumEl = document.getElementById('podium');
    const rowsEl = document.getElementById('finish-rows');
    const observer = new MutationObserver(() => {
      applyDriverNameToFinishDom(savedDriverName);
    });
    if (podiumEl) observer.observe(podiumEl, { childList: true, subtree: true });
    if (rowsEl) observer.observe(rowsEl, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [finishResult, savedDriverName]);

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

          {/* Podium Name Entry Form (only when playerPosition <= 3) */}
          {finishResult && finishResult.playerPosition <= 3 && (
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
          <button id="dnf-race-again">
            RACE AGAIN <span className="key-cap">R</span>
          </button>
        </div>
      </div>
    </>
  );
}
