import { useEffect, useMemo, useState } from "react";
import { socket } from "./socket";
import "./App.css";

type PlayerDTO = {
  id: string;
  nickname: string;
  ready: boolean;
  alive: boolean;
  wins: number;
};

type LobbyDTO = {
  id: string;
  ownerId: string;
  started: boolean;
  maxPlayers: number;
  round: number;
  players: PlayerDTO[];
};

type MatchPlayer = { id: string; nickname: string; x: number; y: number };
type MatchState = {
  lobbyId: string;
  remainingMs: number;
  players: MatchPlayer[];
  bomb?: {
    holderId: string;
    remainingMs: number;
  };
};

type Standing = {
  id: string;
  nickname: string;
  place: number;
  wins: number;
};

type WinnerScreenState = {
  lobbyId: string;
  reason: string;
  winnerId: string | null;
  winnerName: string | null;
  standings: Standing[];
};

type KillFeedItem = { id: number; text: string; ts: number };

const MOVE_SPEED = 0.25; // Pixel pro ms

export default function App() {
  const [nickname, setNickname] = useState("");
  const [lobbyId, setLobbyId] = useState("");
  const [lobby, setLobby] = useState<LobbyDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [winnerScreen, setWinnerScreen] = useState<WinnerScreenState | null>(
    null
  );
  const [killFeed, setKillFeed] = useState<KillFeedItem[]>([]);

  // Socket-Events
  useEffect(() => {
    const onConnect = () => console.log("Verbunden:", socket.id);

    const onLobbyCreated = ({ lobbyId }: { lobbyId: string }) =>
      setLobbyId(lobbyId);

    const onLobbyUpdate = (data: LobbyDTO) => {
      setLobby(data);
      setError(null);
    };

    const onLobbyError = (msg: string) => setError(msg);

    const onMatchStarted = (data: {
      lobbyId: string;
      t: number;
      durationMs: number;
      round: number;
    }) => {
      console.log("match:started", data);
      setWinnerScreen(null);
    };

    const onMatchState = (state: MatchState) => {
      setMatchState(state);
    };

    const onBombExploded = (data: {
      lobbyId: string;
      loserId: string;
      loserName: string;
    }) => {
      const now = Date.now();
      const text = `💣 ${data.loserName} wurde eliminiert`;
      setKillFeed((prev) =>
        [...prev, { id: now, text, ts: now }].slice(-5)
      );
    };

    const onMatchEnded = (data: {
      lobbyId: string;
      reason?: string;
      winnerId?: string | null;
      winnerName?: string | null;
      standings?: Standing[];
    }) => {
      console.log("match:ended", data);
      setMatchState(null);

      if (data.reason === "winner" && data.standings) {
        setWinnerScreen({
          lobbyId: data.lobbyId,
          reason: data.reason,
          winnerId: data.winnerId ?? null,
          winnerName: data.winnerName ?? null,
          standings: data.standings,
        });
      } else if (data.reason === "time") {
        setError("Match zu Ende – Zeit abgelaufen");
      } else {
        setError("Match beendet");
      }
    };

    socket.on("connect", onConnect);
    socket.on("lobby:created", onLobbyCreated);
    socket.on("lobby:update", onLobbyUpdate);
    socket.on("lobby:error", onLobbyError);
    socket.on("match:started", onMatchStarted);
    socket.on("match:state", onMatchState);
    socket.on("bomb:exploded", onBombExploded);
    socket.on("match:ended", onMatchEnded);

    return () => {
      socket.off("connect", onConnect);
      socket.off("lobby:created", onLobbyCreated);
      socket.off("lobby:update", onLobbyUpdate);
      socket.off("lobby:error", onLobbyError);
      socket.off("match:started", onMatchStarted);
      socket.off("match:state", onMatchState);
      socket.off("bomb:exploded", onBombExploded);
      socket.off("match:ended", onMatchEnded);
    };
  }, []);

  const isOwner = useMemo(() => lobby?.ownerId === socket.id, [lobby]);
  const me = useMemo(
    () => lobby?.players.find((p) => p.id === socket.id) || null,
    [lobby]
  );

  const inMatch = !!(lobby && lobby.started && matchState);
  const myMatchPlayer =
    matchState?.players.find((p) => p.id === socket.id) || null;
  const isSpectator = !!(inMatch && matchState && !myMatchPlayer);

  // Killfeed: nur Einträge der letzten 6 Sekunden
  const visibleKillFeed = useMemo(() => {
    const now = Date.now();
    return killFeed.filter((item) => now - item.ts < 6000);
  }, [killFeed, matchState]);

  // Bewegung
  useEffect(() => {
    if (!inMatch || !matchState || isSpectator) return;

    const keys = new Set<string>();
    let lastTime = performance.now();
    let animId: number | null = null;

    function onKeyDown(e: KeyboardEvent) {
      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
        keys.add(e.key);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
        keys.delete(e.key);
      }
    }

    function loop(now: number) {
      const dt = now - lastTime;
      lastTime = now;

      if (keys.size > 0 && matchState) {
        let vx = 0;
        let vy = 0;

        if (keys.has("ArrowUp")) vy -= 1;
        if (keys.has("ArrowDown")) vy += 1;
        if (keys.has("ArrowLeft")) vx -= 1;
        if (keys.has("ArrowRight")) vx += 1;

        const len = Math.hypot(vx, vy);
        if (len > 0) {
          vx /= len;
          vy /= len;

          const dx = vx * MOVE_SPEED * dt;
          const dy = vy * MOVE_SPEED * dt;

          socket.emit("player:move", {
            lobbyId: matchState.lobbyId,
            dx,
            dy,
          });
        }
      }

      animId = requestAnimationFrame(loop);
    }

    lastTime = performance.now();
    animId = requestAnimationFrame(loop);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (animId) cancelAnimationFrame(animId);
      keys.clear();
    };
  }, [inMatch, matchState, isSpectator]);

  function createLobby() {
    if (!nickname.trim()) {
      setError("Bitte Nickname eingeben");
      return;
    }
    socket.emit("lobby:create", { nickname: nickname.trim(), maxPlayers: 4 });
  }

  function joinLobby() {
    if (!nickname.trim() || !lobbyId.trim()) {
      setError("Lobby-ID und Nickname nötig");
      return;
    }
    socket.emit("lobby:join", {
      lobbyId: lobbyId.trim().toUpperCase(),
      nickname: nickname.trim(),
    });
  }

  function toggleReady() {
    if (!lobby) return;
    socket.emit("lobby:ready", {
      lobbyId: lobby.id,
      ready: !(me?.ready ?? false),
    });
  }

  function leaveLobby() {
    if (!lobby) return;
    socket.emit("lobby:leave", { lobbyId: lobby.id });
    setLobby(null);
    setMatchState(null);
    setWinnerScreen(null);
  }

  function startMatch() {
    if (!lobby) return;
    socket.emit("match:start", { lobbyId: lobby.id });
  }

  function closeWinnerScreen() {
    setWinnerScreen(null);
  }

  return (
    <div className="screen">
      {/* Error-Toast */}
      {error && (
        <div className="toast toast-error" onClick={() => setError(null)}>
          <span>⚠</span>
          <p>{error}</p>
        </div>
      )}

      {/* Killfeed oben rechts */}
      {visibleKillFeed.length > 0 && (
        <div className="killfeed">
          {visibleKillFeed.map((item) => (
            <div key={item.id} className="killfeed-item">
              {item.text}
            </div>
          ))}
        </div>
      )}

      <div className="frame">
        <header className="header">
          <div className="logo">
            <div className="logo-icon">💣</div>
            <div className="logo-text">
              <h1>BOMB.IO</h1>
              <p>Multiplayer Action Lobby</p>
            </div>
          </div>
          <div className="header-status">
            <span className="status-dot" />
            <span>Online</span>
          </div>
        </header>

        {/* Winner-Overlay (Fullscreen) */}
        {winnerScreen && (
          <WinnerOverlay
            state={winnerScreen}
            onClose={closeWinnerScreen}
            isOwner={!!isOwner}
            onRestart={startMatch}
          />
        )}

        {!inMatch && (
          <main className="layout">
            {/* Linke Spalte: kurzer Hero */}
            <section className="hero">
              <h2>Schnelle Bomben-Matches mit deinen Freunden.</h2>
              <p>
                Erstelle eine Lobby, teile den Code und rennt, bevor die Bombe
                hochgeht.
              </p>
              <ul className="hero-list">
                <li>⚔️ Live-Multiplayer im Browser</li>
                <li>🔥 1–4 Spieler, kurze Runden</li>
              </ul>
              <div className="hero-hint">
                Step&nbsp;1: Nickname eingeben · Step&nbsp;2: Lobby erstellen
                oder beitreten.
              </div>
            </section>

            {/* Rechte Spalte: Panels */}
            <section className="panels">
              {/* Start / Join Panel */}
              <div className="panel panel-grid">
                <div className="panel-column">
                  <h3>Neues Spiel starten</h3>
                  <label className="field">
                    <span>Nickname</span>
                    <input
                      className="input"
                      placeholder="Wie sollen dich die anderen sehen?"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                    />
                  </label>
                  <button
                    className="btn btn-primary btn-large"
                    onClick={createLobby}
                  >
                    + Lobby erstellen
                  </button>
                </div>

                <div className="panel-column">
                  <h3>Einer Lobby beitreten</h3>
                  <label className="field">
                    <span>Lobby-ID</span>
                    <input
                      className="input"
                      placeholder="z. B. QPC6GQ"
                      value={lobbyId}
                      onChange={(e) =>
                        setLobbyId(e.target.value.toUpperCase())
                      }
                    />
                  </label>
                  <button className="btn btn-outline btn-large" onClick={joinLobby}>
                    Beitreten
                  </button>
                  <p className="panel-hint">
                    Den Code bekommst du von jemandem, der eine Lobby erstellt
                    hat.
                  </p>
                </div>
              </div>

              {/* Aktive Lobby */}
              {lobby && (
                <div className="panel panel-lobby">
                  <div className="panel-lobby-header">
                    <h3>Aktive Lobby</h3>
                    <button
                      className="pill copy-pill"
                      onClick={() => navigator.clipboard.writeText(lobby.id)}
                    >
                      ID kopieren
                    </button>
                  </div>

                  <div className="lobby-meta">
                    <div>
                      <span className="meta-label">Lobby-ID</span>
                      <span className="code">{lobby.id}</span>
                    </div>
                    <div>
                      <span className="meta-label">Spieler</span>
                      <span>
                        {lobby.players.length}/{lobby.maxPlayers}
                      </span>
                    </div>
                    <div>
                      <span className="meta-label">Runde</span>
                      <span className="pill pill-timer">
                        {lobby.round || 0}
                      </span>
                    </div>
                  </div>

                  <ul className="player-list">
                    {lobby.players.map((p) => (
                      <li key={p.id} className="player-item">
                        <div className="player-main">
                          <span className="avatar">
                            {p.nickname.substring(0, 1).toUpperCase()}
                          </span>
                          <span className="nickname">{p.nickname}</span>
                          {p.id === socket.id && (
                            <span className="tag tag-me">Du</span>
                          )}
                          {p.id === lobby.ownerId && (
                            <span className="tag tag-owner">Host</span>
                          )}
                          {!p.alive && (
                            <span className="tag tag-wait">Out</span>
                          )}
                        </div>
                        <span
                          className={
                            "tag " + (p.ready ? "tag-ready" : "tag-wait")
                          }
                        >
                          {p.ready ? "Bereit" : "Wartet"}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="lobby-actions">
                    <button
                      className="btn btn-primary"
                      onClick={toggleReady}
                    >
                      {me?.ready ? "Nicht bereit" : "Bereit"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={leaveLobby}
                    >
                      Lobby verlassen
                    </button>
                    <button
                      className="btn btn-accent"
                      onClick={startMatch}
                      disabled={!isOwner}
                    >
                      Match starten{isOwner ? "" : " (Host)"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </main>
        )}

        {inMatch && matchState && (
          <main className="layout layout-match">
            <section className="panel panel-match-header">
              <div className="match-meta">
                <div>
                  <span className="meta-label">Lobby</span>
                  <span className="code">{matchState.lobbyId}</span>
                </div>
                <div>
                  <span className="meta-label">Restzeit</span>
                  <span className="pill pill-timer">
                    {Math.ceil(matchState.remainingMs / 1000)}s
                  </span>
                </div>
                <div>
                  <span className="meta-label">Rolle</span>
                  <span className="pill">
                    {isSpectator ? "Spectator" : "Spieler"}
                  </span>
                </div>
              </div>
            </section>

            <MatchView state={matchState} />
          </main>
        )}

        {inMatch && isSpectator && (
          <div className="spectator-banner">
            Du bist raus – du schaust jetzt als Spectator zu.
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Match-Ansicht ---------- */

function MatchView({ state }: { state: MatchState }) {
  const width = 400;
  const height = 300;

  const bombSeconds =
    state.bomb != null
      ? Math.ceil(state.bomb.remainingMs / 1000)
      : null;

  return (
    <section className="panel panel-match">
      <div className="field-wrapper">
        <div className="field" style={{ width, height }}>
          {state.players.map((p) => {
            const isMe = p.id === socket.id;
            const isBombHolder = state.bomb?.holderId === p.id;
            const isCritical =
              isBombHolder && state.bomb && state.bomb.remainingMs <= 5000;

            const classes = [
              "player-dot",
              isMe ? "player-dot-me" : "",
              isBombHolder ? "player-dot-bomb" : "",
              isCritical ? "pulse" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={p.id}
                className={classes}
                style={{ left: p.x, top: p.y }}
              >
                {isBombHolder && bombSeconds !== null && (
                  <span className="bomb-timer">{bombSeconds}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="field-footer">
        <span className="hint">Bewege dich mit den Pfeiltasten.</span>
        <span className="hint">Spieler: {state.players.length}</span>
      </div>
    </section>
  );
}

/* ---------- Winner-Overlay ---------- */

function WinnerOverlay({
  state,
  onClose,
  isOwner,
  onRestart,
}: {
  state: WinnerScreenState;
  onClose: () => void;
  isOwner: boolean;
  onRestart: () => void;
}) {
  const meId = socket.id;

  return (
    <div className="winner-overlay">
      <div className="winner-card">
        <h2 className="winner-title">Runde beendet</h2>
        {state.winnerName ? (
          <p className="winner-main">
            Gewinner:{" "}
            <span className="winner-name">
              {state.winnerName}
              {state.winnerId === meId ? " (Du)" : ""}
            </span>
          </p>
        ) : (
          <p className="winner-main">Runde beendet</p>
        )}

        <h3>Platzierungen</h3>
        <ol className="winner-list">
          {state.standings.map((s) => (
            <li key={s.id}>
              <span>
                #{s.place} – {s.nickname}
                {s.id === meId ? " (Du)" : ""}
              </span>
              <span className="winner-wins">Wins: {s.wins}</span>
            </li>
          ))}
        </ol>

        <div className="winner-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Schliessen
          </button>
          <button
            className="btn btn-accent"
            onClick={onRestart}
            disabled={!isOwner}
          >
            Neue Runde starten{isOwner ? "" : " (Host)"}
          </button>
        </div>
      </div>
    </div>
  );
}
