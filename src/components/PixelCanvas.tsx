"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Pixel } from "@/lib/types";

interface PixelCanvasProps {
  gridWidth: number;
  gridHeight: number;
  pixels: Map<string, Pixel>;
  selectedColor: string;
  canPlace: boolean;
  onPlace: (x: number, y: number) => void;
  hoverInfo: Pixel | null;
  onHover: (pixel: Pixel | null, gridX: number, gridY: number) => void;
}

export default function PixelCanvas({
  gridWidth,
  gridHeight,
  pixels,
  selectedColor,
  canPlace,
  onPlace,
  hoverInfo,
  onHover,
}: PixelCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(4);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [bgReady, setBgReady] = useState(false);
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const hoverCell = useRef<{ x: number; y: number } | null>(null);

  // Load satellite background
  useEffect(() => {
    const img = new Image();
    img.src = "/campus-satellite.jpg";
    img.onload = () => {
      bgRef.current = img;
      setBgReady(true);
    };
    img.onerror = () => setBgReady(true); // still draw grid without bg
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Clear
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);

    const gw = gridWidth;
    const gh = gridHeight;

    // Satellite underlay
    if (bgRef.current) {
      ctx.globalAlpha = 0.92;
      ctx.drawImage(bgRef.current, 0, 0, gw, gh);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#1a2332";
      ctx.fillRect(0, 0, gw, gh);
    }

    // Subtle darken so pixels pop
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, 0, gw, gh);

    // Placed pixels
    for (const p of pixels.values()) {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 1, 1);
    }

    // Hover preview
    const hc = hoverCell.current;
    if (hc && canPlace) {
      ctx.fillStyle = selectedColor;
      ctx.globalAlpha = 0.65;
      ctx.fillRect(hc.x, hc.y, 1, 1);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 0.08;
      ctx.strokeRect(hc.x + 0.04, hc.y + 0.04, 0.92, 0.92);
    }

    // Light grid when zoomed in
    if (scale >= 6) {
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (let x = 0; x <= gw; x++) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, gh);
      }
      for (let y = 0; y <= gh; y++) {
        ctx.moveTo(0, y);
        ctx.lineTo(gw, y);
      }
      ctx.stroke();
    }

    // Campus border
    ctx.strokeStyle = "rgba(56, 189, 248, 0.5)";
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(0, 0, gw, gh);

    ctx.restore();
  }, [gridWidth, gridHeight, pixels, scale, offset, selectedColor, canPlace, bgReady]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // Fit campus on first mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const fit = () => {
      const pad = 40;
      const w = container.clientWidth - pad * 2;
      const h = container.clientHeight - pad * 2;
      const s = Math.max(1, Math.min(w / gridWidth, h / gridHeight));
      setScale(s);
      setOffset({
        x: (container.clientWidth - gridWidth * s) / 2,
        y: (container.clientHeight - gridHeight * s) / 2,
      });
    };
    fit();
  }, [gridWidth, gridHeight]);

  const clientToGrid = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const gx = Math.floor((cx - offset.x) / scale);
    const gy = Math.floor((cy - offset.y) / scale);
    return { gx, gy };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag?.active) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        setOffset({ x: drag.originX + dx, y: drag.originY + dy });
        return;
      }
    }

    const { gx, gy } = clientToGrid(e.clientX, e.clientY);
    if (gx < 0 || gy < 0 || gx >= gridWidth || gy >= gridHeight) {
      hoverCell.current = null;
      onHover(null, -1, -1);
      draw();
      return;
    }
    hoverCell.current = { x: gx, y: gy };
    onHover(pixels.get(`${gx},${gy}`) ?? null, gx, gy);
    draw();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return;

    const { gx, gy } = clientToGrid(e.clientX, e.clientY);
    if (gx < 0 || gy < 0 || gx >= gridWidth || gy >= gridHeight) return;
    if (!canPlace) return;
    onPlace(gx, gy);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.min(40, Math.max(1, scale * zoomFactor));
    const ratio = newScale / scale;

    setOffset({
      x: mx - (mx - offset.x) * ratio,
      y: my - (my - offset.y) * ratio,
    });
    setScale(newScale);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden rounded-xl border border-sky-500/20 bg-slate-950 shadow-inner"
    >
      <canvas
        ref={canvasRef}
        className={`h-full w-full ${canPlace ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          hoverCell.current = null;
          onHover(null, -1, -1);
          draw();
        }}
        onWheel={onWheel}
      />
      {hoverInfo && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white backdrop-blur">
          Placed by <span className="font-semibold text-sky-300">{hoverInfo.name}</span>
        </div>
      )}
      <div className="pointer-events-none absolute right-3 top-3 rounded-lg bg-black/60 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300">
        Scroll zoom · Drag pan
      </div>
    </div>
  );
}
