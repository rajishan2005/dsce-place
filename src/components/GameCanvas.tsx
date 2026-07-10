"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { GeoPosition } from "@/lib/geo";
import { accuracyToGridRadius, latLngToGrid } from "@/lib/geo";
import type { PublicPlayer } from "@/lib/types";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/config";

export interface GameCanvasHandle {
  centerOn: (x: number, y: number, zoom?: number) => void;
  fitMap: (mode?: "contain" | "cover") => void;
  /** Convert screen pointer to grid (for desktop walk sim) */
  screenToGrid: (clientX: number, clientY: number) => { x: number; y: number } | null;
}

interface GameCanvasProps {
  players: PublicPlayer[];
  /** decoded ownership map */
  owners: Uint16Array;
  myId: number | null;
  userLocation?: GeoPosition | null;
  /** desktop: click-drag to walk */
  onWalk?: (x: number, y: number) => void;
  walkMode: boolean;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 48;

const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(
  function GameCanvas(
    { players, owners, myId, userLocation, onWalk, walkMode },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bgRef = useRef<HTMLImageElement | null>(null);
    const scaleRef = useRef(1);
    const offsetRef = useRef({ x: 0, y: 0 });
    const rafRef = useRef(0);
    const fittedRef = useRef(false);
    const pulseRef = useRef(0);
    const walkingRef = useRef(false);

    const dragRef = useRef<{
      pan: boolean;
      moved: boolean;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      pointerId: number;
    } | null>(null);

    const pinchRef = useRef<{
      active: boolean;
      startDist: number;
      startScale: number;
    } | null>(null);
    const pointers = useRef(new Map<number, { x: number; y: number }>());

    const colorById = useCallback(() => {
      const m = new Map<number, string>();
      for (const p of players) m.set(p.id, p.color);
      return m;
    }, [players]);

    const drawNow = useCallback(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 1 || h < 1) return;

      const bw = Math.floor(w * dpr);
      const bh = Math.floor(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;

      const scale = scaleRef.current;
      const offset = offsetRef.current;
      const colors = colorById();

      ctx.fillStyle = "#070b14";
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(offset.x, offset.y);
      ctx.scale(scale, scale);

      if (bgRef.current) {
        ctx.globalAlpha = 1;
        ctx.drawImage(bgRef.current, 0, 0, GRID_WIDTH, GRID_HEIGHT);
      } else {
        ctx.fillStyle = "#1a2332";
        ctx.fillRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
      }

      // Territory overlay
      ctx.globalAlpha = 0.55;
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const id = owners[y * GRID_WIDTH + x]!;
          if (!id) continue;
          const col = colors.get(id) || "#888";
          ctx.fillStyle = col;
          ctx.fillRect(x, y, 1, 1);
        }
      }
      ctx.globalAlpha = 1;

      // Slight dim
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, 0, GRID_WIDTH, GRID_HEIGHT);

      // Trails
      for (const p of players) {
        if (!p.alive || p.trail.length < 1) continue;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.9;
        for (const c of p.trail) {
          ctx.fillRect(c.x, c.y, 1, 1);
        }
        // brighter trail edge
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 0.08;
        if (p.trail.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(p.trail[0]!.x + 0.5, p.trail[0]!.y + 0.5);
          for (let i = 1; i < p.trail.length; i++) {
            ctx.lineTo(p.trail[i]!.x + 0.5, p.trail[i]!.y + 0.5);
          }
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 0.35;
          ctx.stroke();
        }
      }

      // Players
      for (const p of players) {
        if (!p.alive) continue;
        const isMe = p.id === myId;
        const r = isMe ? 1.4 : 1.1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.strokeStyle = isMe ? "#fff" : "rgba(255,255,255,0.7)";
        ctx.lineWidth = isMe ? 0.35 : 0.2;
        ctx.stroke();

        // name tag
        ctx.save();
        ctx.scale(1 / scale, 1 / scale);
        const sx = p.x * scale;
        const sy = p.y * scale;
        ctx.font = `bold ${isMe ? 11 : 10}px system-ui,sans-serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.fillStyle = "#fff";
        const label = isMe ? "YOU" : p.name;
        ctx.strokeText(label, sx, sy - 12);
        ctx.fillText(label, sx, sy - 12);
        ctx.restore();
      }

      // GPS accuracy (optional, under player)
      if (userLocation && myId) {
        const g = latLngToGrid(userLocation.lat, userLocation.lng);
        const rad = accuracyToGridRadius(userLocation.accuracy);
        const pulse = 0.5 + 0.5 * Math.sin(pulseRef.current);
        ctx.beginPath();
        ctx.arc(g.x, g.y, rad, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(56,189,248,${0.08 + 0.05 * pulse})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(56,189,248,${0.35})`;
        ctx.lineWidth = 0.1;
        ctx.stroke();
      }

      // border
      ctx.strokeStyle = "rgba(251,191,36,0.4)";
      ctx.lineWidth = Math.max(1.5 / scale, 0.05);
      ctx.strokeRect(0, 0, GRID_WIDTH, GRID_HEIGHT);

