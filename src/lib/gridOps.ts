/** Pure grid helpers for bombs / waves (shared client/server) */
import { GRID_HEIGHT, GRID_WIDTH, type WaveDir } from "./config";

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_WIDTH && y < GRID_HEIGHT;
}

/** Cells in a square centered on (cx,cy) with half-size radius (5×5 → r=2) */
export function bombCells(
  cx: number,
  cy: number,
  radius: number
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (inBounds(x, y)) out.push({ x, y });
    }
  }
  return out;
}

/** 10 cells in a direction including origin */
export function waveCells(
  cx: number,
  cy: number,
  dir: WaveDir,
  length: number
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  let dx = 0;
  let dy = 0;
  if (dir === "up") dy = -1;
  else if (dir === "down") dy = 1;
  else if (dir === "left") dx = -1;
  else dx = 1;

  for (let i = 0; i < length; i++) {
    const x = cx + dx * i;
    const y = cy + dy * i;
    if (!inBounds(x, y)) break;
    out.push({ x, y });
  }
  return out;
}
