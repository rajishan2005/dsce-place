/**
 * DSCE Campus Claim — paper.io-style multiplayer on the campus grid.
 * Real-time trails, territory claims, trail cuts / kills.
 */
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer, type Socket } from "socket.io";
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  MAX_NAME_LENGTH,
  PLAYER_COLORS,
  SPAWN_RADIUS,
  MIN_MOVE_CELLS,
  MAX_TRAIL_LENGTH,
  RESPAWN_SECONDS,
  TICK_MS,
  CAMPUS_BOUNDS,
} from "./src/lib/config";
import {
  claimEnclosed,
  clearOwner,
  countOwner,
  encodeOwnersRLE,
  idx,
  inBounds,
  lineCells,
  paintSpawn,
} from "./src/lib/territory";
import type {
  GameEvent,
  GameHello,
  GameStateDiff,
  JoinPayload,
  MovePayload,
  PublicPlayer,
  TrailCell,
} from "./src/lib/types";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

// ─── World ───────────────────────────────────────────────

const owners = new Uint16Array(GRID_WIDTH * GRID_HEIGHT); // 0 = neutral

interface Player {
  id: number;
  socketId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  alive: boolean;
  drawing: boolean;
  trail: TrailCell[];
  /** trail cell key -> true for O(1) hit tests */
  trailSet: Set<string>;
  kills: number;
  deaths: number;
  respawnAt: number;
  lastMoveAt: number;
}

const players = new Map<string, Player>(); // socketId -> player
const idToSocket = new Map<number, string>();
let nextPlayerId = 1;
let tick = 0;
let territoryDirty = true;
const events: GameEvent[] = [];
const MAX_EVENTS = 40;

function cellKey(x: number, y: number) {
  return `${x},${y}`;
}

function pushEvent(e: Omit<GameEvent, "id" | "at"> & { at?: number }) {
  const ev: GameEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: e.at ?? Date.now(),
    type: e.type,
    message: e.message,
    by: e.by,
    target: e.target,
  };
  events.unshift(ev);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  return ev;
}

function sanitizeName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const t = name.trim().replace(/\s+/g, " ");
  if (t.length < 1 || t.length > MAX_NAME_LENGTH) return null;
  if (/[\u0000-\u001F\u007F]/.test(t)) return null;
  return t;
}

function pickColor(): string {
  const used = new Set([...players.values()].map((p) => p.color));
  for (const c of PLAYER_COLORS) {
    if (!used.has(c)) return c;
  }
  return PLAYER_COLORS[nextPlayerId % PLAYER_COLORS.length]!;
}

function publicPlayer(p: Player): PublicPlayer {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    x: p.x,
    y: p.y,
    alive: p.alive,
    drawing: p.drawing,
    trail: p.trail.slice(-200), // cap wire size
    cells: countOwner(owners, p.id),
    kills: p.kills,
    deaths: p.deaths,
    respawnAt: p.respawnAt,
  };
}

function ownsCell(playerId: number, x: number, y: number): boolean {
  if (!inBounds(x, y)) return false;
  return owners[idx(x, y)] === playerId;
}

function isOnOwnTerritory(p: Player): boolean {
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  // check nearby for smoother edge
  for (let dy = -0; dy <= 0; dy++) {
    for (let dx = -0; dx <= 0; dx++) {
      if (ownsCell(p.id, cx + dx, cy + dy)) return true;
    }
  }
  return ownsCell(p.id, cx, cy);
}

function findTrailOwner(
  x: number,
  y: number,
  exceptId: number
): Player | null {
  const k = cellKey(x, y);
  for (const p of players.values()) {
    if (!p.alive || p.id === exceptId || !p.drawing) continue;
    if (p.trailSet.has(k)) return p;
  }
  return null;
}

