/**
 * DSCE Place — multiplayer pixel canvas
 * Stars, free/team modes, eraser, power-ups. No GPS.
 */
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer, type Socket } from "socket.io";
import fs from "fs";
import path from "path";
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  MAX_STARS,
  REGEN_SECONDS,
  MAX_NAME_LENGTH,
  COLOR_PALETTE,
  TEAMS,
  POWERUPS,
  ERASER_COST,
  BASE_SCORE_PER_PIXEL,
  colorForTeam,
  type GameMode,
  type TeamId,
  type WaveDir,
} from "./src/lib/config";
import { bombCells, waveCells } from "./src/lib/gridOps";
import type {
  Pixel,
  PlacePixelPayload,
  QuotaUpdate,
  ServerHello,
  TeamScoreRow,
  FreeScoreRow,
  PixelsBatchEvent,
  ScoresUpdate,
  ToolId,
  PlayerIdentity,
} from "./src/lib/types";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const DATA_DIR = path.join(process.cwd(), "data");
const REGEN_MS = REGEN_SECONDS * 1000;

// ── Persistence ──────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function worldFile(mode: GameMode) {
  return path.join(DATA_DIR, `pixels-${mode}.json`);
}

function loadWorld(mode: GameMode): Map<string, Pixel> {
  ensureDataDir();
  const map = new Map<string, Pixel>();
  const file = worldFile(mode);
  // migrate legacy single file into free mode once
  const legacy = path.join(DATA_DIR, "pixels.json");
  const pathToRead = fs.existsSync(file)
    ? file
    : mode === "free" && fs.existsSync(legacy)
      ? legacy
      : null;
  if (!pathToRead) return map;
  try {
    const raw = JSON.parse(fs.readFileSync(pathToRead, "utf-8")) as Pixel[];
    for (const p of raw) {
      if (
        typeof p.x === "number" &&
        typeof p.y === "number" &&
        p.x >= 0 &&
        p.x < GRID_WIDTH &&
        p.y >= 0 &&
        p.y < GRID_HEIGHT
      ) {
        map.set(`${p.x},${p.y}`, {
          ...p,
          mode,
          team: mode === "team" ? (p.team as TeamId) ?? null : null,
        });
      }
    }
  } catch {
    console.warn(`Could not load ${pathToRead}`);
  }
  return map;
}

interface IpQuota {
  stars: number;
  regenStartedAt: number;
  multiplierUntil: number;
}

function loadQuotas(): Map<string, IpQuota> {
  ensureDataDir();
  const map = new Map<string, IpQuota>();
  const file = path.join(DATA_DIR, "quotas.json");
  if (!fs.existsSync(file)) return map;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<
      string,
      IpQuota & { placedCount?: number }
    >;
    for (const [ip, q] of Object.entries(raw)) {
      if (!q || typeof q !== "object") continue;
      if (typeof q.stars === "number") {
        map.set(ip, {
          stars: Math.min(MAX_STARS, Math.max(0, q.stars)),
          regenStartedAt:
            typeof q.regenStartedAt === "number" ? q.regenStartedAt : 0,
          multiplierUntil:
            typeof q.multiplierUntil === "number" ? q.multiplierUntil : 0,
        });
      } else if (typeof q.placedCount === "number") {
        map.set(ip, {
          stars: Math.max(0, MAX_STARS - q.placedCount),
          regenStartedAt: 0,
          multiplierUntil: 0,
        });
      }
    }
  } catch {
    console.warn("Could not load quotas.json");
  }
  return map;
}

/** Personal score tallies (free mode) name → score */
type ScoreBook = {
  /** team → score points */
  teamScore: Map<TeamId, number>;
  /** free mode name → score */
  freeScore: Map<string, number>;
};

