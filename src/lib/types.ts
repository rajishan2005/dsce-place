/** Shared network types for campus paper.io */

export interface TrailCell {
  x: number;
  y: number;
}

export interface PublicPlayer {
  id: number;
  name: string;
  color: string;
  x: number;
  y: number;
  alive: boolean;
  /** True while drawing a trail outside territory */
  drawing: boolean;
  trail: TrailCell[];
  cells: number;
  kills: number;
  deaths: number;
  /** unix ms when can play again (if dead) */
  respawnAt: number;
}

export interface GameEvent {
  id: string;
  type:
    | "join"
    | "leave"
    | "claim"
    | "kill"
    | "cut"
    | "suicide"
    | "respawn"
    | "system";
  message: string;
  /** optional actor / victim ids */
  by?: number;
  target?: number;
  at: number;
}

export interface GameHello {
  you: number | null;
  gridWidth: number;
  gridHeight: number;
  players: PublicPlayer[];
  /** RLE territory */
  territory: number[];
  events: GameEvent[];
  respawnSeconds: number;
}

export interface GameStateDiff {
  players: PublicPlayer[];
  /** full RLE when dirty */
  territory?: number[];
  events?: GameEvent[];
  tick: number;
}

export interface JoinPayload {
  name: string;
}

export interface MovePayload {
  /** continuous grid coords */
  x: number;
  y: number;
  /** optional raw GPS for debug */
  lat?: number;
  lng?: number;
}
