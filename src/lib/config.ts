/** DSCE Campus Claim — paper.io-style game config */

export const GRID_WIDTH = 200;
export const GRID_HEIGHT = 200;

/** Max display name length */
export const MAX_NAME_LENGTH = 16;

/**
 * Geo bounds of the playable campus map (north-up).
 * Tune so GPS lines up with the artwork.
 */
export const CAMPUS_BOUNDS = {
  west: 77.5642,
  south: 12.9070,
  east: 77.5696,
  north: 12.9119,
  center: { lat: 12.909477, lng: 77.566833 },
} as const;

/** Starting territory half-size in cells (square side = 2*r+1) */
export const SPAWN_RADIUS = 3;

/** Ignore GPS jitter smaller than this many grid cells */
export const MIN_MOVE_CELLS = 0.35;

/** Max trail length before forced break (anti-abuse) */
export const MAX_TRAIL_LENGTH = 800;

/** Seconds until respawn after death */
export const RESPAWN_SECONDS = 4;

/** How often server broadcasts full state (ms) */
export const TICK_MS = 100;

/** Player colors (assigned in order) */
export const PLAYER_COLORS = [
  "#FF3B30",
  "#0A84FF",
  "#30D158",
  "#FFD60A",
  "#BF5AF2",
  "#FF9F0A",
  "#64D2FF",
  "#FF375F",
  "#AC8E68",
  "#5E5CE6",
  "#FF6482",
  "#32ADE6",
] as const;

/** Legacy aliases (old place mode) */
export const COLOR_PALETTE = PLAYER_COLORS;
export const MAX_STARS = 30;
export const REGEN_SECONDS = 30;
export const FREE_PIXELS = 30;
export const COOLDOWN_SECONDS = 30;