function loadScores(): ScoreBook {
  ensureDataDir();
  const file = path.join(DATA_DIR, "scores.json");
  const book: ScoreBook = {
    teamScore: new Map(),
    freeScore: new Map(),
  };
  if (!fs.existsSync(file)) return book;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      teamScore?: Record<string, number>;
      freeScore?: Record<string, number>;
    };
    for (const [k, v] of Object.entries(raw.teamScore || {})) {
      if (TEAMS.includes(k as TeamId)) book.teamScore.set(k as TeamId, v);
    }
    for (const [k, v] of Object.entries(raw.freeScore || {})) {
      book.freeScore.set(k, v);
    }
  } catch {
    /* empty */
  }
  return book;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    ensureDataDir();
    for (const mode of ["free", "team"] as GameMode[]) {
      fs.writeFileSync(
        worldFile(mode),
        JSON.stringify(Array.from(worlds[mode].values()))
      );
    }
    const qObj: Record<string, IpQuota> = {};
    for (const [ip, q] of quotas) qObj[ip] = q;
    fs.writeFileSync(path.join(DATA_DIR, "quotas.json"), JSON.stringify(qObj));
    const scoresObj = {
      teamScore: Object.fromEntries(scores.teamScore),
      freeScore: Object.fromEntries(scores.freeScore),
    };
    fs.writeFileSync(
      path.join(DATA_DIR, "scores.json"),
      JSON.stringify(scoresObj)
    );
    const idObj: Record<string, StoredIdentity> = {};
    for (const [k, v] of identities) idObj[k] = v;
    fs.writeFileSync(
      path.join(DATA_DIR, "identities.json"),
      JSON.stringify(idObj)
    );
  }, 600);
}

// ── Validation ───────────────────────────────────────────

function sanitizeName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) return null;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null;
  return trimmed;
}

function isValidColor(color: unknown): color is string {
  return (
    typeof color === "string" &&
    (COLOR_PALETTE as readonly string[]).includes(color)
  );
}

function isValidMode(m: unknown): m is GameMode {
  return m === "free" || m === "team";
}

function isValidTeam(t: unknown): t is TeamId {
  return typeof t === "string" && (TEAMS as readonly string[]).includes(t);
}

/** Resolve real client IP (Railway / Cloudflare / reverse proxies). */
function getClientIp(socket: Socket): string {
  const headers = socket.handshake.headers;
  const pick = (v: string | string[] | undefined): string | null => {
    if (!v) return null;
    const s = Array.isArray(v) ? v[0] : v;
    if (!s || typeof s !== "string") return null;
    // X-Forwarded-For: client, proxy1, proxy2 — leftmost is original client
    return s.split(",")[0]!.trim().replace(/^::ffff:/, "") || null;
  };

  const candidates = [
    pick(headers["cf-connecting-ip"]),
    pick(headers["true-client-ip"]),
    pick(headers["x-real-ip"]),
    pick(headers["x-forwarded-for"]),
    pick(headers["x-client-ip"]),
  ];
  for (const c of candidates) {
    if (c && c !== "unknown" && c !== "127.0.0.1" && c !== "::1") return c;
  }
  for (const c of candidates) {
    if (c) return c;
  }
  const addr =
    socket.handshake.address ||
    socket.request.socket?.remoteAddress ||
    "unknown";
  return addr.replace(/^::ffff:/, "");
}

/** Mask for UI (never show full IP to other players) */
function maskIp(ip: string): string {
  if (!ip || ip === "unknown") return "—";
  if (ip.includes(".")) {
    const p = ip.split(".");
    return `${p[0]}.${p[1]}.*.*`;
  }
  // IPv6: show first 2 hextets
  const p = ip.split(":");
  return `${p[0] || ""}:${p[1] || ""}:…`;
}

// ── Identity: one device/network = one player ────────────

interface StoredIdentity {
  name: string;
  mode: GameMode;
  team: TeamId | null;
  teamLocked: boolean;
  deviceIds: string[];
  updatedAt: number;
}

/** Keyed by `ip:<addr>` and also index deviceId → ip key */
const identities = new Map<string, StoredIdentity>();
const deviceToIpKey = new Map<string, string>();

function ipKey(ip: string) {
  return `ip:${ip}`;
}

