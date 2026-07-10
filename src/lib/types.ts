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

export interface QuotaUpdate {
  stars: number;
  maxStars: number;
  regenSeconds: number;
  nextStarIn: number;
  isFull: boolean;
  /** Multiplier ends at this timestamp (0 if inactive) */
  multiplierUntil: number;
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
