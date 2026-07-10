"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import NameGate from "@/components/NameGate";
import PixelCanvas, { type PixelCanvasHandle } from "@/components/PixelCanvas";
import ColorPalette from "@/components/ColorPalette";
import {
  COLOR_PALETTE,
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_STARS,
  POWERUPS,
  REGEN_SECONDS,
  TEAMS,
  TEAM_COLORS,
  colorForTeam,
  type GameMode,
  type TeamId,
  type WaveDir,
} from "@/lib/config";
import type {
  FreeScoreRow,
  Pixel,
  PixelsBatchEvent,
  QuotaUpdate,
  ScoresUpdate,
  ServerHello,
  TeamScoreRow,
  ToolId,
} from "@/lib/types";

const NAME_KEY = "dsce-place-name";
const MODE_KEY = "dsce-place-mode";
const TEAM_KEY = "dsce-place-team";
const DEVICE_KEY = "dsce-place-device-id";
const TEAM_LOCKED_KEY = "dsce-place-team-locked";

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    // Also mirror in cookie (same browser, all tabs) for 1 year
    document.cookie = `dsce_device=${encodeURIComponent(id)};path=/;max-age=31536000;SameSite=Lax`;
    return id;
  } catch {
    return `d-tmp-${Date.now()}`;
  }
}

