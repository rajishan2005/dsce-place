/**
 * Paper.io territory helpers — pure functions (shared logic reference for server).
 */
import { GRID_HEIGHT, GRID_WIDTH } from "./config";

export function idx(x: number, y: number): number {
  return y * GRID_WIDTH + x;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_WIDTH && y < GRID_HEIGHT;
}

/** Bresenham line of integer cells from a→b (inclusive) */
export function lineCells(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xEnd = Math.round(x1);
  const yEnd = Math.round(y1);
  const dx = Math.abs(xEnd - x);
  const dy = Math.abs(yEnd - y);
  const sx = x < xEnd ? 1 : -1;
  const sy = y < yEnd ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    if (inBounds(x, y)) cells.push({ x, y });
    if (x === xEnd && y === yEnd) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    // safety
    if (cells.length > GRID_WIDTH + GRID_HEIGHT) break;
  }
  return cells;
}

/**
 * Claim enclosed region for `ownerId`.
 * Walls = owner's existing territory + trail cells.
 * Flood-fill exterior from edges; everything not exterior becomes owner.
 * Returns number of newly claimed cells.
 */
export function claimEnclosed(
  owners: Uint16Array,
  ownerId: number,
  trail: Array<{ x: number; y: number }>
): number {
  const N = GRID_WIDTH * GRID_HEIGHT;
  const wall = new Uint8Array(N);

  for (let i = 0; i < N; i++) {
    if (owners[i] === ownerId) wall[i] = 1;
  }
  for (const c of trail) {
    if (inBounds(c.x, c.y)) wall[idx(c.x, c.y)] = 1;
  }

  // exterior flood fill (0 = unknown/open, 1 = wall, 2 = exterior)
  const mark = new Uint8Array(N);
  const qx: number[] = [];
  const qy: number[] = [];

  const push = (x: number, y: number) => {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    if (wall[i] || mark[i]) return;
    mark[i] = 2;
    qx.push(x);
    qy.push(y);
  };

  for (let x = 0; x < GRID_WIDTH; x++) {
    push(x, 0);
    push(x, GRID_HEIGHT - 1);
  }
  for (let y = 0; y < GRID_HEIGHT; y++) {
    push(0, y);
    push(GRID_WIDTH - 1, y);
  }

  let head = 0;
  while (head < qx.length) {
    const x = qx[head]!;
    const y = qy[head]!;
    head++;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // Everything that is not exterior becomes this player's land
  // (enclosed empty space + enemy territory + own trail).
  let claimed = 0;
  for (let i = 0; i < N; i++) {
    if (mark[i] === 2) continue;
    if (owners[i] !== ownerId) {
      owners[i] = ownerId;
      claimed++;
    }
  }

  return claimed;
}

/** Paint a filled square of territory (spawn) */
export function paintSpawn(
  owners: Uint16Array,
  ownerId: number,
  cx: number,
  cy: number,
  radius: number
): number {
  let n = 0;
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  for (let y = y0 - radius; y <= y0 + radius; y++) {
    for (let x = x0 - radius; x <= x0 + radius; x++) {
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      owners[i] = ownerId;
      n++;
    }
  }
  return n;
}

/** Clear all cells owned by player */
export function clearOwner(owners: Uint16Array, ownerId: number): number {
  let n = 0;
  for (let i = 0; i < owners.length; i++) {
    if (owners[i] === ownerId) {
      owners[i] = 0;
      n++;
    }
  }
  return n;
}

export function countOwner(owners: Uint16Array, ownerId: number): number {
  let n = 0;
  for (let i = 0; i < owners.length; i++) if (owners[i] === ownerId) n++;
  return n;
}

/** RLE encode for network: [value, count, value, count, ...] */
export function encodeOwnersRLE(owners: Uint16Array): number[] {
  const out: number[] = [];
  if (owners.length === 0) return out;
  let v = owners[0]!;
  let c = 1;
  for (let i = 1; i < owners.length; i++) {
    if (owners[i] === v && c < 65535) {
      c++;
    } else {
      out.push(v, c);
      v = owners[i]!;
      c = 1;
    }
  }
  out.push(v, c);
  return out;
}

export function decodeOwnersRLE(rle: number[], size: number): Uint16Array {
  const out = new Uint16Array(new ArrayBuffer(size * 2));
  let i = 0;
  for (let k = 0; k + 1 < rle.length; k += 2) {
    const v = rle[k]!;
    const c = rle[k + 1]!;
    for (let j = 0; j < c && i < size; j++) out[i++] = v;
  }
  return out;
}