function killPlayer(
  victim: Player,
  reason: "cut" | "suicide" | "system",
  killer?: Player
) {
  if (!victim.alive) return;

  victim.alive = false;
  victim.drawing = false;
  victim.trail = [];
  victim.trailSet.clear();
  victim.deaths += 1;
  victim.respawnAt = Date.now() + RESPAWN_SECONDS * 1000;
  clearOwner(owners, victim.id);
  territoryDirty = true;

  if (reason === "cut" && killer) {
    killer.kills += 1;
    pushEvent({
      type: "cut",
      message: `${killer.name} cut ${victim.name}'s trail!`,
      by: killer.id,
      target: victim.id,
    });
    // private-style messages encoded in same feed
    pushEvent({
      type: "kill",
      message: `You eliminated ${victim.name}`,
      by: killer.id,
      target: victim.id,
    });
  } else if (reason === "suicide") {
    pushEvent({
      type: "suicide",
      message: `${victim.name} hit their own trail`,
      target: victim.id,
    });
  } else {
    pushEvent({
      type: "system",
      message: `${victim.name} was eliminated`,
      target: victim.id,
    });
  }
}

function respawnPlayer(p: Player) {
  // Find open-ish spawn near campus center
  const cx = GRID_WIDTH / 2 + (Math.random() - 0.5) * 20;
  const cy = GRID_HEIGHT / 2 + (Math.random() - 0.5) * 20;
  p.x = cx;
  p.y = cy;
  p.alive = true;
  p.drawing = false;
  p.trail = [];
  p.trailSet.clear();
  p.respawnAt = 0;
  paintSpawn(owners, p.id, cx, cy, SPAWN_RADIUS);
  territoryDirty = true;
  pushEvent({
    type: "respawn",
    message: `${p.name} is back in the game`,
    by: p.id,
  });
}

function tryCloseTrail(p: Player) {
  if (!p.drawing || p.trail.length < 3) {
    p.drawing = false;
    p.trail = [];
    p.trailSet.clear();
    return;
  }
  const gained = claimEnclosed(owners, p.id, p.trail);
  territoryDirty = true;
  p.drawing = false;
  p.trail = [];
  p.trailSet.clear();
  if (gained > 0) {
    pushEvent({
      type: "claim",
      message: `${p.name} claimed ${gained} cells`,
      by: p.id,
    });
  }
}

function processMove(p: Player, nx: number, ny: number) {
  if (!p.alive) {
    if (p.respawnAt && Date.now() >= p.respawnAt) {
      respawnPlayer(p);
    } else {
      return;
    }
  }

  // clamp
  nx = Math.min(GRID_WIDTH - 0.01, Math.max(0, nx));
  ny = Math.min(GRID_HEIGHT - 0.01, Math.max(0, ny));

  const dist = Math.hypot(nx - p.x, ny - p.y);
  if (dist < MIN_MOVE_CELLS) return;

  const path = lineCells(p.x, p.y, nx, ny);
  p.x = nx;
  p.y = ny;
  p.lastMoveAt = Date.now();

  // skip first cell (current)
  for (let i = 1; i < path.length; i++) {
    const c = path[i]!;
    if (!inBounds(c.x, c.y)) continue;

    const onOwn = ownsCell(p.id, c.x, c.y);

    // Hit enemy trail?
    const enemy = findTrailOwner(c.x, c.y, p.id);
    if (enemy) {
      killPlayer(enemy, "cut", p);
    }

    if (onOwn) {
      if (p.drawing) {
        tryCloseTrail(p);
      }
      continue;
    }

    // Outside own land — draw trail
    if (!p.drawing) {
      p.drawing = true;
      p.trail = [];
      p.trailSet.clear();
    }

    const k = cellKey(c.x, c.y);
    // Self-collision (ignore last few cells of own trail)
    if (p.trailSet.has(k) && p.trail.length > 4) {
      const recent = p.trail.slice(-3).some((t) => t.x === c.x && t.y === c.y);
      if (!recent) {
        killPlayer(p, "suicide");
        return;
      }
    }

    if (!p.trailSet.has(k)) {
      p.trail.push({ x: c.x, y: c.y });
      p.trailSet.add(k);
      if (p.trail.length > MAX_TRAIL_LENGTH) {
        // force close if somehow still on territory edge later; else die
        killPlayer(p, "system");
        pushEvent({
          type: "system",
          message: `${p.name}'s trail was too long`,
          target: p.id,
        });
        return;
      }
    }
  }

  // If ended on own territory after path, close
  if (p.alive && p.drawing && isOnOwnTerritory(p)) {
    tryCloseTrail(p);
  }
}

