"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { Pixel, PixelsBatchEvent } from "@/lib/types";

export interface PixelCanvasHandle {
  centerOn: (x: number, y: number, zoom?: number) => void;
  fitMap: (mode?: "contain" | "cover") => void;
  /** Trigger local paint FX without waiting for server */
  spawnFx: (fx: NonNullable<PixelsBatchEvent["fx"]>) => void;
}

export type ToolPreview = "paint" | "eraser" | "bomb" | "wave" | "multiplier";

interface PixelCanvasProps {
  gridWidth: number;
  gridHeight: number;
  /** Mutable map — canvas reads by ref for perf; pass revision to force sync */
  pixels: Map<string, Pixel>;
  /** Increment when bulk pixels change */
  pixelsRevision: number;
  selectedColor: string;
  canPlace: boolean;
  tool: ToolPreview;
  waveDir?: "up" | "down" | "left" | "right";
  /** Force visible cell grid (even when zoomed out) */
  showGrid?: boolean;
  /** Satellite map opacity 0–1 (pixels stay full opacity) */
  mapOpacity?: number;
  onPlace: (x: number, y: number) => void;
  onHover: (pixel: Pixel | null, gridX: number, gridY: number) => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 48;

interface FxParticle {
  x: number; // grid
  y: number;
  born: number;
  life: number; // ms
  kind: "plus" | "splash" | "ring" | "wave" | "drop";
  color: string;
  points: number;
  vx?: number;
  vy?: number;
  dir?: "up" | "down" | "left" | "right";
  /** Drop: start height above target (grid units) */
  dropFrom?: number;
  /** Drop / splash radius scale */
  size?: number;
}

const PixelCanvas = forwardRef<PixelCanvasHandle, PixelCanvasProps>(
  function PixelCanvas(
    {
      gridWidth,
      gridHeight,
      pixels,
      pixelsRevision,
      selectedColor,
      canPlace,
      tool,
      waveDir = "right",
      showGrid = false,
      mapOpacity = 1,
      onPlace,
      onHover,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bgRef = useRef<HTMLImageElement | null>(null);
    /** Offscreen pixel layer (grid resolution) — dirty-region updates */
    const layerRef = useRef<HTMLCanvasElement | null>(null);
    const layerCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const pixelsRef = useRef(pixels);
    pixelsRef.current = pixels;

    const scaleRef = useRef(1);
    const offsetRef = useRef({ x: 0, y: 0 });
    const hoverCell = useRef<{ x: number; y: number } | null>(null);
    const rafRef = useRef(0);
    const fittedRef = useRef(false);
    const fxRef = useRef<FxParticle[]>([]);
    const animatingRef = useRef(false);

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

    const ensureLayer = useCallback(() => {
      if (
        layerRef.current &&
        layerRef.current.width === gridWidth &&
        layerRef.current.height === gridHeight
      ) {
        return layerCtxRef.current!;
      }
      const c = document.createElement("canvas");
      c.width = gridWidth;
      c.height = gridHeight;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      layerRef.current = c;
      layerCtxRef.current = ctx;
      // full rebuild
      ctx.clearRect(0, 0, gridWidth, gridHeight);
      for (const p of pixelsRef.current.values()) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 1, 1);
      }
      return ctx;
    }, [gridWidth, gridHeight]);

    const rebuildLayer = useCallback(() => {
      const ctx = ensureLayer();
      ctx.clearRect(0, 0, gridWidth, gridHeight);
      for (const p of pixelsRef.current.values()) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 1, 1);
      }
    }, [ensureLayer, gridWidth, gridHeight]);

    useEffect(() => {
      rebuildLayer();
      scheduleDraw();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pixelsRevision, rebuildLayer]);

    const spawnFx = useCallback((fx: NonNullable<PixelsBatchEvent["fx"]>) => {
      const now = performance.now();
      const color = fx.color || selectedColor;
      const points = fx.points ?? 0;
      const showPoints = Boolean(fx.showPoints) && points > 0;
      // Default: drop for paint/bomb unless explicitly false
      const wantDrop =
        fx.drop !== false &&
        (fx.type === "paint" || fx.type === "bomb" || fx.type === "erase");

      if (fx.type === "paint" || fx.type === "erase") {
        // +N only for the local painter
        if (showPoints && fx.type === "paint") {
          fxRef.current.push({
            x: fx.x + 0.5,
            y: fx.y + 0.5,
            born: now,
            life: 1000,
            kind: "plus",
            color,
            points,
          });
        }

        if (wantDrop) {
          // Ink drop landing on the cell
          fxRef.current.push({
            x: fx.x + 0.5,
            y: fx.y + 0.5,
            born: now,
            life: 520,
            kind: "drop",
            color: fx.type === "erase" ? "#94a3b8" : color,
            points: 0,
            dropFrom: 2.4,
            size: 0.55,
          });
          // Splash on impact
          for (let i = 0; i < 7; i++) {
            const a = (Math.PI * 2 * i) / 7 + Math.random() * 0.35;
            fxRef.current.push({
              x: fx.x + 0.5,
              y: fx.y + 0.5,
              born: now + 280,
              life: 400 + Math.random() * 180,
              kind: "splash",
              color: fx.type === "erase" ? "#94a3b8" : color,
              points: 0,
              vx: Math.cos(a) * (0.9 + Math.random() * 0.6),
              vy: Math.sin(a) * (0.9 + Math.random() * 0.6),
            });
          }
        }
      } else if (fx.type === "bomb") {
        if (wantDrop) {
          // Big central ink bomb drop
          fxRef.current.push({
            x: fx.x + 0.5,
            y: fx.y + 0.5,
            born: now,
            life: 780,
            kind: "drop",
            color,
            points: 0,
            dropFrom: 7.5,
            size: 2.4,
          });
          // Secondary drops around the 5×5 blast
          for (let i = 0; i < 8; i++) {
            const a = (Math.PI * 2 * i) / 8 + Math.random() * 0.2;
            const r = 1.2 + Math.random() * 1.4;
            fxRef.current.push({
              x: fx.x + 0.5 + Math.cos(a) * r,
              y: fx.y + 0.5 + Math.sin(a) * r,
              born: now + 40 + i * 25,
              life: 620 + Math.random() * 120,
              kind: "drop",
              color,
              points: 0,
              dropFrom: 4 + Math.random() * 3,
              size: 0.85 + Math.random() * 0.45,
            });
          }
          // Expanding shock rings
          fxRef.current.push({
            x: fx.x + 0.5,
            y: fx.y + 0.5,
            born: now + 320,
            life: 900,
            kind: "ring",
            color,
            points: 0,
            size: 1.4,
          });
          fxRef.current.push({
            x: fx.x + 0.5,
            y: fx.y + 0.5,
            born: now + 420,
            life: 700,
            kind: "ring",
            color,
            points: 0,
            size: 0.9,
          });
          // Impact splash burst
          for (let i = 0; i < 16; i++) {
            const a = (Math.PI * 2 * i) / 16 + Math.random() * 0.25;
            const speed = 1.6 + Math.random() * 1.8;
            fxRef.current.push({
              x: fx.x + 0.5,
              y: fx.y + 0.5,
              born: now + 360,
              life: 500 + Math.random() * 250,
              kind: "splash",
              color,
              points: 0,
              vx: Math.cos(a) * speed,
              vy: Math.sin(a) * speed,
              size: 0.35,
            });
          }
        }
        // Local score only
        if (showPoints) {
          fxRef.current.push({
            x: fx.x + 0.5,
            y: fx.y + 0.5,
            born: now + 350,
            life: 1100,
            kind: "plus",
            color,
            points,
          });
        }
      } else if (fx.type === "wave") {
        fxRef.current.push({
          x: fx.x + 0.5,
          y: fx.y + 0.5,
          born: now,
          life: 800,
          kind: "wave",
          color,
          points: 0,
          dir: fx.dir,
        });
        if (showPoints) {
          fxRef.current.push({
            x: fx.x + 0.5,
            y: fx.y + 0.5,
            born: now,
            life: 1000,
            kind: "plus",
            color,
            points,
          });
        }
      }

      // Cap FX for perf
      if (fxRef.current.length > 140) {
        fxRef.current = fxRef.current.slice(-100);
      }
      startAnimLoop();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedColor]);

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

      const scale = scaleRef.current;
      const offset = offsetRef.current;

      ctx.fillStyle = "#070b14";
      ctx.fillRect(0, 0, w, h);

      const bgAlpha = Math.max(0, Math.min(1, mapOpacity));
      const mapW = gridWidth * scale;
      const mapH = gridHeight * scale;

      // Draw map in *screen* space with high-quality filtering.
      // (Grid-space draw + imageSmoothingEnabled=false was crushing detail.)
      if (bgRef.current) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.globalAlpha = bgAlpha;
        ctx.drawImage(bgRef.current, offset.x, offset.y, mapW, mapH);
        ctx.restore();
        // Light dim so painted pixels pop — keep low so map stays clear
        if (bgAlpha > 0) {
          ctx.fillStyle = `rgba(0,0,0,${0.04 * bgAlpha})`;
          ctx.fillRect(offset.x, offset.y, mapW, mapH);
        }
      } else {
        ctx.fillStyle = "#1a2332";
        ctx.fillRect(offset.x, offset.y, mapW, mapH);
      }

      // Pixel art + FX stay in grid space, nearest-neighbor (crisp cells)
      ctx.save();
      ctx.translate(offset.x, offset.y);
      ctx.scale(scale, scale);
      ctx.imageSmoothingEnabled = false;

      // Batched pixel layer (always full opacity)
      ensureLayer();
      if (layerRef.current) {
        ctx.drawImage(layerRef.current, 0, 0);
      }

      // Tool preview
      const hc = hoverCell.current;
      if (hc && canPlace) {
        if (tool === "bomb") {
          ctx.fillStyle = selectedColor;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(hc.x - 2, hc.y - 2, 5, 5);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.lineWidth = 0.1;
          ctx.strokeRect(hc.x - 2, hc.y - 2, 5, 5);
        } else if (tool === "wave") {
          ctx.fillStyle = selectedColor;
          ctx.globalAlpha = 0.4;
          let dx = 0,
            dy = 0;
          if (waveDir === "up") dy = -1;
          else if (waveDir === "down") dy = 1;
          else if (waveDir === "left") dx = -1;
          else dx = 1;
          for (let i = 0; i < 10; i++) {
            ctx.fillRect(hc.x + dx * i, hc.y + dy * i, 1, 1);
          }
          ctx.globalAlpha = 1;
        } else if (tool === "eraser") {
          ctx.strokeStyle = "rgba(248,250,252,0.9)";
          ctx.lineWidth = 0.12;
          ctx.strokeRect(hc.x + 0.1, hc.y + 0.1, 0.8, 0.8);
          ctx.beginPath();
          ctx.moveTo(hc.x + 0.2, hc.y + 0.2);
          ctx.lineTo(hc.x + 0.8, hc.y + 0.8);
          ctx.stroke();
        } else if (tool === "paint") {
          ctx.fillStyle = selectedColor;
          ctx.globalAlpha = 0.7;
          ctx.fillRect(hc.x, hc.y, 1, 1);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = Math.max(0.06, 1.5 / scale);
          ctx.strokeRect(hc.x + 0.04, hc.y + 0.04, 0.92, 0.92);
        }
      }

      // Grid lines: auto when very zoomed in, or forced via showGrid
      const drawGrid = showGrid || scale >= 10;
      if (drawGrid) {
        ctx.strokeStyle = showGrid
          ? "rgba(255,255,255,0.18)"
          : "rgba(255,255,255,0.05)";
        ctx.lineWidth = showGrid
          ? Math.max(1 / scale, 0.04)
          : 1 / scale;
        const inv = 1 / scale;
        const x0 = Math.max(0, Math.floor(-offset.x * inv) - 1);
        const y0 = Math.max(0, Math.floor(-offset.y * inv) - 1);
        const x1 = Math.min(gridWidth, Math.ceil((w - offset.x) * inv) + 1);
        const y1 = Math.min(gridHeight, Math.ceil((h - offset.y) * inv) + 1);
        // When zoomed out with showGrid, step every N cells for clarity
        const step =
          showGrid && scale < 4
            ? scale < 1.5
              ? 10
              : 5
            : 1;
        ctx.beginPath();
        for (let x = x0; x <= x1; x += step) {
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y1);
        }
        for (let y = y0; y <= y1; y += step) {
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
        }
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(251, 191, 36, 0.35)";
      ctx.lineWidth = Math.max(1.5 / scale, 0.04);
      ctx.strokeRect(0, 0, gridWidth, gridHeight);

      // FX in grid space (lightweight)
      const now = performance.now();
      const alive: FxParticle[] = [];
      for (const p of fxRef.current) {
        const t = (now - p.born) / p.life;
        // born can be in the future (staggered bomb/splash)
        if (t < 0) {
          alive.push(p);
          continue;
        }
        if (t >= 1) continue;
        alive.push(p);
        const alpha = 1 - t;

        if (p.kind === "plus" && p.points > 0) {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(p.x, p.y - t * 2.2);
          ctx.scale(1 / scale, 1 / scale);
          ctx.font = "bold 14px system-ui,sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = p.color;
          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.lineWidth = 3;
          const label = `+${p.points}`;
          ctx.strokeText(label, 0, 0);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        } else if (p.kind === "drop") {
          // Fall with ease-in, then soft impact squash
          const fallT = Math.min(1, t / 0.72);
          const ease = fallT * fallT;
          const from = p.dropFrom ?? 2.5;
          const size = p.size ?? 0.55;
          const cy = p.y - from + from * ease;
          const squash = fallT > 0.92 ? 1 + (fallT - 0.92) * 4 : 1;
          const rx = size * 0.42 * squash;
          const ry = size * 0.55 * (2 - squash);
          ctx.save();
          ctx.globalAlpha = Math.min(1, alpha * 1.15);
          ctx.fillStyle = p.color;
          // teardrop body
          ctx.beginPath();
          ctx.ellipse(p.x, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
          // highlight
          ctx.globalAlpha = alpha * 0.35;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.ellipse(
            p.x - rx * 0.25,
            cy - ry * 0.25,
            rx * 0.28,
            ry * 0.22,
            0,
            0,
            Math.PI * 2
          );
          ctx.fill();
          // impact ripple near landing
          if (fallT > 0.78) {
            const k = (fallT - 0.78) / 0.22;
            ctx.globalAlpha = (1 - k) * 0.55;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 0.12;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size * (0.35 + k * 1.4), 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        } else if (p.kind === "splash") {
          const px = p.x + (p.vx || 0) * t * 1.5;
          const py = p.y + (p.vy || 0) * t * 1.5;
          ctx.globalAlpha = alpha * 0.85;
          ctx.fillStyle = p.color;
          const base = p.size ?? 0.22;
          const r = base * (1 - t * 0.5);
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (p.kind === "ring") {
          const grow = p.size ?? 1;
          ctx.globalAlpha = alpha * 0.75;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 0.2 * grow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, (0.5 + t * 5) * grow, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (p.kind === "wave") {
          ctx.globalAlpha = alpha * 0.8;
          ctx.fillStyle = p.color;
          let dx = 1,
            dy = 0;
          if (p.dir === "up") {
            dx = 0;
            dy = -1;
          } else if (p.dir === "down") {
            dx = 0;
            dy = 1;
          } else if (p.dir === "left") {
            dx = -1;
            dy = 0;
          }
          const head = Math.floor(t * 10);
          for (let i = 0; i <= head && i < 10; i++) {
            ctx.globalAlpha = alpha * (1 - i / 12);
            ctx.fillRect(p.x - 0.5 + dx * i, p.y - 0.5 + dy * i, 1, 1);
          }
          ctx.globalAlpha = 1;
        }
      }
      fxRef.current = alive;

      ctx.restore();
    }, [
      gridWidth,
      gridHeight,
      selectedColor,
      canPlace,
      tool,
      waveDir,
      showGrid,
      mapOpacity,
      ensureLayer,
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

    function startAnimLoop() {
      if (animatingRef.current) return;
      animatingRef.current = true;
      const tick = () => {
        scheduleDraw();
        if (fxRef.current.length > 0) {
          requestAnimationFrame(tick);
        } else {
          animatingRef.current = false;
        }
      };
      requestAnimationFrame(tick);
    }

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

    // Apply dirty pixel patches from parent via revision — also expose patch helper
    useEffect(() => {
      // when revision changes, full rebuild already handled
    }, [pixelsRevision]);

    const fitMap = useCallback(
      (mode: "contain" | "cover" = "cover") => {
        const container = containerRef.current;
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w < 1 || h < 1) return;
        const s =
          mode === "cover"
            ? Math.max(w / gridWidth, h / gridHeight)
            : Math.min(w / gridWidth, h / gridHeight) * 0.98;
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
        if (zoom != null) {
          scaleRef.current = Math.min(MAX_SCALE, Math.max(MIN_SCALE, zoom));
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

    useImperativeHandle(
      ref,
      () => ({ centerOn, fitMap, spawnFx }),
      [centerOn, fitMap, spawnFx]
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const ro = new ResizeObserver(() => {
        if (!fittedRef.current) {
          fitMap("cover");
          fittedRef.current = true;
        } else scheduleDraw();
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

    const clientToGrid = (clientX: number, clientY: number) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      const gx = Math.floor((cx - offsetRef.current.x) / scaleRef.current);
      const gy = Math.floor((cy - offsetRef.current.y) / scaleRef.current);
      return { gx, gy };
    };

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
      const drag = dragRef.current;
      if (drag?.active && drag.pointerId === e.pointerId) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
          offsetRef.current = { x: drag.originX + dx, y: drag.originY + dy };
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
        onHover(pixelsRef.current.get(`${gx},${gy}`) ?? null, gx, gy);
        scheduleDraw();
      }
    };

    const onPointerUp = (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinchRef.current = null;
      const drag = dragRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        dragRef.current = null;
        if (!drag.moved && canPlace && tool !== "multiplier") {
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
            // Prevent browser / canvas zoom-out on double-tap
            e.preventDefault();
          }}
        />
      </div>
    );
  }
);

export default PixelCanvas;

/** Patch offscreen layer for a batch (call from parent after map update) */
export function patchPixelLayer(
  // reserved for future external patch API
  _pixels: Map<string, Pixel>
) {
  /* layer is owned inside component */
}
