import type { GameMode, TeamId, WaveDir, PowerupId } from "./config";

export interface Pixel {
  x: number;
  y: number;
  color: string;
  name: string;
  placedAt: number;
  /** Set in team mode */
  team?: TeamId | null;
  mode: GameMode;
}

export type ToolId = "paint" | "eraser" | PowerupId;

export interface PlacePixelPayload {
  x: number;
  y: number;
  color: string;
  name: string;
  mode: GameMode;
  team?: TeamId | null;
  tool?: ToolId;
  /** Required for ink wave */
  dir?: WaveDir;
}

/** When each power-up can be used again (ms epoch; 0 = ready now) */
export type PowerupReadyAt = {
  bomb: number;
  wave: number;
  multiplier: number;
};

export interface QuotaUpdate {
  stars: number;
  maxStars: number;
  regenSeconds: number;
  nextStarIn: number;
  isFull: boolean;
  /** Multiplier ends at this timestamp (0 if inactive) */
  multiplierUntil: number;
  /** Masked client IP — stars are locked to this network */
  ipMasked?: string;
  /** Unlimited paint / power-ups for this identity */
  isAdmin?: boolean;
  /** Server timestamps when bomb/wave/2× are ready again */
  powerupsReadyAt?: PowerupReadyAt;
}

export interface TeamScoreRow {
  team: TeamId;
  pixels: number;
  score: number;
  percent: number;
}

export interface FreeScoreRow {
  name: string;
  pixels: number;
  score: number;
}

/** Bound identity for one network/device (stars + name + locked team) */
export interface PlayerIdentity {
  name: string;
  mode: GameMode;
  team: TeamId | null;
  /** Once set in team mode, cannot change */
  teamLocked: boolean;
  isAdmin?: boolean;
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
  mode: GameMode;
  teamScores: TeamScoreRow[];
  freeScores: FreeScoreRow[];
  teams: readonly string[];
  /** If IP/device already registered — auto-login */
  identity?: PlayerIdentity | null;
}

export interface PixelsBatchEvent {
  mode: GameMode;
  pixels?: Pixel[];
  erased?: Array<{ x: number; y: number }>;
  /** Visual hint for clients */
  fx?: {
    type: "paint" | "erase" | "bomb" | "wave";
    x: number;
    y: number;
    color?: string;
    dir?: WaveDir;
    points?: number;
  };
}

export interface ScoresUpdate {
  mode: GameMode;
  teamScores: TeamScoreRow[];
  freeScores: FreeScoreRow[];
}
