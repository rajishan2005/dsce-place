"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { Pixel } from "@/lib/types";
import type { GeoPosition } from "@/lib/geo";
import { accuracyToGridRadius, latLngToGrid } from "@/lib/geo";

export interface PixelCanvasHandle {
  /** Center view on grid coords (optionally zoom in a bit) */
  centerOn: (x: number, y: number, zoom?: number) => void;
  fitMap: (mode?: "contain" | "cover") => void;
}

interface PixelCanvasProps {
  gridWidth: number;
  gridHeight: number;
  pixels: Map<string, Pixel>;
  selectedColor: string;
  canPlace: boolean;
  onPlace: (x: number, y: number) => void;
  onHover: (pixel: Pixel | null, gridX: number, gridY: number) => void;
  /** Live GPS position to draw on the map */
  userLocation?: GeoPosition | null;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 48;

const PixelCanvas = forwardRef<PixelCanvasHandle, PixelCanvasProps>(
  function PixelCanvas(
    {
      gridWidth,
      gridHeight,
      pixels,
      selectedColor,
      canPlace,
      onPlace,
      onHover,
      userLocation = null,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bgRef = useRef<HTMLImageElement | null>(null);

    const scaleRef = useRef(1);
    const offsetRef = useRef({ x: 0, y: 0 });
    const hoverCell = useRef<{ x: number; y: number } | null>(null);
    const rafRef = useRef(0);
    const fittedRef = useRef(false);
    const pulseRef = useRef(0);

    const dragRef = useRef<{
      active: boolean;
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

      ctx.fillStyle = "#070b14";
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(offset.x, offset.y);
      ctx.scale(scale, scale);

      const gw = gridWidth;
      const gh = gridHeight;

      if (bgRef.current) {
        ctx.drawImage(bgRef.current, 0, 0, gw, gh);
      } else {
        ctx.fillStyle = "#1a2332";
        ctx.fillRect(0, 0, gw, gh);
      }

      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, gw, gh);

      for (const p of pixels.values()) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 1, 1);
      }

      const hc = hoverCell.current;
      if (hc && canPlace) {
        ctx.fillStyle = selectedColor;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(hc.x, hc.y, 1, 1);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = Math.max(0.06, 1.5 / scale);
        ctx.strokeRect(hc.x + 0.05, hc.y + 0.05, 0.9, 0.9);
      }

      if (scale >= 8) {
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.lineWidth = 1 / scale;
        ctx.beginPath();
        const inv = 1 / scale;
        const x0 = Math.max(0, Math.floor(-offset.x * inv) - 1);
        const y0 = Math.max(0, Math.floor(-offset.y * inv) - 1);
        const x1 = Math.min(gw, Math.ceil((w - offset.x) * inv) + 1);
        const y1 = Math.min(gh, Math.ceil((h - offset.y) * inv) + 1);
        for (let x = x0; x <= x1; x++) {
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y1);
        }
        for (let y = y0; y <= y1; y++) {
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
        }
        ctx.stroke();
      }

      // Campus border
      ctx.strokeStyle = "rgba(251, 191, 36, 0.35)";
      ctx.lineWidth = Math.max(1.5 / scale, 0.04);
      ctx.strokeRect(0, 0, gw, gh);