// ─── HTTP + Socket ───────────────────────────────────────

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res, parse(req.url!, true));
  });

  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 1e6,
  });

  function snapshot(forSocket?: string): GameHello {
    const me = forSocket ? players.get(forSocket) : undefined;
    return {
      you: me?.id ?? null,
      gridWidth: GRID_WIDTH,
      gridHeight: GRID_HEIGHT,
      players: [...players.values()].map(publicPlayer),
      territory: encodeOwnersRLE(owners),
      events: events.slice(0, 20),
      respawnSeconds: RESPAWN_SECONDS,
    };
  }

  function broadcastState() {
    tick++;
    const payload: GameStateDiff = {
      players: [...players.values()].map(publicPlayer),
      tick,
      events: events.slice(0, 12),
    };
    if (territoryDirty) {
      payload.territory = encodeOwnersRLE(owners);
      territoryDirty = false;
    }
    io.emit("state", payload);
  }

  io.on("connection", (socket: Socket) => {
    socket.emit("hello", snapshot());

    socket.on("join", (payload: JoinPayload, ack?: (r: unknown) => void) => {
      if (players.has(socket.id)) {
        ack?.({ ok: true, you: players.get(socket.id)!.id });
        return;
      }
      const name = sanitizeName(payload?.name);
      if (!name) {
        ack?.({ error: "Name required (1–16 chars)." });
        return;
      }

      // unique-ish name
      let finalName = name;
      const names = new Set([...players.values()].map((p) => p.name.toLowerCase()));
      if (names.has(finalName.toLowerCase())) {
        finalName = `${name}${Math.floor(Math.random() * 90 + 10)}`;
      }

      const id = nextPlayerId++;
      if (nextPlayerId > 65000) nextPlayerId = 1;

      const cx = GRID_WIDTH / 2 + (Math.random() - 0.5) * 16;
      const cy = GRID_HEIGHT / 2 + (Math.random() - 0.5) * 16;

      const p: Player = {
        id,
        socketId: socket.id,
        name: finalName,
        color: pickColor(),
        x: cx,
        y: cy,
        alive: true,
        drawing: false,
        trail: [],
        trailSet: new Set(),
        kills: 0,
        deaths: 0,
        respawnAt: 0,
        lastMoveAt: Date.now(),
      };

      paintSpawn(owners, id, cx, cy, SPAWN_RADIUS);
      territoryDirty = true;
      players.set(socket.id, p);
      idToSocket.set(id, socket.id);

      pushEvent({
        type: "join",
        message: `${finalName} joined the campus`,
        by: id,
      });

      socket.emit("hello", snapshot(socket.id));
      broadcastState();
      ack?.({ ok: true, you: id, name: finalName, color: p.color });
    });

    socket.on("move", (payload: MovePayload) => {
      const p = players.get(socket.id);
      if (!p) return;
      const x = Number(payload?.x);
      const y = Number(payload?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      processMove(p, x, y);
    });

    /** Client requests immediate respawn when timer done */
    socket.on("respawn", () => {
      const p = players.get(socket.id);
      if (!p || p.alive) return;
      if (Date.now() < p.respawnAt) return;
      respawnPlayer(p);
      broadcastState();
    });

    socket.on("disconnect", () => {
      const p = players.get(socket.id);
      if (!p) return;
      clearOwner(owners, p.id);
      territoryDirty = true;
      players.delete(socket.id);
      idToSocket.delete(p.id);
      pushEvent({
        type: "leave",
        message: `${p.name} left`,
        by: p.id,
      });
      broadcastState();
    });
  });

  // Auto-respawn check + state broadcast
  setInterval(() => {
    const now = Date.now();
    for (const p of players.values()) {
      if (!p.alive && p.respawnAt && now >= p.respawnAt) {
        respawnPlayer(p);
      }
    }
    if (players.size > 0) broadcastState();
  }, TICK_MS);

  httpServer.listen(port, hostname, () => {
    console.log(`> DSCE Campus Claim on ${hostname}:${port}`);
    console.log(
      `> Grid ${GRID_WIDTH}×${GRID_HEIGHT} · paper.io mode · bounds center ${CAMPUS_BOUNDS.center.lat},${CAMPUS_BOUNDS.center.lng}`
    );
  });
});