export default function Home() {
  const [name, setName] = useState<string | null>(null);
  const [mode, setMode] = useState<GameMode>("free");
  const [team, setTeam] = useState<TeamId | null>(null);
  const [teamLocked, setTeamLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string>("");
  const [pixels, setPixels] = useState<Map<string, Pixel>>(() => new Map());
  const [pixelsRevision, setPixelsRevision] = useState(0);
  const [selectedColor, setSelectedColor] = useState<string>(COLOR_PALETTE[6]);
  const [tool, setTool] = useState<ToolId>("paint");
  const [waveDir, setWaveDir] = useState<WaveDir>("right");
  const [stars, setStars] = useState(MAX_STARS);
  const [maxStars, setMaxStars] = useState(MAX_STARS);
  const [nextStarIn, setNextStarIn] = useState(0);
  const [regenSeconds, setRegenSeconds] = useState(REGEN_SECONDS);
  const [multiplierUntil, setMultiplierUntil] = useState(0);
  const [online, setOnline] = useState(0);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">(
    "connecting"
  );
  const [toast, setToast] = useState<string | null>(null);
  const [hoverPixel, setHoverPixel] = useState<Pixel | null>(null);
  const [hoverCell, setHoverCell] = useState({ x: -1, y: -1 });
  const [socket, setSocket] = useState<Socket | null>(null);
  const [palette, setPalette] = useState<readonly string[]>(COLOR_PALETTE);
  const [grid, setGrid] = useState({ w: GRID_WIDTH, h: GRID_HEIGHT });
  const [hudOpen, setHudOpen] = useState(true);
  const [teamScores, setTeamScores] = useState<TeamScoreRow[]>([]);
  const [freeScores, setFreeScores] = useState<FreeScoreRow[]>([]);
  const [nowTick, setNowTick] = useState(Date.now());
  /** Modal: pick branch when switching Free → Team */
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [pendingTeam, setPendingTeam] = useState<TeamId>("CSE");
  const [ipMasked, setIpMasked] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

  const canvasRef = useRef<PixelCanvasHandle>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /** Active paint color: team lock in team mode */
  const activeColor = useMemo(() => {
    if (mode === "team" && team) return colorForTeam(team);
    return selectedColor;
  }, [mode, team, selectedColor]);

  useEffect(() => {
    const id = getOrCreateDeviceId();
    setDeviceId(id);
    // Restore local session immediately (no re-ask on refresh)
    const savedName = localStorage.getItem(NAME_KEY);
    const savedMode = localStorage.getItem(MODE_KEY) as GameMode | null;
    const savedTeam = localStorage.getItem(TEAM_KEY) as TeamId | null;
    // Only true after an explicit confirmed team pick
    const locked = localStorage.getItem(TEAM_LOCKED_KEY) === "1";
    if (savedName) {
      setName(savedName);
      if (savedMode === "free" || savedMode === "team") setMode(savedMode);
      // Team only restored if it was locked (chosen once)
      if (locked && savedTeam && TEAMS.includes(savedTeam)) {
        setTeam(savedTeam);
        setTeamLocked(true);
        setSelectedColor(colorForTeam(savedTeam));
      } else {
        setTeam(null);
        setTeamLocked(false);
      }
    }
    setReady(true);
  }, []);

  // Multiplier countdown tick
  useEffect(() => {
    if (multiplierUntil <= Date.now()) return;
    const t = setInterval(() => setNowTick(Date.now()), 250);
    return () => clearInterval(t);
  }, [multiplierUntil]);

  const applyQuota = useCallback((quota: QuotaUpdate) => {
    setStars(quota.stars);
    setMaxStars(quota.maxStars);
    setNextStarIn(quota.nextStarIn);
    setRegenSeconds(quota.regenSeconds);
    setMultiplierUntil(quota.multiplierUntil || 0);
    if (quota.ipMasked) setIpMasked(quota.ipMasked);
    if (typeof quota.isAdmin === "boolean") setIsAdmin(quota.isAdmin);
  }, []);

  useEffect(() => {
    if (stars >= maxStars) return;
    const t = setInterval(() => {
      setNextStarIn((s) => {
        if (s <= 1) {
          setStars((prev) => {
            const next = Math.min(maxStars, prev + 1);
            if (next < maxStars) {
              queueMicrotask(() => setNextStarIn(regenSeconds));
            } else {
              queueMicrotask(() => setNextStarIn(0));
            }
            return next;
          });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [stars < maxStars, maxStars, regenSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyIdentity = useCallback(
    (id: NonNullable<ServerHello["identity"]>) => {
      setName(id.name);
      setMode(id.mode);
      localStorage.setItem(NAME_KEY, id.name);
      localStorage.setItem(MODE_KEY, id.mode);
      // Team only if server has locked it (chosen once)
      if (id.teamLocked && id.team) {
        setTeam(id.team);
        setTeamLocked(true);
        localStorage.setItem(TEAM_KEY, id.team);
        localStorage.setItem(TEAM_LOCKED_KEY, "1");
        setSelectedColor(colorForTeam(id.team));
      } else if (id.mode === "team" && !id.teamLocked) {
        // Needs to pick — don't invent CSE
        setTeam(null);
        setTeamLocked(false);
        localStorage.removeItem(TEAM_LOCKED_KEY);
      } else if (id.mode === "free") {
        // Keep locked team on file for later, but don't force mode team
        if (id.teamLocked && id.team) {
          setTeam(id.team);
          setTeamLocked(true);
          localStorage.setItem(TEAM_KEY, id.team);
          localStorage.setItem(TEAM_LOCKED_KEY, "1");
        }
      }
    },
    []
  );

  const applyHello = useCallback(
    (hello: ServerHello) => {
      const map = new Map<string, Pixel>();
      for (const p of hello.pixels) map.set(`${p.x},${p.y}`, p);
      setPixels(map);
      setPixelsRevision((n) => n + 1);
      setGrid({ w: hello.gridWidth, h: hello.gridHeight });
      setMaxStars(hello.maxStars);
      setRegenSeconds(hello.regenSeconds);
      setOnline(hello.onlineCount);
      if (hello.palette?.length) setPalette(hello.palette);
      if (hello.quota) applyQuota(hello.quota);
      setMode(hello.mode);
      setTeamScores(hello.teamScores || []);
      setFreeScores(hello.freeScores || []);
      // Server IP/device identity wins — skip name gate on refresh
      if (hello.identity?.name) {
        applyIdentity(hello.identity);
      }
      setStatus("live");
    },
    [applyQuota, applyIdentity]
  );

  useEffect(() => {
    if (!deviceId) return;
    // polling first = more reliable on campus/office Wi‑Fi & Windows laptops
    // where raw WebSockets are often blocked; upgrades to websocket when possible
    const s = io({
      path: "/socket.io",
      transports: ["polling", "websocket"],
      upgrade: true,
      rememberUpgrade: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 800,
      timeout: 20000,
      auth: { deviceId },
    });
    setSocket(s);

    s.on("connect", () => {
      setStatus("live");
      setToast(null);
      s.emit("helloDevice", { deviceId });
      // Auto-redeem admin from URL once: ?admin=YOUR_SECRET
      try {
        const params = new URLSearchParams(window.location.search);
        const secret = params.get("admin");
        if (secret) {
          s.emit(
            "claimAdmin",
            { secret, deviceId, name: localStorage.getItem(NAME_KEY) || undefined },
            (res: { ok?: boolean; error?: string; quota?: QuotaUpdate }) => {
              if (res?.quota) applyQuota(res.quota);
              if (res?.ok) {
                setIsAdmin(true);
                setToast("Admin unlocked · unlimited ★");
                setTimeout(() => setToast(null), 2500);
                const u = new URL(window.location.href);
                u.searchParams.delete("admin");
                window.history.replaceState({}, "", u.pathname + u.search);
              } else if (res?.error) {
                setToast(res.error);
                setTimeout(() => setToast(null), 2500);
              }
            }
          );
        }
      } catch {
        /* ignore */
      }
    });
    s.on("disconnect", (reason) => {
      setStatus("offline");
      if (reason !== "io client disconnect") {
        setToast("Connection lost — reconnecting…");
      }
    });
    s.on("connect_error", () => {
      setStatus("offline");
      setToast("Can't reach server — check Wi‑Fi / try another network");
    });
    s.io.on("reconnect", () => {
      setStatus("live");
      setToast("Back online");
      setTimeout(() => setToast(null), 1500);
      s.emit("helloDevice", { deviceId });
    });

    s.on("hello", (hello: ServerHello) => applyHello(hello));

    s.on("pixels", (batch: PixelsBatchEvent) => {
      if (batch.mode !== modeRef.current) return;
      setPixels((prev) => {
        const next = new Map(prev);
        if (batch.erased) {
          for (const e of batch.erased) next.delete(`${e.x},${e.y}`);
        }
        if (batch.pixels) {
          for (const p of batch.pixels) next.set(`${p.x},${p.y}`, p);
        }
        return next;
      });
      setPixelsRevision((n) => n + 1);
      if (batch.fx) canvasRef.current?.spawnFx(batch.fx);
    });

    s.on("scores", (s: ScoresUpdate) => {
      setTeamScores(s.teamScores);
      setFreeScores(s.freeScores);
    });

    s.on("quota", (quota: QuotaUpdate) => applyQuota(quota));
    s.on("online", ({ count }: { count: number }) => setOnline(count));

    return () => {
      s.disconnect();
    };
  }, [deviceId, applyHello, applyQuota]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const handleJoin = (n: string, m: GameMode, t: TeamId | null) => {
    localStorage.setItem(NAME_KEY, n);
    localStorage.setItem(MODE_KEY, m);
    setName(n);
    setMode(m);

    if (m === "team" && t) {
      // Explicit first pick from name gate → lock
      localStorage.setItem(TEAM_KEY, t);
      localStorage.setItem(TEAM_LOCKED_KEY, "1");
      setTeam(t);
      setTeamLocked(true);
      setSelectedColor(colorForTeam(t));
    } else {
      // Free mode — do not invent a team
      setTeam(teamLocked ? team : null);
    }

    socket?.emit(
      "joinMode",
      { mode: m, team: m === "team" ? t : null, name: n, deviceId },
      (res: { error?: string; identity?: ServerHello["identity"] }) => {
        if (res?.error) showToast(res.error);
        if (res?.identity) applyIdentity(res.identity);
      }
    );
  };

  /** Confirm team once from the selection menu — then permanently locked */
  const enterTeamMode = (t: TeamId) => {
    if (!name) return;
    if (teamLocked && team) {
      // Already locked — only allow re-entry with same team
      setTeamPickerOpen(false);
      socket?.emit("joinMode", { mode: "team", team, name, deviceId });
      showToast(`Team Mode · ${team}`);
      return;
    }

    socket?.emit(
      "joinMode",
      { mode: "team", team: t, name, deviceId },
      (res: {
        error?: string;
        identity?: ServerHello["identity"];
        ok?: boolean;
      }) => {
        if (res?.error) {
          showToast(res.error);
          if (res.identity) applyIdentity(res.identity);
          return;
        }
        setTeam(t);
        setMode("team");
        setTeamLocked(true);
        setSelectedColor(colorForTeam(t));
        localStorage.setItem(MODE_KEY, "team");
        localStorage.setItem(TEAM_KEY, t);
        localStorage.setItem(TEAM_LOCKED_KEY, "1");
        if (res?.identity) applyIdentity(res.identity);
        setTeamPickerOpen(false);
        showToast(`Team Mode · ${t} (locked)`);
      }
    );
  };

  const switchMode = (m: GameMode) => {
    if (!name) return;

    if (m === "team") {
      // Already chose once → go straight into team world
      if (teamLocked && team) {
        socket?.emit(
          "joinMode",
          { mode: "team", team, name, deviceId },
          (res: { error?: string; identity?: ServerHello["identity"] }) => {
            if (res?.error) showToast(res.error);
            if (res?.identity) applyIdentity(res.identity);
            else setMode("team");
            showToast(`Team Mode · ${team}`);
          }
        );
        return;
      }
      // First time → always open picker (never auto-assign CSE)
      setPendingTeam("CSE"); // visual default only, not submitted until Join
      setTeamPickerOpen(true);
      return;
    }

    // Free mode
    socket?.emit(
      "joinMode",
      { mode: "free", team: null, name, deviceId },
      (res: { error?: string; identity?: ServerHello["identity"] }) => {
        if (res?.error) showToast(res.error);
        if (res?.identity) applyIdentity(res.identity);
        else {
          setMode("free");
          localStorage.setItem(MODE_KEY, "free");
        }
        showToast("Switched to Free Mode");
      }
    );
  };

  const toolCost = useMemo(() => {
    if (tool === "paint" || tool === "eraser") return 1;
    if (tool === "bomb") return POWERUPS.bomb.cost;
    if (tool === "multiplier") return POWERUPS.multiplier.cost;
    if (tool === "wave") return POWERUPS.wave.cost;
    return 1;
  }, [tool]);

  const handlePlace = useCallback(
    (x: number, y: number) => {
      if (!socket || !name) return;
      if (!isAdmin && stars < toolCost) {
        showToast(
          nextStarIn > 0
            ? `Need ${toolCost}★ — next star in ${nextStarIn}s`
            : `Need ${toolCost} stars`
        );
        return;
      }

      // Optimistic star spend for paint/eraser only (powerups server-authoritative)
      if (!isAdmin && (tool === "paint" || tool === "eraser")) {
        setStars((prev) => Math.max(0, prev - 1));
        setNextStarIn((prev) => (prev > 0 ? prev : regenSeconds));
      }
      if (tool === "paint") {
        canvasRef.current?.spawnFx({
          type: "paint",
          x,
          y,
          color: activeColor,
          points: multiplierUntil > Date.now() ? 2 : 1,
        });
      } else if (tool === "eraser") {
        canvasRef.current?.spawnFx({ type: "erase", x, y, points: 0 });
      }

      socket.emit(
        "action",
        {
          x,
          y,
          color: activeColor,
          name,
          mode,
          team,
          tool,
          dir: waveDir,
        },
        (res: {
          ok?: boolean;
          error?: string;
          quota?: QuotaUpdate;
          points?: number;
        }) => {
          if (res?.quota) applyQuota(res.quota);
          if (res?.error) showToast(res.error);
        }
      );
    },
    [
      socket,
      name,
      stars,
      toolCost,
      nextStarIn,
      tool,
      activeColor,
      mode,
      team,
      waveDir,
      regenSeconds,
      multiplierUntil,
      isAdmin,
      showToast,
      applyQuota,
    ]
  );

  const activateMultiplier = () => {
    if (!socket || !name) return;
    if (!isAdmin && stars < POWERUPS.multiplier.cost) {
      showToast(`Need ${POWERUPS.multiplier.cost}★ for multiplier`);
      return;
    }
    socket.emit(
      "action",
      {
        x: 0,
        y: 0,
        color: activeColor,
        name,
        mode,
        team,
        tool: "multiplier",
      },
      (res: { ok?: boolean; error?: string; quota?: QuotaUpdate }) => {
        if (res?.quota) applyQuota(res.quota);
        if (res?.error) showToast(res.error);
        else showToast("2× score for 20s!");
      }
    );
  };

  const canPlace =
    Boolean(name) &&
    status === "live" &&
    (isAdmin || stars >= toolCost) &&
    tool !== "multiplier";

  const redeemAdminPrompt = () => {
    if (!socket) return;
    const secret = window.prompt("Admin secret (only for you):");
    if (!secret) return;
    socket.emit(
      "claimAdmin",
      { secret: secret.trim(), deviceId, name: name || undefined },
      (res: { ok?: boolean; error?: string; quota?: QuotaUpdate }) => {
        if (res?.error) showToast(res.error);
        if (res?.quota) applyQuota(res.quota);
        if (res?.ok) {
          setIsAdmin(true);
          showToast("Admin unlocked · unlimited ★");
        }
      }
    );
  };

  const pixelCount = pixels.size;
  const isFull = stars >= maxStars;
  const multActive = multiplierUntil > nowTick;
  const multLeft = multActive
    ? Math.ceil((multiplierUntil - nowTick) / 1000)
    : 0;

  const statusLabel = useMemo(() => {
    if (status === "live") return "LIVE";
    if (status === "connecting") return "SYNC…";
    return "OFFLINE";
  }, [status]);

  const regenProgress =
    !isFull && regenSeconds > 0
      ? Math.max(
          0,
          Math.min(100, ((regenSeconds - nextStarIn) / regenSeconds) * 100)
        )
      : 100;

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#070b14] text-amber-200/60">
        <span className="text-xs tracking-[0.3em] uppercase">Booting…</span>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#070b14] text-slate-100">
      {!name && <NameGate onJoin={handleJoin} />}

      {/* Team picker when switching Free → Team */}
      {teamPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="hud-panel w-full max-w-sm p-5">
            <h2 className="text-center text-sm font-bold text-white">
              Pick your branch
            </h2>
            <p className="mt-1 text-center text-[11px] text-white/40">
              Each team paints with one color only.
            </p>
            <p className="mt-2 text-center text-[11px] font-bold text-red-500">
              Can&apos;t be changed after you join
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {TEAMS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPendingTeam(t)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-bold transition ${
                    pendingTeam === t
                      ? "border-white/50 bg-white/10 text-white"
                      : "border-white/10 bg-black/30 text-white/60 hover:border-white/25"
                  }`}
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-white/30"
                    style={{ backgroundColor: TEAM_COLORS[t] }}
                  />
                  {t}
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setTeamPickerOpen(false)}
                className="flex-1 rounded-lg border border-white/10 py-2 text-xs font-semibold text-white/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => enterTeamMode(pendingTeam)}
                className="flex-1 rounded-lg bg-gradient-to-r from-sky-400 to-blue-500 py-2 text-xs font-bold text-black"
              >
                Join {pendingTeam}
              </button>
            </div>
          </div>
        </div>
      )}

      <PixelCanvas
        ref={canvasRef}
        gridWidth={grid.w}
        gridHeight={grid.h}
        pixels={pixels}
        pixelsRevision={pixelsRevision}
        selectedColor={activeColor}
        canPlace={canPlace}
        tool={tool === "multiplier" ? "paint" : tool}
        waveDir={waveDir}
        onPlace={handlePlace}
        onHover={(p, x, y) => {
          setHoverPixel(p);
          setHoverCell({ x, y });
        }}
      />

      {/* TOP HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2.5 sm:p-3">
        <div className="pointer-events-auto flex flex-col gap-1.5">
          <div className="hud-panel flex items-center gap-2 px-2.5 py-1.5">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-amber-400 to-orange-600 text-[10px] font-black text-black shadow-inner">
              D
            </div>
            <div className="leading-none">
              <div className="text-[11px] font-bold tracking-wide text-white">
                DSCE PLACE
              </div>
              <div className="mt-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-amber-200/60">
                {mode === "team" ? `Team · ${team ?? "—"}` : "Free Mode"}
              </div>
            </div>
            <div
              className={`ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-bold tracking-wider ${
                status === "live"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-amber-500/20 text-amber-300"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "live"
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-amber-400"
                }`}
              />
              {statusLabel}
            </div>
          </div>

          {/* Mode switch */}
          {name && (
            <div className="hud-panel flex gap-1 p-1">
              <button
                type="button"
                onClick={() => switchMode("free")}
                className={`rounded px-2 py-1 text-[9px] font-bold ${
                  mode === "free"
                    ? "bg-amber-500/25 text-amber-100"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                Free
              </button>
              <button
                type="button"
                onClick={() => switchMode("team")}
                className={`rounded px-2 py-1 text-[9px] font-bold ${
                  mode === "team"
                    ? "bg-sky-500/25 text-sky-100"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                Team
              </button>
            </div>
          )}

          {multActive && (
            <div className="hud-panel border border-fuchsia-400/40 bg-fuchsia-500/15 px-2.5 py-1.5 text-[10px] font-bold text-fuchsia-200">
              2× SCORE · {multLeft}s
            </div>
          )}

          {hoverPixel && (
            <div className="hud-panel px-2 py-1 text-[9px] text-slate-300">
              by{" "}
              <span className="font-semibold text-amber-200">
                {hoverPixel.name}
              </span>
              {hoverPixel.team && (
                <span className="ml-1 text-sky-300/80">{hoverPixel.team}</span>
              )}
              {hoverCell.x >= 0 && (
                <span className="ml-1.5 font-mono text-slate-500">
                  {hoverCell.x},{hoverCell.y}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <button
            type="button"
            onDoubleClick={redeemAdminPrompt}
            className="hud-panel flex items-center gap-2 px-2.5 py-1.5 text-left"
            title="Double-tap stars to enter admin secret (you only)"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-amber-300">★</span>
              <span className="font-mono text-[12px] font-bold tabular-nums text-amber-100">
                {isAdmin ? "∞" : stars}
                {!isAdmin && (
                  <span className="text-amber-200/40">/{maxStars}</span>
                )}
              </span>
            </div>
            <div className="h-3 w-px bg-white/10" />
            <div className="flex min-w-[52px] flex-col items-end">
              {isAdmin ? (
                <span className="text-[9px] font-bold uppercase tracking-wider text-fuchsia-300">
                  Admin
                </span>
              ) : isFull ? (
                <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-400/90">
                  Maxed
                </span>
              ) : (
                <>
                  <span className="font-mono text-[11px] font-bold tabular-nums text-sky-200">
                    {String(nextStarIn).padStart(2, "0")}
                    <span className="text-[8px] text-sky-300/50">s</span>
                  </span>
                  <div className="mt-0.5 h-[3px] w-12 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-300 transition-all duration-1000 linear"
                      style={{ width: `${regenProgress}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          </button>

          <div className="hud-panel flex flex-wrap items-center justify-end gap-2 px-2 py-1 text-[9px] text-slate-300">
            <span className="tabular-nums">
              <span className="text-white/90">{online}</span>
              <span className="text-slate-500"> online</span>
            </span>
            <span className="text-white/15">|</span>
            <span className="tabular-nums">
              <span className="text-white/90">
                {pixelCount.toLocaleString()}
              </span>
              <span className="text-slate-500"> px</span>
            </span>
            {name && (
              <>
                <span className="text-white/15">|</span>
                <span className="max-w-[72px] truncate font-semibold text-amber-200/90">
                  {name}
                </span>
              </>
            )}
          </div>
          {ipMasked && (
            <div
              className="hud-panel px-2 py-1 text-[8px] text-white/35"
              title="Stars are locked to your network IP — changing name does not reset them"
            >
              IP lock · {ipMasked}
            </div>
          )}

          {/* Leaderboard */}
          <div className="hud-panel max-h-40 w-[150px] overflow-y-auto px-2 py-1.5 sm:w-[168px]">
            <div className="mb-1 text-[8px] font-bold uppercase tracking-widest text-white/30">
              {mode === "team" ? "Team board" : "Top painters"}
            </div>
            {mode === "team" ? (
              <div className="space-y-0.5">
                {teamScores.slice(0, 8).map((r) => (
                  <div
                    key={r.team}
                    className={`flex items-center justify-between text-[9px] ${
                      r.team === team ? "text-sky-200" : "text-white/60"
                    }`}
                  >
                    <span className="font-semibold">{r.team}</span>
                    <span className="font-mono text-white/40">
                      {r.pixels}px · {r.score} · {r.percent}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-0.5">
                {freeScores.slice(0, 8).map((r) => (
                  <div
                    key={r.name}
                    className={`flex items-center justify-between text-[9px] ${
                      r.name === name ? "text-amber-200" : "text-white/60"
                    }`}
                  >
                    <span className="max-w-[70px] truncate font-semibold">
                      {r.name}
                    </span>
                    <span className="font-mono text-white/40">
                      {r.pixels} · {r.score}
                    </span>
                  </div>
                ))}
                {freeScores.length === 0 && (
                  <p className="text-[9px] text-white/30">Paint to rank</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM tools + palette */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-2.5 sm:p-3">
        <div className="pointer-events-auto hud-panel max-w-[min(100%,620px)] px-2.5 py-2">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-0.5">
            <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/35">
              Tools
            </span>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["paint", "Paint", 1],
                  ["eraser", "Eraser", 1],
                  ["bomb", "Bomb 5×5", POWERUPS.bomb.cost],
                  ["wave", "Wave×10", POWERUPS.wave.cost],
                ] as const
              ).map(([id, label, cost]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTool(id)}
                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                    tool === id
                      ? "bg-white/15 text-white"
                      : "text-white/40 hover:text-white/70"
                  }`}
                >
                  {label} ·{cost}★
                </button>
              ))}
              <button
                type="button"
                onClick={activateMultiplier}
                className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                  multActive
                    ? "bg-fuchsia-500/30 text-fuchsia-200"
                    : "text-white/40 hover:text-fuchsia-200/80"
                }`}
              >
                2× ·{POWERUPS.multiplier.cost}★
              </button>
            </div>
          </div>

          {tool === "wave" && (
            <div className="mb-1.5 flex justify-center gap-1">
              {(["up", "down", "left", "right"] as WaveDir[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setWaveDir(d)}
                  className={`rounded px-2 py-0.5 text-[9px] font-bold capitalize ${
                    waveDir === d
                      ? "bg-sky-500/30 text-sky-100"
                      : "text-white/35"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}

          <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
            <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/35">
              {mode === "team" ? "Team color" : "Color"}
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className="h-3.5 w-3.5 rounded-sm border border-white/40"
                style={{ backgroundColor: activeColor }}
              />
              {mode === "free" && (
                <button
                  type="button"
                  onClick={() => setHudOpen((v) => !v)}
                  className="text-[8px] font-semibold uppercase tracking-wider text-white/40"
                >
                  {hudOpen ? "Hide" : "Show"}
                </button>
              )}
            </div>
          </div>
          {mode === "team" && team ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <span
                className="h-6 w-6 rounded-md border border-white/30 shadow"
                style={{ backgroundColor: colorForTeam(team) }}
              />
              <div className="text-left">
                <div className="text-[11px] font-bold text-white">{team}</div>
                <div className="text-[9px] text-white/40">
                  Whole team paints this color
                </div>
              </div>
            </div>
          ) : (
            hudOpen && (
              <ColorPalette
                colors={palette}
                selected={selectedColor}
                onSelect={setSelectedColor}
                compact
              />
            )
          )}
          <p className="mt-1.5 text-center text-[8px] text-white/25">
            Scroll zoom · Drag pan · Stars locked per IP
          </p>
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)",
        }}
      />

      {toast && (
        <div className="absolute bottom-28 left-1/2 z-40 -translate-x-1/2 hud-panel px-3 py-1.5 text-[11px] font-medium text-amber-50 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
