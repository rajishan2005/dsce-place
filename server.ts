/**
 * Custom Next.js + Socket.IO server for real-time DSCE pixel canvas.
 * Stars: max 30 per IP. Paint spends 1 star; regen of +1 star / 30s starts immediately.
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
} from "./src/lib/config";
import type {
  Pixel,
  PlacePixelPayload,
  QuotaUpdate,
  ServerHello,
} from "./src/lib/types";

const dev = process.env.NODE_ENV !== "production";
// Always bind to all interfaces. Do NOT use process.env.HOSTNAME — on Railway/Docker
// that is the container name, which causes "Application failed to respond".
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const DATA_DIR = path.join(process.cwd(), "data");
const PIXELS_FILE = path.join(DATA_DIR, "pixels.json");
const QUOTAS_FILE = path.join(DATA_DIR, "quotas.json");
const REGEN_MS = REGEN_SECONDS * 1000;

// --- Persistence ---

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadPixels(): Map<string, Pixel> {
  ensureDataDir();
  const map = new Map<string, Pixel>();
  if (!fs.existsSync(PIXELS_FILE)) return map;
  try {
    const raw = JSON.parse(fs.readFileSync(PIXELS_FILE, "utf-8")) as Pixel[];
    for (const p of raw) {
      if (
        typeof p.x === "number" &&
        typeof p.y === "number" &&
        p.x >= 0 &&
        p.x < GRID_WIDTH &&
        p.y >= 0 &&
        p.y < GRID_HEIGHT
      ) {
        map.set(`${p.x},${p.y}`, p);
      }
    }
  } catch {
    console.warn("Could not load pixels.json — starting empty");
  }
  return map;
}

/**
 * Star bank per IP.
 * - stars: current charges (0..MAX_STARS)
 * - regenStartedAt: ms timestamp when the current regen cycle began
 *   (only meaningful when stars < MAX_STARS)
 */
interface IpQuota {
  stars: number;
  regenStartedAt: number;
}

function loadQuotas(): Map<string, IpQuota> {
  ensureDataDir();
  const map = new Map<string, IpQuota>();
  if (!fs.existsSync(QUOTAS_FILE)) return map;
  try {
    const raw = JSON.parse(fs.readFileSync(QUOTAS_FILE, "utf-8")) as Record<
      string,
      // support new + legacy formats
      IpQuota & { placedCount?: number; lastPlaceAt?: number }
    >;
    for (const [ip, q] of Object.entries(raw)) {
      if (!q || typeof q !== "object") continue;

      // New star format
      if (typeof q.stars === "number") {
        map.set(ip, {
          stars: Math.min(MAX_STARS, Math.max(0, q.stars)),
          regenStartedAt:
            typeof q.regenStartedAt === "number" ? q.regenStartedAt : Date.now(),
        });
        continue;
      }

      // Legacy: placedCount free-pool model → convert remaining free into stars
      if (typeof q.placedCount === "number") {
        const remaining = Math.max(0, MAX_STARS - q.placedCount);
        map.set(ip, {
          stars: remaining,
          regenStartedAt: remaining < MAX_STARS ? Date.now() : 0,
        });
      }
    }
  } catch {
    console.warn("Could not load quotas.json — starting empty");
  }
  return map;
}

let savePixelsTimer: ReturnType<typeof setTimeout> | null = null;
let saveQuotasTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSavePixels(pixelMap: Map<string, Pixel>) {
  if (savePixelsTimer) clearTimeout(savePixelsTimer);
  savePixelsTimer = setTimeout(() => {
    ensureDataDir();
    fs.writeFileSync(PIXELS_FILE, JSON.stringify(Array.from(pixelMap.values())));
  }, 500);
}

function scheduleSaveQuotas(quotaMap: Map<string, IpQuota>) {
  if (saveQuotasTimer) clearTimeout(saveQuotasTimer);
  saveQuotasTimer = setTimeout(() => {
    ensureDataDir();
    const obj: Record<string, IpQuota> = {};
    for (const [ip, q] of quotaMap) obj[ip] = q;
    fs.writeFileSync(QUOTAS_FILE, JSON.stringify(obj));
  }, 500);
}

// --- Validation ---

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

function getClientIp(socket: Socket): string {
  const headers = socket.handshake.headers;
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(",")[0]!.trim();
  }
  const realIp = headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) {
    return realIp.trim();
  }
  const addr =
    socket.handshake.address ||
    socket.request.socket?.remoteAddress ||
    "unknown";
  return addr.replace(/^::ffff:/, "");
}

