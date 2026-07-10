export interface Pixel {
  x: number;
  y: number;
  color: string;
  name: string;
  placedAt: number;
}

export interface PlacePixelPayload {
  x: number;
  y: number;
  color: string;
  name: string;
}

export interface PlacePixelError {
  error: string;
  /** Seconds until next star */
  nextStarIn?: number;
  stars?: number;
}

export interface PixelPlacedEvent {
  pixel: Pixel;
}

/** Per-IP star bank snapshot */
export interface QuotaUpdate {
  /** Current stars available to spend */
  stars: number;
  maxStars: number;
  /** Seconds to gain +1 star */
  regenSeconds: number;
  /** Seconds until next star regenerates (0 if full) */
  nextStarIn: number;
  /** True when at max — no regen running */
  isFull: boolean;
}

export interface ServerHello {
  pixels: Pixel[];
  gridWidth: number;
  gridHeight: number;
  maxStars: number;
  regenSeconds: number;
  onlineCount: number;
  palette: readonly string[];
  quota: QuotaUpdate;
}