function loadIdentities() {
  ensureDataDir();
  const file = path.join(DATA_DIR, "identities.json");
  if (!fs.existsSync(file)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<
      string,
      StoredIdentity
    >;
    for (const [k, v] of Object.entries(raw)) {
      if (!v?.name) continue;
      identities.set(k, {
        name: v.name,
        mode: v.mode === "team" ? "team" : "free",
        team: v.team && isValidTeam(v.team) ? v.team : null,
        teamLocked: Boolean(v.teamLocked || v.team),
        deviceIds: Array.isArray(v.deviceIds) ? v.deviceIds : [],
        updatedAt: v.updatedAt || Date.now(),
      });
      for (const d of identities.get(k)!.deviceIds) {
        deviceToIpKey.set(d, k);
      }
    }
  } catch {
    console.warn("Could not load identities.json");
  }
}

function saveIdentitiesSoon() {
  schedulePersist();
}

function findIdentity(ip: string, deviceId?: string | null): StoredIdentity | null {
  if (deviceId && deviceToIpKey.has(deviceId)) {
    const k = deviceToIpKey.get(deviceId)!;
    const id = identities.get(k);
    if (id) return id;
  }
  return identities.get(ipKey(ip)) ?? null;
}

function toPublicIdentity(id: StoredIdentity): PlayerIdentity {
  return {
    name: id.name,
    mode: id.mode,
    team: id.team,
    teamLocked: id.teamLocked,
  };
}

/**
 * Register or resume player for this IP (+ optional durable device id).
 * Name is bound to IP: same network keeps same player across browsers/refreshes.
 */
function upsertIdentity(
  ip: string,
  opts: {
    name?: string | null;
    mode?: GameMode;
    team?: TeamId | null;
    deviceId?: string | null;
  }
): { ok: true; identity: StoredIdentity } | { ok: false; error: string; identity?: StoredIdentity } {
  const key = ipKey(ip);
  let id = identities.get(key);

  // Device previously seen on another IP? Prefer that profile if IP unknown fresh
  if (!id && opts.deviceId && deviceToIpKey.has(opts.deviceId)) {
    const oldKey = deviceToIpKey.get(opts.deviceId)!;
    id = identities.get(oldKey) ?? undefined;
    if (id) {
      // Migrate to current IP
      identities.delete(oldKey);
      identities.set(key, id);
      for (const d of id.deviceIds) deviceToIpKey.set(d, key);
    }
  }

  if (!id) {
    const name = sanitizeName(opts.name);
    if (!name) return { ok: false, error: "Enter a name (1–20 characters)." };
    if (opts.mode === "team" && !isValidTeam(opts.team)) {
      return { ok: false, error: "Pick a valid team/branch." };
    }
    id = {
      name,
      mode: opts.mode === "team" ? "team" : "free",
      team: opts.mode === "team" && isValidTeam(opts.team) ? opts.team! : null,
      teamLocked: opts.mode === "team" && isValidTeam(opts.team),
      deviceIds: opts.deviceId ? [opts.deviceId] : [],
      updatedAt: Date.now(),
    };
    identities.set(key, id);
    if (opts.deviceId) deviceToIpKey.set(opts.deviceId, key);
    saveIdentitiesSoon();
    return { ok: true, identity: id };
  }

  // Existing identity — name is permanent for this IP
  if (opts.deviceId && !id.deviceIds.includes(opts.deviceId)) {
    id.deviceIds.push(opts.deviceId);
    if (id.deviceIds.length > 12) id.deviceIds = id.deviceIds.slice(-12);
    deviceToIpKey.set(opts.deviceId, key);
  }

  if (opts.mode === "free" || opts.mode === "team") {
    id.mode = opts.mode;
  }

  if (opts.mode === "team") {
    if (id.teamLocked && id.team) {
      // Team cannot change once locked
      if (opts.team && opts.team !== id.team) {
        return {
          ok: false,
          error: "Team can't be changed.",
          identity: id,
        };
      }
      id.mode = "team";
    } else if (isValidTeam(opts.team)) {
      id.team = opts.team;
      id.teamLocked = true;
      id.mode = "team";
    } else if (!id.team) {
      return { ok: false, error: "Pick a valid team/branch.", identity: id };
    }
  } else if (opts.mode === "free") {
    id.mode = "free";
    // keep locked team on file for when they return to team mode
  }

  id.updatedAt = Date.now();
  saveIdentitiesSoon();
  return { ok: true, identity: id };
}