// --- Star bank ---

const pixels = loadPixels();
const quotas = loadQuotas();

function getOrCreateQuota(ip: string): IpQuota {
  let q = quotas.get(ip);
  if (!q) {
    q = { stars: MAX_STARS, regenStartedAt: 0 };
    quotas.set(ip, q);
  }
  return q;
}

/** Apply passive regen based on elapsed time. Mutates quota. */
function refreshStars(q: IpQuota, now: number): void {
  if (q.stars >= MAX_STARS) {
    q.stars = MAX_STARS;
    q.regenStartedAt = 0;
    return;
  }
  if (!q.regenStartedAt) {
    // Should be regenerating but timer missing — start now
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
    // Keep remainder of current cycle so regen stays continuous
    q.regenStartedAt += gained * REGEN_MS;
  }
}

function nextStarInSeconds(q: IpQuota, now: number): number {
  if (q.stars >= MAX_STARS || !q.regenStartedAt) return 0;
  const remainingMs = REGEN_MS - ((now - q.regenStartedAt) % REGEN_MS);
  // If exactly on boundary, refreshStars should have applied; clamp 1..REGEN
  const sec = Math.ceil(remainingMs / 1000);
  return Math.min(REGEN_SECONDS, Math.max(1, sec));
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
  };
}

/**
 * Spend 1 star. Starts regen timer immediately if bank was full.
 * Returns null if not enough stars.
 */
function trySpendStar(
  ip: string,
  now: number
): { ok: true; quota: QuotaUpdate } | { ok: false; quota: QuotaUpdate } {
  const q = getOrCreateQuota(ip);
  refreshStars(q, now);

  if (q.stars < 1) {
    return { ok: false, quota: quotaSnapshot(ip, now) };
  }

  const wasFull = q.stars >= MAX_STARS;
  q.stars -= 1;

  // Regen starts the moment you leave full bank
  if (wasFull || !q.regenStartedAt) {
    q.regenStartedAt = now;
  }

  scheduleSaveQuotas(quotas);
  return { ok: true, quota: quotaSnapshot(ip, now) };
}

// --- Boot ---

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
  });

  function broadcastOnline() {
    io.emit("online", { count: io.engine.clientsCount });
  }

  io.on("connection", (socket) => {
    const ip = getClientIp(socket);
    socket.data.ip = ip;

    const hello: ServerHello = {
      pixels: Array.from(pixels.values()),
      gridWidth: GRID_WIDTH,
      gridHeight: GRID_HEIGHT,
      maxStars: MAX_STARS,
      regenSeconds: REGEN_SECONDS,
      onlineCount: io.engine.clientsCount,
      palette: COLOR_PALETTE,
      quota: quotaSnapshot(ip),
    };
    socket.emit("hello", hello);
    broadcastOnline();

    socket.on("place", (payload: PlacePixelPayload, ack?: (res: unknown) => void) => {
      const name = sanitizeName(payload?.name);
      if (!name) {
        ack?.({ error: "Enter a name (1–20 characters)." });
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
        ack?.({ error: "Invalid pixel coordinates." });
        return;
      }

      if (!isValidColor(payload?.color)) {
        ack?.({ error: "Pick a color from the palette." });
        return;
      }

      const clientIp = (socket.data.ip as string) || getClientIp(socket);
      const now = Date.now();
      const spend = trySpendStar(clientIp, now);

      if (!spend.ok) {
        const wait = spend.quota.nextStarIn;
        ack?.({
          error: wait
            ? `No stars left. Next star in ${wait}s.`
            : "No stars left.",
          nextStarIn: wait,
          stars: spend.quota.stars,
          quota: spend.quota,
        });
        socket.emit("quota", spend.quota);
        return;
      }

      const pixel: Pixel = {
        x,
        y,
        color: payload.color,
        name,
        placedAt: now,
      };

      pixels.set(`${x},${y}`, pixel);
      scheduleSavePixels(pixels);

      io.emit("pixel", { pixel });
      socket.emit("quota", spend.quota);
      ack?.({ ok: true, pixel, quota: spend.quota });
    });

    socket.on("disconnect", () => {
      broadcastOnline();
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> DSCE Place listening on ${hostname}:${port}`);
    console.log(
      `> Grid ${GRID_WIDTH}×${GRID_HEIGHT} · ${MAX_STARS} stars · regen ${REGEN_SECONDS}s · IP · ${pixels.size} pixels`
    );
  });
});
