/** DSCE Place — shared client/server config */

export const GRID_WIDTH = 200;
export const GRID_HEIGHT = 200;

/** Max stars (paint charges) per IP */
export const MAX_STARS = 30;

/** Seconds to regenerate 1 star after spending */
export const REGEN_SECONDS = 30;

export const FREE_PIXELS = MAX_STARS;
export const COOLDOWN_SECONDS = REGEN_SECONDS;

export const MAX_NAME_LENGTH = 20;

/** Game modes */
export type GameMode = "free" | "team";

export const TEAMS = [
  "ISE",
  "CSE",
  "AIML",
  "ECE",
  "EEE",
  "Mechanical",
  "Civil",
  "Other",
] as const;

export type TeamId = (typeof TEAMS)[number];

/** One fixed brand color per team (team mode only) */
export const TEAM_COLORS: Record<TeamId, string> = {
  ISE: "#0A84FF",
  CSE: "#FF3B30",
  AIML: "#BF5AF2",
  ECE: "#30D158",
  EEE: "#FFD60A",
  Mechanical: "#FF9F0A",
  Civil: "#64D2FF",
  Other: "#AC8E68",
};

export function colorForTeam(team: TeamId): string {
  return TEAM_COLORS[team];
}

/** Power-up costs (stars) and effects */
export const POWERUPS = {
  bomb: {
    id: "bomb" as const,
    label: "Paint Bomb",
    cost: 5,
    /** half-size: 5×5 → radius 2 */
    radius: 2,
  },
  multiplier: {
    id: "multiplier" as const,
    label: "Paint Multiplier",
    cost: 3,
    durationMs: 20_000,
    /** points per pixel while active (team/free score) */
    scorePerPixel: 2,
  },
  wave: {
    id: "wave" as const,
    label: "Ink Wave",
    cost: 3,
    length: 10,
  },
} as const;

export type PowerupId = keyof typeof POWERUPS;

export type WaveDir = "up" | "down" | "left" | "right";

export const WAVE_DIRS: WaveDir[] = ["up", "down", "left", "right"];

/** Eraser costs 1 star (not a power-up) */
export const ERASER_COST = 1;

/** Default points per normal paint */
export const BASE_SCORE_PER_PIXEL = 1;

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