// ── State ────────────────────────────────────────────────

const worlds: Record<GameMode, Map<string, Pixel>> = {
  free: loadWorld("free"),
  team: loadWorld("team"),
};
const quotas = loadQuotas();
const scores = loadScores();
loadIdentities();

function getOrCreateQuota(ip: string): IpQuota {
  let q = quotas.get(ip);
  if (!q) {
    q = { stars: MAX_STARS, regenStartedAt: 0, multiplierUntil: 0 };
    quotas.set(ip, q);
  }
  return q;
}

function refreshStars(q: IpQuota, now: number): void {
  if (q.stars >= MAX_STARS) {
    q.stars = MAX_STARS;
    q.regenStartedAt = 0;
    return;
  }
  if (!q.regenStartedAt) {
    q.regenStartedAt = now;
    return;
  }
  const elapsed = now - q.regenStartedAt;
  if (elapsed < REGEN_MS) return;
  const gained = Math.floor(elapsed / REGEN_MS);
  q.stars = Math.min(MAX_STARS, q.stars + gained);
  if (q.stars >= MAX_STARS) {
    q.stars = MAX_STARS;
    q.regenStartedAt = 0;
  } else {
    q.regenStartedAt += gained * REGEN_MS;
  }
}

function nextStarInSeconds(q: IpQuota, now: number): number {
  if (q.stars >= MAX_STARS || !q.regenStartedAt) return 0;
  const remainingMs = REGEN_MS - ((now - q.regenStartedAt) % REGEN_MS);
  return Math.min(REGEN_SECONDS, Math.max(1, Math.ceil(remainingMs / 1000)));
}

function quotaSnapshot(ip: string, now = Date.now()): QuotaUpdate {
  const q = getOrCreateQuota(ip);
  refreshStars(q, now);
  const isFull = q.stars >= MAX_STARS;
  return {
    stars: q.stars,
    maxStars: MAX_STARS,
    regenSeconds: REGEN_SECONDS,
    nextStarIn: isFull ? 0 : nextStarInSeconds(q, now),
    isFull,
    multiplierUntil: q.multiplierUntil > now ? q.multiplierUntil : 0,
    ipMasked: maskIp(ip),
  };
}

function trySpendStars(
  ip: string,
  cost: number,
  now: number
): { ok: true; quota: QuotaUpdate } | { ok: false; quota: QuotaUpdate } {
  const q = getOrCreateQuota(ip);
  refreshStars(q, now);
  if (q.stars < cost) return { ok: false, quota: quotaSnapshot(ip, now) };
  const wasFull = q.stars >= MAX_STARS;
  q.stars -= cost;
  if (wasFull || !q.regenStartedAt) q.regenStartedAt = now;
  schedulePersist();
  return { ok: true, quota: quotaSnapshot(ip, now) };
}

function pixelScore(ip: string, now: number): number {
  const q = getOrCreateQuota(ip);
  if (q.multiplierUntil > now) return POWERUPS.multiplier.scorePerPixel;
  return BASE_SCORE_PER_PIXEL;
}

function addScore(
  mode: GameMode,
  name: string,
  team: TeamId | null | undefined,
  points: number
) {
  if (points <= 0) return;
  if (mode === "team" && team && isValidTeam(team)) {
    scores.teamScore.set(team, (scores.teamScore.get(team) || 0) + points);
  } else if (mode === "free") {
    scores.freeScore.set(name, (scores.freeScore.get(name) || 0) + points);
  }
}

function teamScores(): TeamScoreRow[] {
  const world = worlds.team;
  const counts = new Map<TeamId, number>();
  for (const t of TEAMS) counts.set(t, 0);
  for (const p of world.values()) {
    if (p.team && counts.has(p.team as TeamId)) {
      counts.set(p.team as TeamId, (counts.get(p.team as TeamId) || 0) + 1);
    }
  }
  const total = GRID_WIDTH * GRID_HEIGHT;
  return TEAMS.map((team) => {
    const pixels = counts.get(team) || 0;
    return {
      team,
      pixels,
      score: scores.teamScore.get(team) || 0,
      percent: Math.round((pixels / total) * 10000) / 100,
    };
  }).sort((a, b) => b.score - a.score || b.pixels - a.pixels);
}