      ctx.restore();
    }, [players, owners, myId, userLocation, colorById]);

    const drawNowRef = useRef(drawNow);
    drawNowRef.current = drawNow;

    const scheduleDraw = useCallback(() => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        drawNowRef.current();
      });
    }, []);

    useEffect(() => {
      scheduleDraw();
    }, [drawNow, scheduleDraw]);

    useEffect(() => {
      let id = 0;
      const tick = () => {
        pulseRef.current += 0.07;
        scheduleDraw();
        id = requestAnimationFrame(tick);
      };
      id = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(id);
    }, [scheduleDraw]);

    useEffect(() => {
      const img = new Image();
      img.src = "/campus-satellite.jpg";
      img.onload = () => {
        bgRef.current = img;
        scheduleDraw();
      };
    }, [scheduleDraw]);

    const fitMap = useCallback(
      (mode: "contain" | "cover" = "cover") => {
        const container = containerRef.current;
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        const s =
          mode === "cover"
            ? Math.max(w / GRID_WIDTH, h / GRID_HEIGHT)
            : Math.min(w / GRID_WIDTH, h / GRID_HEIGHT) * 0.98;
        scaleRef.current = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
        offsetRef.current = {
          x: (w - GRID_WIDTH * scaleRef.current) / 2,
          y: (h - GRID_HEIGHT * scaleRef.current) / 2,
        };
        scheduleDraw();
      },
      [scheduleDraw]
    );

    const centerOn = useCallback(
      (x: number, y: number, zoom?: number) => {
        const container = containerRef.current;
        if (!container) return;
        if (zoom != null) {
          scaleRef.current = Math.min(MAX_SCALE, Math.max(MIN_SCALE, zoom));
        } else if (scaleRef.current < 8) {
          scaleRef.current = Math.max(scaleRef.current, 12);
        }
        const s = scaleRef.current;
        offsetRef.current = {
          x: container.clientWidth / 2 - x * s,
          y: container.clientHeight / 2 - y * s,
        };
        scheduleDraw();
      },
      [scheduleDraw]
    );

    const screenToGrid = useCallback((clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      const x = (cx - offsetRef.current.x) / scaleRef.current;
      const y = (cy - offsetRef.current.y) / scaleRef.current;
      if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return null;
      return { x, y };
    }, []);

    useImperativeHandle(
      ref,
      () => ({ centerOn, fitMap, screenToGrid }),
      [centerOn, fitMap, screenToGrid]
    );

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => {
        if (!fittedRef.current) {
          fitMap("cover");
          fittedRef.current = true;
        } else scheduleDraw();
      });
      ro.observe(el);
      fitMap("cover");
      fittedRef.current = true;
      return () => ro.disconnect();
    }, [fitMap, scheduleDraw]);

    const zoomAt = useCallback(
      (mx: number, my: number, factor: number) => {
        const old = scaleRef.current;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * factor));
        if (next === old) return;
        const ratio = next / old;
        const o = offsetRef.current;
        offsetRef.current = {
          x: mx - (mx - o.x) * ratio,
          y: my - (my - o.y) * ratio,
        };
        scaleRef.current = next;
        scheduleDraw();
      },
      [scheduleDraw]
    );

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        if (e.deltaMode === 2) dy *= 400;
        const intensity = e.ctrlKey ? 0.012 : 0.0022;
        zoomAt(
          e.clientX - rect.left,
          e.clientY - rect.top,
          Math.min(1.25, Math.max(0.8, Math.exp(-dy * intensity)))
        );
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, [zoomAt]);

    const pointerDist = () => {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
    };
    const pointerMid = () => {
      const pts = [...pointers.current.values()];
      const rect = containerRef.current!.getBoundingClientRect();
      return {
        x: (pts[0]!.x + pts[1]!.x) / 2 - rect.left,
        y: (pts[0]!.y + pts[1]!.y) / 2 - rect.top,
      };
    };

    const onPointerDown = (e: React.PointerEvent) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

      if (pointers.current.size === 2) {
        pinchRef.current = {
          active: true,
          startDist: pointerDist(),
          startScale: scaleRef.current,
        };
        dragRef.current = null;
        walkingRef.current = false;
        return;
      }

      if (e.button !== 0) return;

      // Walk mode: move avatar; else pan
      if (walkMode && onWalk) {
        walkingRef.current = true;
        const g = screenToGrid(e.clientX, e.clientY);
        if (g) onWalk(g.x, g.y);
        return;
      }

      dragRef.current = {
        pan: true,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        originX: offsetRef.current.x,
        originY: offsetRef.current.y,
        pointerId: e.pointerId,
      };
    };

    const onPointerMove = (e: React.PointerEvent) => {
      if (pointers.current.has(e.pointerId)) {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (pinchRef.current?.active && pointers.current.size >= 2) {
        const dist = pointerDist();
        const mid = pointerMid();
        const p = pinchRef.current;
        if (p.startDist > 0) {
          const target = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, p.startScale * (dist / p.startDist))
          );
          const ratio = target / scaleRef.current;
          const o = offsetRef.current;
          offsetRef.current = {
            x: mid.x - (mid.x - o.x) * ratio,
            y: mid.y - (mid.y - o.y) * ratio,
          };
          scaleRef.current = target;
          p.startDist = dist;
          p.startScale = target;
          scheduleDraw();
        }
        return;
      }

      if (walkingRef.current && walkMode && onWalk) {
        const g = screenToGrid(e.clientX, e.clientY);
        if (g) onWalk(g.x, g.y);
        return;
      }

      const drag = dragRef.current;
      if (drag?.pan && drag.pointerId === e.pointerId) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
        offsetRef.current = {
          x: drag.originX + dx,
          y: drag.originY + dy,
        };
        scheduleDraw();
      }
    };

    const onPointerUp = (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinchRef.current = null;
      if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
      walkingRef.current = false;
    };

    return (
      <div
        ref={containerRef}
        className="absolute inset-0 h-full w-full touch-none overflow-hidden bg-[#070b14]"
      >
        <canvas
          ref={canvasRef}
          className={`h-full w-full ${
            walkMode ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            e.preventDefault();
            fitMap("cover");
          }}
        />
      </div>
    );
  }
);

export default GameCanvas;
