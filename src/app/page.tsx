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

  // Local tick: countdown next star; when it hits 0, gain a star (client estimate)
  useEffect(() => {
    if (stars >= maxStars) return;
    const t = setInterval(() => {
      setNextStarIn((s) => {
        if (s <= 1) {
          setStars((prev) => {
            const next = Math.min(maxStars, prev + 1);
            // if still not full after this star, restart regen cycle
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

      // Optimistic: spend star + start/keep regen immediately
      setStars((prev) => {
        const next = Math.max(0, prev - 1);
        return next;
      });
      setNextStarIn((prev) => (prev > 0 ? prev : regenSeconds));

      socket.emit(
        "place",
        { x, y, color: selectedColor, name },
        (res: {
          ok?: boolean;
          error?: string;
          nextStarIn?: number;
          stars?: number;
          quota?: QuotaUpdate;
          pixel?: Pixel;
        }) => {
          if (res?.quota) applyQuota(res.quota);
          if (res?.error) {
            showToast(res.error);
            return;
          }
        }
      );
    },
    [socket, name, stars, nextStarIn, selectedColor, regenSeconds, showToast, applyQuota]
  );

  const canPlace = Boolean(name) && status === "live" && stars >= 1;

  const pixelCount = pixels.size;
  const isFull = stars >= maxStars;

  const statusLabel = useMemo(() => {
    if (status === "live") return "Live";
    if (status === "connecting") return "Connecting…";
    return "Reconnecting…";
  }, [status]);

  const regenProgress =
    !isFull && regenSeconds > 0
      ? Math.max(0, Math.min(100, ((regenSeconds - nextStarIn) / regenSeconds) * 100))
      : 100;

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {!name && <NameGate onJoin={handleJoin} />}

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">
              DSCE Place
            </h1>
            <p className="text-xs text-slate-400">
              Dayananda Sagar · Kumaraswamy Layout
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
              stars > 0
                ? "bg-amber-500/15 text-amber-200"
                : "bg-rose-500/15 text-rose-300"
            }`}
            title="Paint stars — regenerate over time"
          >
            <span aria-hidden>★</span>
            {stars}/{maxStars}
            {!isFull && nextStarIn > 0 && (
              <span className="text-amber-400/80">+1 in {nextStarIn}s</span>
            )}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
              status === "live"
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
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
          </span>
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-slate-300">
            {online} online
          </span>
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-slate-300">
            {pixelCount.toLocaleString()} pixels
          </span>
          {name && (
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem(NAME_KEY);
                setName(null);
              }}
              className="rounded-full bg-sky-500/15 px-2.5 py-1 text-sky-300 hover:bg-sky-500/25"
            >
              {name}
            </button>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        <section className="min-h-[55vh] flex-1 lg:min-h-0">
          <PixelCanvas
            gridWidth={grid.w}
            gridHeight={grid.h}
            pixels={pixels}
            selectedColor={selectedColor}
            canPlace={canPlace}
            onPlace={handlePlace}
            hoverInfo={hoverPixel}
            onHover={(p, x, y) => {
              setHoverPixel(p);
              setHoverCell({ x, y });
            }}
          />
        </section>

        <aside className="flex w-full flex-col gap-4 rounded-xl border border-white/10 bg-slate-900/60 p-4 lg:w-72">
          <div>
            <h2 className="text-sm font-semibold text-white">Paint campus</h2>
            <p className="mt-1 text-xs text-slate-400">
              Each pixel costs ★1. Regen starts the moment you paint — +1 star
              every {regenSeconds}s (max {maxStars}).
            </p>
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-amber-100">Stars</span>
              <span className="font-semibold text-amber-300">
                ★ {stars} / {maxStars}
              </span>
            </div>
            {!isFull ? (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all duration-1000 linear"
                    style={{ width: `${regenProgress}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-amber-200/70">
                  Next star in {nextStarIn}s · regenerating now
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-[11px] text-emerald-300/80">
                Full bank — paint to start regenerating
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Color
            </p>
            <ColorPalette
              colors={palette}
              selected={selectedColor}
              onSelect={setSelectedColor}
            />
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Selected</span>
              <span
                className="h-5 w-5 rounded border border-white/30"
                style={{ backgroundColor: selectedColor }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-slate-400">Cell</span>
              <span className="font-mono text-slate-200">
                {hoverCell.x >= 0 ? `${hoverCell.x}, ${hoverCell.y}` : "—"}
              </span>
            </div>
          </div>

          <div className="mt-auto space-y-2 text-[11px] leading-relaxed text-slate-500">
            <p>
              Grid {grid.w}×{grid.h}. Stars are per IP — changing name does not
              refill them.
            </p>
            <p>Scroll to zoom · drag to pan · click to place.</p>
          </div>
        </aside>
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-white/10 bg-slate-900 px-4 py-2 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
