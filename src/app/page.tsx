"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import NameGate from "@/components/NameGate";
import PixelCanvas from "@/components/PixelCanvas";
import ColorPalette from "@/components/ColorPalette";
import {
  COLOR_PALETTE,
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_STARS,
  REGEN_SECONDS,
} from "@/lib/config";
import type { Pixel, QuotaUpdate, ServerHello } from "@/lib/types";

const NAME_KEY = "dsce-place-name";

export default function Home() {
  const [name, setName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pixels, setPixels] = useState<Map<string, Pixel>>(() => new Map());
  const [selectedColor, setSelectedColor] = useState<string>(COLOR_PALETTE[6]);
  const [stars, setStars] = useState(MAX_STARS);
  const [maxStars, setMaxStars] = useState(MAX_STARS);
  const [nextStarIn, setNextStarIn] = useState(0);
  const [regenSeconds, setRegenSeconds] = useState(REGEN_SECONDS);
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

  useEffect(() => {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) setName(saved);
    setReady(true);
  }, []);

  const applyQuota = useCallback((quota: QuotaUpdate) => {
    setStars(quota.stars);
    setMaxStars(quota.maxStars);
    setNextStarIn(quota.nextStarIn);
    setRegenSeconds(quota.regenSeconds);
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

  useEffect(() => {
    const s = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      autoConnect: true,
    });

    setSocket(s);

    s.on("connect", () => setStatus("live"));
    s.on("disconnect", () => setStatus("offline"));

    s.on("hello", (hello: ServerHello) => {
      const map = new Map<string, Pixel>();
      for (const p of hello.pixels) {
        map.set(`${p.x},${p.y}`, p);
      }
      setPixels(map);
      setGrid({ w: hello.gridWidth, h: hello.gridHeight });
      setMaxStars(hello.maxStars);
      setRegenSeconds(hello.regenSeconds);
      setOnline(hello.onlineCount);
      if (hello.palette?.length) setPalette(hello.palette);
      if (hello.quota) applyQuota(hello.quota);
      setStatus("live");
    });

    s.on("pixel", ({ pixel }: { pixel: Pixel }) => {
      setPixels((prev) => {
        const next = new Map(prev);
        next.set(`${pixel.x},${pixel.y}`, pixel);
        return next;
      });
    });

    s.on("quota", (quota: QuotaUpdate) => {
      applyQuota(quota);
    });

    s.on("online", ({ count }: { count: number }) => {
      setOnline(count);
    });

    return () => {
      s.disconnect();
    };
  }, [applyQuota]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const handleJoin = (n: string) => {
    localStorage.setItem(NAME_KEY, n);
    setName(n);
  };

  const handlePlace = useCallback(
    (x: number, y: number) => {
      if (!socket || !name) return;
      if (stars < 1) {
        showToast(
          nextStarIn > 0
            ? `No stars — next in ${nextStarIn}s`
            : "No stars left"
        );
        return;
      }

      setStars((prev) => Math.max(0, prev - 1));
      setNextStarIn((prev) => (prev > 0 ? prev : regenSeconds));

      socket.emit(
        "place",
        { x, y, color: selectedColor, name },
        (res: {
          ok?: boolean;
          error?: string;
          quota?: QuotaUpdate;
        }) => {
          if (res?.quota) applyQuota(res.quota);
          if (res?.error) showToast(res.error);
        }
      );
    },
    [socket, name, stars, nextStarIn, selectedColor, regenSeconds, showToast, applyQuota]
  );

  const canPlace = Boolean(name) && status === "live" && stars >= 1;
  const pixelCount = pixels.size;
  const isFull = stars >= maxStars;

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

      {/* Full-screen map */}
      <PixelCanvas
        gridWidth={grid.w}
        gridHeight={grid.h}
        pixels={pixels}
        selectedColor={selectedColor}
        canPlace={canPlace}
        onPlace={handlePlace}
        onHover={(p, x, y) => {
          setHoverPixel(p);
          setHoverCell({ x, y });
        }}
      />

      {/* ── TOP HUD ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-2.5 sm:p-3">
        {/* Left: brand + status */}
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
                Kumaraswamy
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
                    ? "bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399]"
                    : "bg-amber-400"
                }`}
              />
              {statusLabel}
            </div>
          </div>

          {hoverPixel && (
            <div className="hud-panel px-2 py-1 text-[9px] text-slate-300">
              by{" "}
              <span className="font-semibold text-amber-200">
                {hoverPixel.name}
              </span>
              {hoverCell.x >= 0 && (
                <span className="ml-1.5 font-mono text-slate-500">
                  {hoverCell.x},{hoverCell.y}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: stars / timer / meta — premium compact gaming cluster */}
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <div className="hud-panel flex items-center gap-2 px-2.5 py-1.5">
            {/* Stars */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.7)]">
                ★
              </span>
              <span className="font-mono text-[12px] font-bold tabular-nums text-amber-100">
                {stars}
                <span className="text-amber-200/40">/{maxStars}</span>
              </span>
            </div>

            <div className="h-3 w-px bg-white/10" />

            {/* Regen timer */}
            <div className="flex min-w-[52px] flex-col items-end">
              {isFull ? (
                <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-400/90">
                  Maxed
                </span>
              ) : (
                <>
                  <span className="font-mono text-[11px] font-bold tabular-nums text-sky-200">
                    {String(nextStarIn).padStart(2, "0")}
                    <span className="text-[8px] font-medium text-sky-300/50">
                      s
                    </span>
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
          </div>

          <div className="hud-panel flex items-center gap-2 px-2 py-1 text-[9px] text-slate-300">
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
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem(NAME_KEY);
                    setName(null);
                  }}
                  className="max-w-[72px] truncate font-semibold text-amber-200/90 hover:text-amber-100"
                  title="Change name"
                >
                  {name}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── BOTTOM: color palette bar ── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-2.5 sm:p-3">
        <div className="pointer-events-auto hud-panel max-w-[min(100%,560px)] px-2.5 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
            <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/35">
              Loadout
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className="h-3.5 w-3.5 rounded-sm border border-white/40 shadow"
                style={{ backgroundColor: selectedColor }}
              />
              <button
                type="button"
                onClick={() => setHudOpen((v) => !v)}
                className="text-[8px] font-semibold uppercase tracking-wider text-white/40 hover:text-white/70"
              >
                {hudOpen ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {hudOpen && (
            <ColorPalette
              colors={palette}
              selected={selectedColor}
              onSelect={setSelectedColor}
              compact
            />
          )}
          <p className="mt-1.5 text-center text-[8px] text-white/25">
            Scroll zoom · Pinch · Drag pan · Double‑click reset · Tap to paint
          </p>
        </div>
      </div>

      {/* Soft vignette for premium look */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)",
        }}
      />

      {toast && (
        <div className="absolute bottom-24 left-1/2 z-40 -translate-x-1/2 hud-panel px-3 py-1.5 text-[11px] font-medium text-amber-50 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
