import { useEffect, useRef, useState } from 'react';
import { initHud } from './game/audioHud.js';
import { startMonacoEngine } from './game/engine.ts';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
    });

    return () => {
      cleanupEngine();
      cleanupHud();
    };
  }, []);

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

      {/* Chequered flag · podium modal */}
      <div id="finish-modal" role="dialog" aria-modal="true" aria-labelledby="finish-title">
        <div id="finish-card" className="panel">
          <div id="confetti" aria-hidden="true" />
          <div id="finish-kicker">CHEQUERED FLAG · MONACO GP</div>
          <h1 id="finish-title">VICTORY</h1>
          <div id="finish-sub">CIRCUIT DE MONACO · 3 LAPS</div>
          <div id="podium" />
          <div id="finish-rows" />
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