      // ── GPS: you-are-here ──
      if (userLocation) {
        const { x, y } = latLngToGrid(userLocation.lat, userLocation.lng);
        const radius = accuracyToGridRadius(
          userLocation.accuracy,
          userLocation.lat
        );
        const pulse = 0.55 + 0.45 * Math.sin(pulseRef.current);

        // Accuracy disc
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(56, 189, 248, ${0.12 + 0.08 * pulse})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.35 + 0.2 * pulse})`;
        ctx.lineWidth = Math.max(1.2 / scale, 0.04);
        ctx.stroke();

        // Outer pulse ring
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + pulse * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(125, 211, 252, ${0.5 * pulse})`;
        ctx.lineWidth = Math.max(2 / scale, 0.06);
        ctx.stroke();

        // Heading wedge
        if (
          userLocation.heading != null &&
          !Number.isNaN(userLocation.heading)
        ) {
          const rad = ((userLocation.heading - 90) * Math.PI) / 180;
          const len = 3.2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(
            x + Math.cos(rad) * len,
            y + Math.sin(rad) * len
          );
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = Math.max(2 / scale, 0.08);
          ctx.lineCap = "round";
          ctx.stroke();
        }

        // Core dot (screen-space-ish size via inverse scale)
        const coreR = Math.max(1.1, 7 / scale);
        ctx.beginPath();
        ctx.arc(x, y, coreR, 0, Math.PI * 2);
        ctx.fillStyle = "#38bdf8";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(2 / scale, 0.1);
        ctx.stroke();

        // Inner white
        ctx.beginPath();
        ctx.arc(x, y, coreR * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }

      ctx.restore();
    }, [
      gridWidth,
      gridHeight,
      pixels,
      selectedColor,
      canPlace,
      userLocation,
    ]);

    const drawNowRef = useRef(drawNow);
    drawNowRef.current = drawNow;

    const scheduleDraw = useCallback(() => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        drawNowRef.current();
      });
    }, []);

    // Soft pulse animation while GPS is active
    useEffect(() => {
      if (!userLocation) return;
      let id = 0;
      const tick = () => {
        pulseRef.current += 0.08;
        scheduleDraw();
        id = requestAnimationFrame(tick);
      };
      id = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(id);
    }, [userLocation, scheduleDraw]);

    useEffect(() => {
      scheduleDraw();
    }, [drawNow, scheduleDraw]);

    useEffect(() => {
      const img = new Image();
      img.src = "/campus-satellite.jpg";
      img.onload = () => {
        bgRef.current = img;
        scheduleDraw();
      };
      img.onerror = () => scheduleDraw();
    }, [scheduleDraw]);

    const fitMap = useCallback(
      (mode: "contain" | "cover" = "cover") => {
        const container = containerRef.current;
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w < 1 || h < 1) return;

        const sx = w / gridWidth;
        const sy = h / gridHeight;
        const s =
          mode === "cover" ? Math.max(sx, sy) : Math.min(sx, sy) * 0.98;

        scaleRef.current = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
        offsetRef.current = {
          x: (w - gridWidth * scaleRef.current) / 2,
          y: (h - gridHeight * scaleRef.current) / 2,
        };
        scheduleDraw();
      },
      [gridWidth, gridHeight, scheduleDraw]
    );

    const centerOn = useCallback(
      (x: number, y: number, zoom?: number) => {
        const container = containerRef.current;
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (zoom != null) {
          scaleRef.current = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, zoom)
          );
        } else if (scaleRef.current < 6) {
          // Zoom in enough to see yourself
          scaleRef.current = Math.min(MAX_SCALE, Math.max(scaleRef.current, 10));
        }
        const s = scaleRef.current;
        offsetRef.current = {
          x: w / 2 - x * s,
          y: h / 2 - y * s,
        };
        scheduleDraw();
      },
      [scheduleDraw]
    );

    useImperativeHandle(ref, () => ({ centerOn, fitMap }), [centerOn, fitMap]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const ro = new ResizeObserver(() => {
        if (!fittedRef.current) {
          fitMap("cover");
          fittedRef.current = true;
        } else {
          scheduleDraw();
        }
      });
      ro.observe(container);
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
        e.stopPropagation();
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        if (e.deltaMode === 2) dy *= 400;
        const intensity = e.ctrlKey ? 0.012 : 0.0022;
        const factor = Math.exp(-dy * intensity);
        zoomAt(mx, my, Math.min(1.25, Math.max(0.8, factor)));
      };

      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, [zoomAt]);

    const clientToGrid = (clientX: number, clientY: number) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      const scale = scaleRef.current;
      const offset = offsetRef.current;
      const gx = Math.floor((cx - offset.x) / scale);
      const gy = Math.floor((cy - offset.y) / scale);
      return { gx, gy };
    };

    const pointerDist = () => {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return 0;
      const [a, b] = pts;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const pointerMid = () => {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return { x: 0, y: 0 };
      const [a, b] = pts;
      const rect = containerRef.current!.getBoundingClientRect();
      return {
        x: (a.x + b.x) / 2 - rect.left,
        y: (a.y + b.y) / 2 - rect.top,
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
        return;
      }

      if (e.button !== 0) return;
      dragRef.current = {
        active: true,
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
          const factor = dist / p.startDist;
          const target = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, p.startScale * factor)
          );
          const old = scaleRef.current;
          const ratio = target / old;
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

      const drag = dragRef.current;
      if (drag?.active && drag.pointerId === e.pointerId) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
          offsetRef.current = {
            x: drag.originX + dx,
            y: drag.originY + dy,
          };
          scheduleDraw();
          return;
        }
      }

      const { gx, gy } = clientToGrid(e.clientX, e.clientY);
      if (gx < 0 || gy < 0 || gx >= gridWidth || gy >= gridHeight) {
        if (hoverCell.current) {
          hoverCell.current = null;
          onHover(null, -1, -1);
          scheduleDraw();
        }
        return;
      }
      const prev = hoverCell.current;
      if (!prev || prev.x !== gx || prev.y !== gy) {
        hoverCell.current = { x: gx, y: gy };
        onHover(pixels.get(`${gx},${gy}`) ?? null, gx, gy);
        scheduleDraw();
      }
    };

    const onPointerUp = (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinchRef.current = null;

      const drag = dragRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        dragRef.current = null;
        if (!drag.moved && canPlace) {
          const { gx, gy } = clientToGrid(e.clientX, e.clientY);
          if (gx >= 0 && gy >= 0 && gx < gridWidth && gy < gridHeight) {
            onPlace(gx, gy);
          }
        }
      }
    };

    return (
      <div
        ref={containerRef}
        className="absolute inset-0 h-full w-full touch-none overflow-hidden bg-[#070b14]"
      >
        <canvas
          ref={canvasRef}
          className={`h-full w-full ${
            canPlace ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            hoverCell.current = null;
            onHover(null, -1, -1);
            scheduleDraw();
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            fitMap("cover");
          }}
        />
      </div>
    );
  }
);

export default PixelCanvas;