function freeScores(): FreeScoreRow[] {
  const world = worlds.free;
  const counts = new Map<string, number>();
  for (const p of world.values()) {
    counts.set(p.name, (counts.get(p.name) || 0) + 1);
  }
  const rows: FreeScoreRow[] = [];
  const names = new Set([...counts.keys(), ...scores.freeScore.keys()]);
  for (const name of names) {
    rows.push({
      name,
      pixels: counts.get(name) || 0,
      score: scores.freeScore.get(name) || 0,
    });
  }
  return rows.sort((a, b) => b.score - a.score || b.pixels - a.pixels).slice(0, 20);
}

function paintCell(
  mode: GameMode,
  x: number,
  y: number,
  color: string,
  name: string,
  team: TeamId | null,
  now: number
): Pixel {
  // Team mode: force the branch color (one color per team)
  const finalColor =
    mode === "team" && team ? colorForTeam(team) : color;
  const pixel: Pixel = {
    x,
    y,
    color: finalColor,
    name,
    placedAt: now,
    mode,
    team: mode === "team" ? team : null,
  };
  worlds[mode].set(`${x},${y}`, pixel);
  return pixel;
}

// ── Boot ─────────────────────────────────────────────────

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res, parse(req.url!, true));
  });

  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
  });

  function broadcastOnline() {
    io.emit("online", { count: io.engine.clientsCount });
  }

  function emitScores() {
    const payload: ScoresUpdate = {
      mode: "team",
      teamScores: teamScores(),
      freeScores: freeScores(),
    };
    io.emit("scores", payload);
  }

  function emitBatch(batch: PixelsBatchEvent) {
    // Room per mode for efficient sync
    io.to(`mode:${batch.mode}`).emit("pixels", batch);
    // Also emit scores when territory changes
    emitScores();
  }

  function buildHello(
    ip: string,
    mode: GameMode,
    identity: StoredIdentity | null
  ): ServerHello {
    return {
      pixels: Array.from(worlds[mode].values()),
      gridWidth: GRID_WIDTH,
      gridHeight: GRID_HEIGHT,
      maxStars: MAX_STARS,
      regenSeconds: REGEN_SECONDS,
      onlineCount: io.engine.clientsCount,
      palette: COLOR_PALETTE,
      quota: quotaSnapshot(ip),
      mode,
      teamScores: teamScores(),
      freeScores: freeScores(),
      teams: TEAMS,
      identity: identity ? toPublicIdentity(identity) : null,
    };
  }

  io.on("connection", (socket) => {
    const ip = getClientIp(socket);
    socket.data.ip = ip;
    socket.data.mode = "free" as GameMode;
    socket.data.deviceId = null as string | null;

    // Client may announce deviceId immediately via handshake auth
    const authDevice =
      typeof socket.handshake.auth?.deviceId === "string"
        ? socket.handshake.auth.deviceId.slice(0, 64)
        : null;
    if (authDevice) socket.data.deviceId = authDevice;

    const existing = findIdentity(ip, authDevice);
    const startMode: GameMode = existing?.mode || "free";
    socket.data.mode = startMode;
    socket.data.team = existing?.team ?? null;

    socket.emit("hello", buildHello(ip, startMode, existing));
    socket.join(`mode:${startMode}`);
    broadcastOnline();
    console.log(
      `> connect ip=${ip} device=${authDevice || "-"} known=${Boolean(existing)} name=${existing?.name || "-"}`
    );

    /** Bind durable browser id (helps multi-tab; IP still primary across browsers) */
    socket.on("helloDevice", (payload: { deviceId?: string }) => {
      const d =
        typeof payload?.deviceId === "string"
          ? payload.deviceId.trim().slice(0, 64)
          : null;
      if (!d) return;
      socket.data.deviceId = d;
      const id = findIdentity(ip, d);
      if (id) {
        upsertIdentity(ip, { deviceId: d, mode: id.mode, team: id.team, name: id.name });
        socket.emit("hello", buildHello(ip, id.mode, id));
      }
    });

    socket.on(
      "joinMode",
      (
        payload: {
          mode: GameMode;
          team?: TeamId | null;
          name?: string;
          deviceId?: string;
        },
        ack?: (r: unknown) => void
      ) => {
        if (!isValidMode(payload?.mode)) {
          ack?.({ error: "Invalid mode" });
          return;
        }
        const deviceId =
          (typeof payload.deviceId === "string" && payload.deviceId.slice(0, 64)) ||
          (socket.data.deviceId as string | null);
        if (deviceId) socket.data.deviceId = deviceId;

        const result = upsertIdentity(ip, {
          name: payload.name,
          mode: payload.mode,
          team: payload.team,
          deviceId,
        });
        if (!result.ok) {
          ack?.({
            error: result.error,
            identity: result.identity
              ? toPublicIdentity(result.identity)
              : undefined,
          });
          if (result.identity) {
            socket.emit(
              "hello",
              buildHello(ip, result.identity.mode, result.identity)
            );
          }
          return;
        }

        const id = result.identity;
        const m = id.mode;
        const prev = socket.data.mode as GameMode;
        socket.leave(`mode:${prev}`);
        socket.join(`mode:${m}`);
        socket.data.mode = m;
        socket.data.team = m === "team" ? id.team : null;
        console.log(
          `> joinMode ip=${ip} name=${id.name} mode=${m} team=${id.team ?? "-"} locked=${id.teamLocked}`
        );

        socket.emit("hello", buildHello(ip, m, id));
        ack?.({
          ok: true,
          mode: m,
          identity: toPublicIdentity(id),
        });
      }
    );

    socket.on(
      "action",
      (payload: PlacePixelPayload, ack?: (r: unknown) => void) => {
        const clientIp = (socket.data.ip as string) || getClientIp(socket);
        const bound = findIdentity(
          clientIp,
          socket.data.deviceId as string | null
        );
        // Prefer server-bound name for this IP (anti-rename spam)
        let name = bound?.name || sanitizeName(payload?.name);
        if (!name) {
          ack?.({ error: "Enter a name (1–20 characters)." });
          return;
        }
        if (bound && bound.name !== name) {
          name = bound.name; // force original name
        }
        if (!isValidMode(payload?.mode)) {
          ack?.({ error: "Invalid mode." });
          return;
        }
        let mode = payload.mode;
        let team: TeamId | null =
          mode === "team" && isValidTeam(payload.team) ? payload.team : null;

        // Enforce locked team / identity mode consistency
        if (bound) {
          if (mode === "team") {
            if (bound.teamLocked && bound.team) {
              team = bound.team;
            } else if (!team) {
              ack?.({ error: "Pick a team for Team Mode." });
              return;
            }
          }
        } else if (mode === "team" && !team) {
          ack?.({ error: "Pick a team for Team Mode." });
          return;
        }

        const x = Number(payload?.x);
        const y = Number(payload?.y);
        if (
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          x < 0 ||
          y < 0 ||
          x >= GRID_WIDTH ||
          y >= GRID_HEIGHT
        ) {
          ack?.({ error: "Invalid coordinates." });
          return;
        }

        const tool: ToolId = payload.tool || "paint";
        const now = Date.now();
        const world = worlds[mode];

        // ── Multiplier activate ──
        if (tool === "multiplier") {
          const spend = trySpendStars(clientIp, POWERUPS.multiplier.cost, now);
          if (!spend.ok) {
            ack?.({
              error: `Need ${POWERUPS.multiplier.cost} stars.`,
              quota: spend.quota,
            });
            socket.emit("quota", spend.quota);
            return;
          }
          const q = getOrCreateQuota(clientIp);
          q.multiplierUntil = now + POWERUPS.multiplier.durationMs;
          schedulePersist();
          const quota = quotaSnapshot(clientIp, now);
          socket.emit("quota", quota);
          ack?.({ ok: true, quota, multiplierUntil: q.multiplierUntil });
          return;
        }

        // ── Eraser ──
        if (tool === "eraser") {
          const spend = trySpendStars(clientIp, ERASER_COST, now);
          if (!spend.ok) {
            ack?.({ error: "Need 1 star to erase.", quota: spend.quota });
            socket.emit("quota", spend.quota);
            return;
          }
          const key = `${x},${y}`;
          const existed = world.has(key);
          if (existed) world.delete(key);
          schedulePersist();
          emitBatch({
            mode,
            erased: [{ x, y }],
            fx: { type: "erase", x, y, points: 0 },
          });
          socket.emit("quota", spend.quota);
          ack?.({ ok: true, quota: spend.quota, erased: true });
          return;
        }

        // ── Paint / Bomb / Wave need color (team mode forces team color) ──
        let color = payload.color;
        if (mode === "team" && team) {
          color = colorForTeam(team);
        } else if (!isValidColor(payload?.color)) {
          ack?.({ error: "Pick a color from the palette." });
          return;
        }

        if (tool === "bomb") {
          const spend = trySpendStars(clientIp, POWERUPS.bomb.cost, now);
          if (!spend.ok) {
            ack?.({
              error: `Need ${POWERUPS.bomb.cost} stars for bomb.`,
              quota: spend.quota,
            });
            socket.emit("quota", spend.quota);
            return;
          }
          const cells = bombCells(x, y, POWERUPS.bomb.radius);
          const painted: Pixel[] = [];
          const ptsEach = pixelScore(clientIp, now);
          let totalPts = 0;
          for (const c of cells) {
            painted.push(paintCell(mode, c.x, c.y, color, name, team, now));
            totalPts += ptsEach;
          }
          addScore(mode, name, team, totalPts);
          schedulePersist();
          emitBatch({
            mode,
            pixels: painted,
            fx: { type: "bomb", x, y, color, points: totalPts },
          });
          socket.emit("quota", spend.quota);
          ack?.({ ok: true, quota: spend.quota, count: painted.length, points: totalPts });
          return;
        }

        if (tool === "wave") {
          const dir = payload.dir as WaveDir;
          if (!["up", "down", "left", "right"].includes(dir)) {
            ack?.({ error: "Pick a wave direction." });
            return;
          }
          const spend = trySpendStars(clientIp, POWERUPS.wave.cost, now);
          if (!spend.ok) {
            ack?.({
              error: `Need ${POWERUPS.wave.cost} stars for wave.`,
              quota: spend.quota,
            });
            socket.emit("quota", spend.quota);
            return;
          }
          const cells = waveCells(x, y, dir, POWERUPS.wave.length);
          const painted: Pixel[] = [];
          const ptsEach = pixelScore(clientIp, now);
          let totalPts = 0;
          for (const c of cells) {
            painted.push(paintCell(mode, c.x, c.y, color, name, team, now));
            totalPts += ptsEach;
          }
          addScore(mode, name, team, totalPts);
          schedulePersist();
          emitBatch({
            mode,
            pixels: painted,
            fx: { type: "wave", x, y, color, dir, points: totalPts },
          });
          socket.emit("quota", spend.quota);
          ack?.({ ok: true, quota: spend.quota, count: painted.length, points: totalPts });
          return;
        }

        // ── Normal paint (1 star) ──
        const spend = trySpendStars(clientIp, 1, now);
        if (!spend.ok) {
          const wait = spend.quota.nextStarIn;
          ack?.({
            error: wait
              ? `No stars left. Next star in ${wait}s.`
              : "No stars left.",
            quota: spend.quota,
          });
          socket.emit("quota", spend.quota);
          return;
        }

        const pts = pixelScore(clientIp, now);
        const pixel = paintCell(mode, x, y, color, name, team, now);
        addScore(mode, name, team, pts);
        schedulePersist();
        emitBatch({
          mode,
          pixels: [pixel],
          fx: { type: "paint", x, y, color, points: pts },
        });
        socket.emit("quota", spend.quota);
        ack?.({ ok: true, pixel, quota: spend.quota, points: pts });
      }
    );

    socket.on("disconnect", () => {
      broadcastOnline();
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> DSCE Place on ${hostname}:${port}`);
    console.log(
      `> free=${worlds.free.size} team=${worlds.team.size} · stars ${MAX_STARS} · no GPS`
    );
  });
});
