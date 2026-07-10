"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import GameCanvas, { type GameCanvasHandle } from "@/components/GameCanvas";
import { GRID_HEIGHT, GRID_WIDTH, MAX_NAME_LENGTH, RESPAWN_SECONDS } from "@/lib/config";
import { useGeolocation } from "@/hooks/useGeolocation";
import { formatDistanceFromCampus, latLngToGrid } from "@/lib/geo";
import { decodeOwnersRLE } from "@/lib/territory";
import type { GameEvent, GameHello, GameStateDiff, PublicPlayer } from "@/lib/types";

const NAME_KEY = "dsce-claim-name";

export default function Home() {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [myId, setMyId] = useState<number | null>(null);
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [owners, setOwners] = useState<Uint16Array>(
    () => new Uint16Array(GRID_WIDTH * GRID_HEIGHT)
  );
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">(
    "connecting"
  );
  const [toast, setToast] = useState<string | null>(null);
  const [walkMode, setWalkMode] = useState(true);
  const [followMe, setFollowMe] = useState(true);
  const [joinError, setJoinError] = useState("");
  const [respawnSeconds, setRespawnSeconds] = useState(RESPAWN_SECONDS);

  const socketRef = useRef<Socket | null>(null);
  const canvasRef = useRef<GameCanvasHandle>(null);
  const gps = useGeolocation(false);
  const lastGpsGrid = useRef<{ x: number; y: number } | null>(null);

  const me = useMemo(
    () => players.find((p) => p.id === myId) ?? null,
    [players, myId]
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) setName(saved);
    setReady(true);
  }, []);

  // Socket
  useEffect(() => {
    const s = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    socketRef.current = s;

    s.on("connect", () => setStatus("live"));
    s.on("disconnect", () => setStatus("offline"));

    s.on("hello", (hello: GameHello) => {
      setPlayers(hello.players);
      setOwners(decodeOwnersRLE(hello.territory, GRID_WIDTH * GRID_HEIGHT));
      setEvents(hello.events || []);
      setRespawnSeconds(hello.respawnSeconds);
      if (hello.you != null) {
        setMyId(hello.you);
        setJoined(true);
      }
      setStatus("live");
    });

    s.on("state", (diff: GameStateDiff) => {
      setPlayers(diff.players);
      if (diff.territory) {
        setOwners(decodeOwnersRLE(diff.territory, GRID_WIDTH * GRID_HEIGHT));
      }
      if (diff.events) setEvents(diff.events);
    });

    return () => {
      s.disconnect();
    };
  }, []);

  // Personal kill feed toasts
  const seenEvents = useRef(new Set<string>());
  useEffect(() => {
    if (myId == null) return;
    for (const e of events) {
      if (seenEvents.current.has(e.id)) continue;
      seenEvents.current.add(e.id);
      if (e.type === "cut" && e.target === myId) {
        showToast(e.message);
      } else if (e.type === "kill" && e.by === myId) {
        showToast(e.message);
      } else if (e.type === "suicide" && e.target === myId) {
        showToast("You hit your own trail!");
      } else if (e.type === "claim" && e.by === myId) {
        showToast(e.message);
      }
    }
  }, [events, myId, showToast]);

  // Follow camera
  useEffect(() => {
    if (!followMe || !me?.alive) return;
    canvasRef.current?.centerOn(me.x, me.y);
  }, [me?.x, me?.y, me?.alive, followMe]);

  // GPS → move
  useEffect(() => {
    if (!joined || !gps.position || !me?.alive) return;
    const g = latLngToGrid(gps.position.lat, gps.position.lng);
    if (!g.onCampus) return;

    const prev = lastGpsGrid.current;
    if (
      prev &&
      Math.hypot(g.x - prev.x, g.y - prev.y) < 0.25
    ) {
      return;
    }
    lastGpsGrid.current = { x: g.x, y: g.y };
    socketRef.current?.emit("move", {
      x: g.x,
      y: g.y,
      lat: gps.position.lat,
      lng: gps.position.lng,
    });
  }, [gps.position, joined, me?.alive]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 1) {
      setJoinError("Enter a callsign");
      return;
    }
    localStorage.setItem(NAME_KEY, n);
    socketRef.current?.emit(
      "join",
      { name: n },
      (res: { ok?: boolean; error?: string; you?: number; name?: string }) => {
        if (res?.error) {
          setJoinError(res.error);
          return;
        }
        if (res?.you != null) setMyId(res.you);
        if (res?.name) setName(res.name);
        setJoined(true);
        setJoinError("");
        // try GPS
        gps.start();
        showToast("You're in — walk to claim campus!");
      }
    );
  };

  const handleWalk = useCallback(
    (x: number, y: number) => {
      if (!joined || !me?.alive) return;
      socketRef.current?.emit("move", { x, y });
    },
    [joined, me?.alive]
  );

  const handleLocate = () => {
    setFollowMe(true);
    if (gps.status !== "tracking") {
      gps.start();
      showToast("Enable location for real walking");
    }
    if (me) canvasRef.current?.centerOn(me.x, me.y, 14);
    if (gps.position) {
      const g = latLngToGrid(gps.position.lat, gps.position.lng);
      if (!g.onCampus) {
        showToast(formatDistanceFromCampus(gps.position.lat, gps.position.lng));
      }
    }
  };

  const handleRespawn = () => {
    socketRef.current?.emit("respawn");
  };

  const leaderboard = useMemo(() => {
    return [...players]
      .filter((p) => p.alive || p.cells > 0)
      .sort((a, b) => b.cells - a.cells || b.kills - a.kills)
      .slice(0, 6);
  }, [players]);

  const totalCells = GRID_WIDTH * GRID_HEIGHT;
  const myPct = me ? ((me.cells / totalCells) * 100).toFixed(1) : "0.0";
  const dead = me && !me.alive;
  const respawnIn = dead
    ? Math.max(0, Math.ceil((me.respawnAt - Date.now()) / 1000))
    : 0;

  // tick respawn countdown display
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!dead) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [dead]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#070b14] text-amber-200/50">
        <span className="text-xs tracking-[0.3em] uppercase">Loading…</span>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#070b14] text-white">
      {/* Join gate */}
      {!joined && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="hud-panel w-full max-w-sm p-6">
            <div className="mb-5 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-sm font-black text-black shadow-lg shadow-amber-500/25">
                D
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-amber-400/80">
                DSCE · Kumaraswamy
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                Campus Claim
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-white/45">
                Paper.io on campus. Walk (GPS) or drag on map. Leave a trail,
                loop back to claim land. Cut enemies&apos; trails to wipe them.
              </p>
            </div>
            <form onSubmit={handleJoin} className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/35">
                  Callsign
                </span>
                <input
                  autoFocus
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  onChange={(e) => {
                    setName(e.target.value);
                    setJoinError("");
                  }}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-amber-400/50"
                />
              </label>
              {joinError && (
                <p className="text-xs text-rose-400">{joinError}</p>
              )}
              <button
                type="submit"
                className="w-full rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 py-2.5 text-sm font-bold text-black shadow-lg shadow-amber-500/20"
              >
                Drop into campus
              </button>
            </form>
            <ul className="mt-4 space-y-1 text-[10px] text-white/30">
              <li>• Trail outside your color → loop home to claim</li>
              <li>• Cross someone&apos;s trail → they&apos;re out</li>
              <li>• Hit your own trail → you die</li>
              <li>• Desktop: Walk mode + drag to move</li>
            </ul>
          </div>
        </div>
      )}

      <GameCanvas
        ref={canvasRef}
        players={players}
        owners={owners}
        myId={myId}
        userLocation={gps.position}
        onWalk={handleWalk}
        walkMode={walkMode}
      />

      {/* TOP HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2.5">
        <div className="pointer-events-auto flex flex-col gap-1.5">
          <div className="hud-panel flex items-center gap-2 px-2.5 py-1.5">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-amber-400 to-orange-600 text-[10px] font-black text-black">
              D
            </div>
            <div className="leading-none">
              <div className="text-[11px] font-bold">CAMPUS CLAIM</div>
              <div className="mt-0.5 text-[8px] uppercase tracking-[0.15em] text-amber-200/50">
                paper.io · DSCE
              </div>
            </div>
            <span
              className={`ml-1 rounded px-1.5 py-0.5 text-[8px] font-bold ${
                status === "live"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-amber-500/20 text-amber-300"
              }`}
            >
              {status === "live" ? "LIVE" : "…"}
            </span>
          </div>

          {me && (
            <div className="hud-panel flex items-center gap-2 px-2.5 py-1.5">
              <span
                className="h-3 w-3 rounded-full border border-white/40"
                style={{ backgroundColor: me.color }}
              />
              <div className="leading-none">
                <div className="text-[10px] font-bold">{me.name}</div>
                <div className="mt-0.5 font-mono text-[9px] text-white/50">
                  {me.cells} cells · {myPct}% · ⚔{me.kills}
                </div>
              </div>
              {me.drawing && (
                <span className="animate-pulse rounded bg-rose-500/25 px-1.5 py-0.5 text-[8px] font-bold text-rose-300">
                  TRAIL
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={handleLocate}
              className="hud-panel px-2 py-1 text-[9px] font-bold text-sky-200"
            >
              ◎ GPS {gps.status === "tracking" ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              onClick={() => setWalkMode((v) => !v)}
              className={`hud-panel px-2 py-1 text-[9px] font-bold ${
                walkMode ? "text-amber-200" : "text-white/40"
              }`}
            >
              {walkMode ? "Walk" : "Pan"}
            </button>
            <button
              type="button"
              onClick={() => setFollowMe((v) => !v)}
              className={`hud-panel px-2 py-1 text-[9px] font-bold ${
                followMe ? "text-emerald-300" : "text-white/40"
              }`}
            >
              Follow
            </button>
          </div>
        </div>

        {/* Leaderboard + feed */}
        <div className="pointer-events-auto flex w-[148px] flex-col gap-1.5 sm:w-[168px]">
          <div className="hud-panel px-2 py-1.5">
            <div className="mb-1 text-[8px] font-bold uppercase tracking-widest text-white/30">
              Territory
            </div>
            <div className="space-y-1">
              {leaderboard.length === 0 && (
                <p className="text-[9px] text-white/30">Waiting for players…</p>
              )}
              {leaderboard.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-1.5 text-[9px]"
                >
                  <span className="w-3 text-white/30">{i + 1}</span>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate font-semibold ${
                      p.id === myId ? "text-amber-200" : "text-white/80"
                    }`}
                  >
                    {p.name}
                  </span>
                  <span className="font-mono text-white/40">
                    {((p.cells / totalCells) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="hud-panel max-h-28 overflow-y-auto px-2 py-1.5">
            <div className="mb-1 text-[8px] font-bold uppercase tracking-widest text-white/30">
              Feed
            </div>
            <div className="space-y-1">
              {events.slice(0, 8).map((e) => (
                <p
                  key={e.id}
                  className={`text-[8px] leading-snug ${
                    e.target === myId || e.by === myId
                      ? "text-amber-200/90"
                      : "text-white/40"
                  }`}
                >
                  {e.message}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Death overlay */}
      {dead && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/40">
          <div className="pointer-events-auto hud-panel px-6 py-5 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-400">
              Eliminated
            </p>
            <p className="mt-2 text-sm text-white/70">
              {respawnIn > 0
                ? `Respawn in ${respawnIn}s`
                : "Ready to drop back in"}
            </p>
            <button
              type="button"
              disabled={respawnIn > 0}
              onClick={handleRespawn}
              className="mt-3 rounded-lg bg-white/10 px-4 py-2 text-xs font-bold disabled:opacity-40"
            >
              Respawn
            </button>
          </div>
        </div>
      )}

      {/* Bottom tip */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-2.5">
        <div className="hud-panel px-3 py-1.5 text-center text-[8px] text-white/35">
          {walkMode
            ? "Walk mode: drag on map to move · switch to Pan to look around"
            : "Pan mode: drag to look · enable Walk or GPS to move"}
          {" · "}
          Loop trail home to claim · Cut trails to eliminate
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)",
        }}
      />

      {toast && (
        <div className="absolute bottom-16 left-1/2 z-40 -translate-x-1/2 hud-panel px-3 py-1.5 text-[11px] font-semibold text-amber-50">
          {toast}
        </div>
      )}
    </div>
  );
}
