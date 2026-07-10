/** DSCE Kumaraswamy Layout — shared client/server config */

export const GRID_WIDTH = 200;
export const GRID_HEIGHT = 200;

/** Max stars (paint charges) per IP */
export const MAX_STARS = 30;

/** Seconds to regenerate 1 star after spending (timer starts immediately on paint) */
export const REGEN_SECONDS = 30;

/** @deprecated use MAX_STARS */
export const FREE_PIXELS = MAX_STARS;
/** @deprecated use REGEN_SECONDS */
export const COOLDOWN_SECONDS = REGEN_SECONDS;

/** Max display name length */
export const MAX_NAME_LENGTH = 20;

/**
 * Geo bounds of the pixel canvas over DSCE (Kumaraswamy Layout, Bengaluru).
 * Tuned to ~main DSI campus around 12.9095°N, 77.5668°E.
 *
 * IMPORTANT: Your campus artwork is illustrative, not a survey map.
 * If the blue GPS dot is off, nudge these edges while standing at known gates/buildings.
 * west/east = left/right of image · north/south = top/bottom of image (north-up).
 */
export const CAMPUS_BOUNDS = {
  west: 77.5642,
  south: 12.9070,
  east: 77.5696,
  north: 12.9119,
  /** Official-ish campus pin */
  center: { lat: 12.909477, lng: 77.566833 },
} as const;

/** r/place-style palette */
export const COLOR_PALETTE = [
  "#FFFFFF",
  "#E4E4E4",
  "#888888",
  "#222222",
  "#000000",
  "#FFA7D1",
  "#E50000",
  "#E59500",
  "#A06A42",
  "#E5D900",
  "#94E044",
  "#02BE01",
  "#00D3DD",
  "#0083C7",
  "#0000EA",
  "#CF6EE4",
  "#820080",
] as const;

export type PaletteColor = (typeof COLOR_PALETTE)[number];
