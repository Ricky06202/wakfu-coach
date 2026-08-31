import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { chunkCount, initDb, saveChat } from "./db.js";
import { answerQuestion, retrieve } from "./rag.js";
import { env } from "./env.js";
import { loadSeed } from "./ingest/seed.js";
import { ingestWikiAll, ingestWikiTerms } from "./ingest/wiki.js";
import { ingestEncyclopedia } from "./ingest/encyclopedia.js";
import { ingestCargoAll, ingestCargoTopic } from "./ingest/cargo.js";

/* ------------------------------------------------------------------ */
/* Arranque de la base + siembra automática                            */
/* ------------------------------------------------------------------ */

initDb();

if (env.AUTO_SEED && chunkCount() === 0) {
  console.log("[db] base vacía -> sembrando dataset de muestra");
  const s = loadSeed();
  console.log(`[db] seed ok: ${JSON.stringify(s)}`);
}

/* ------------------------------------------------------------------ */
/* Frontend estático (dist de Astro)                                   */
/* ------------------------------------------------------------------ */

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(here, "../../frontend/dist"), // servidor compilado (server/dist)
  resolve(here, "../frontend/dist"), // dev (server/index.ts)
];
const frontendDist = candidates.find((p) => existsSync(join(p, "index.html")));

/* ------------------------------------------------------------------ */
/* Proxy de imágenes de la wiki (bloqueo por Referer)                  */
/* ------------------------------------------------------------------ */

const IMG_CACHE = join(dirname(env.DB_PATH), "images");

/** Proxy que descarga las imágenes de wakfu.wiki.gg con la Referer correcta
 *  (la wiki da 403 sin ella) y las cachea en disco bajo /app/data/images. */
async function fetchWikiImage(file: string): Promise<Buffer> {
  const url = `https://wakfu.wiki.gg/wiki/Special:FilePath/${encodeURIComponent(file)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "wakfu-coach/1.0", Referer: "https://wakfu.wiki.gg/" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`wiki img HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ------------------------------------------------------------------ */
/* Middleware de plataforma                                            */
/* ------------------------------------------------------------------ */

const app = new Hono<{ Variables: { requestId: string } }>();

app.use("*", logger());

app.use("*", async (c, next) => {
  c.set("requestId", randomUUID());
  await next();
});

app.use("/api/*", (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  return next();
});

app.use(
  "/api/*",
  cors({
    origin: env.ALLOWED_ORIGINS.length ? env.ALLOWED_ORIGINS : "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// Rate limiting en memoria (simple, suficiente para red local)
const hits = new Map<string, { count: number; resetAt: number }>();
app.use("/api/*", async (c, next) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("cf-connecting-ip") ?? "local";
  const now = Date.now();
  const entry = hits.get(ip) ?? { count: 0, resetAt: now + env.RATE_LIMIT_WINDOW_MS };
  if (entry.resetAt < now) {
    entry.count = 0;
    entry.resetAt = now + env.RATE_LIMIT_WINDOW_MS;
  }
  entry.count += 1;
  hits.set(ip, entry);
  if (entry.count > env.RATE_LIMIT_MAX) {
    throw new HTTPException(429, { message: "Demasiadas peticiones, espera un momento" });
  }
  await next();
});

/* ------------------------------------------------------------------ */
/* Rutas de la API                                                     */
/* ------------------------------------------------------------------ */

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1, "el mensaje no puede estar vacío").max(4000),
      }),
    )
    .min(1)
    .max(60),
  topK: z.number().int().min(1).max(20).optional(),
  // Capturas del juego como data URLs (data:image/png;base64,…) para el modelo de visión.
  images: z
    .array(z.string().max(env.LLM_MAX_IMAGE_MB * 1024 * 1024 * 1.5, "imagen demasiado grande"))
    .min(0)
    .max(env.LLM_MAX_IMAGES, `máximo ${env.LLM_MAX_IMAGES} imágenes por mensaje`)
    .optional()
    .default([])
    .transform((list) =>
      (list ?? []).filter((img) => /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(img)),
    ),
  // Perfil de la jugadora (nivel, clase, elemento, zona, objetivo…) que el coach adapta.
  profile: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40),
        value: z.string().trim().max(200),
      }),
    )
    .max(12)
    .optional()
    .default([]),
});

app.get("/api/health", (c) => {
  const llmConfigured = !!(env.OLLAMA_URL || (env.LLM_BASE_URL && env.LLM_API_KEY));
  return c.json({
    ok: true,
    service: "wakfu-coach",
    version: "1.0.0",
    db: { chunks: chunkCount() },
    rag: {
      mode: llmConfigured ? (env.OLLAMA_URL ? `ollama:${env.OLLAMA_MODEL}` : `llm:${env.LLM_MODEL}`) : "extractive",
      llmConfigured,
    },
  });
});

app.get("/api/img", async (c) => {
  const f = c.req.query("f");
  if (!f || !/^[A-Za-z0-9_ .()'+\-]+\.(png|jpe?g|webp|gif)$/i.test(f)) {
    throw new HTTPException(400, { message: "nombre de imagen inválido" });
  }
  const safe = basename(f).replace(/\.{2,}/g, ".");
  const cachePath = join(IMG_CACHE, safe);
  try {
    if (!existsSync(cachePath)) {
      mkdirSync(dirname(cachePath), { recursive: true });
      const buf = await fetchWikiImage(safe);
      writeFileSync(cachePath, buf);
    }
    const data = readFileSync(cachePath);
    const ext = safe.split(".").pop()?.toLowerCase() ?? "png";
    const ct = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(data, 200, { "content-type": ct });
  } catch (err) {
    console.warn("[img] fallo al obtener", safe, ":", (err as Error).message);
    throw new HTTPException(502, { message: "no se pudo obtener la imagen" });
  }
});

app.get("/api/search", (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) throw new HTTPException(400, { message: "falta el parámetro ?q=" });
  const limit = Math.min(Number(c.req.query("limit") ?? 8), 30) || 8;
  const hits = retrieve(q, limit).map(({ title, url, sourceType, score, tags }) => ({
    title,
    url,
    sourceType,
    score: Math.round(score * 100) / 100,
    tags,
  }));
  return c.json({ query: q, results: hits, count: hits.length });
});

app.post("/api/chat", zValidator("json", chatSchema), async (c) => {
  const body = c.req.valid("json");
  const messages = body.messages;
  const query = (messages[messages.length - 1] as { content: string }).content;

  const history = messages
    .slice(0, -1)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const result = await answerQuestion(query, history, body.topK, { images: body.images, profile: body.profile });

  saveChat([
    ...messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "assistant", content: result.answer, mode: result.mode },
  ]);

  return c.json({
    answer: result.answer,
    mode: result.mode,
    sources: result.sources.map((s) => ({ title: s.title, url: s.url, sourceType: s.sourceType })),
    retrievedCount: result.retrievedCount,
    entities: result.entities,
  });
});

// Acciones de ingesta on-demand (red local / admin)
app.post("/api/ingest/seed", async (c) => {
  const s = loadSeed();
  return c.json({ ok: true, seeded: s });
});

app.post("/api/ingest/wiki", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { terms?: string[]; all?: boolean; max?: number };
  if (body.all) {
    const s = await ingestWikiAll({ maxPages: body.max });
    return c.json({ ok: true, all: true, ...s });
  }
  const terms = body.terms?.length
    ? body.terms
    : ["ninivix", "free to play", "professions", "crafting"];
  const s = await ingestWikiTerms(terms);
  return c.json({ ok: true, ...s, terms });
});

app.post("/api/ingest/encyclopedia", async (c) => {
  const s = await ingestEncyclopedia();
  return c.json({ ok: true, ...s });
});

// Ingesta estructurada completa desde la base Cargo de la wiki (TODO: items,
// recetas, monstruos, hechizos, quests, mazmorras…)
app.post("/api/ingest/cargo", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { max?: number; topics?: string[] };
  if (body.topics?.length) {
    const out: Array<{ topic: string; rows: number }> = [];
    let rows = 0;
    let chunks = 0;
    for (const t of body.topics) {
      const r = await ingestCargoTopic(t, { max: body.max ?? 0 });
      out.push({ topic: r.topic, rows: r.rows });
      rows += r.rows;
      chunks += r.chunks;
    }
    return c.json({ ok: true, topics: out, rows, chunks });
  }
  const s = await ingestCargoAll({ max: body.max ?? 0 });
  return c.json({ ok: true, ...s });
});

/* ------------------------------------------------------------------ */
/* Estáticos (frontend Astro) y fallback SPA                           */
/* ------------------------------------------------------------------ */

if (frontendDist) {
  app.use("*", serveStatic({ root: frontendDist }));
  app.notFound(async (c) => {
    if (!c.req.path.startsWith("/api")) {
      const idx = join(frontendDist, "index.html");
      if (existsSync(idx)) return c.html(readFileSync(idx, "utf8"));
    }
    return c.json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } }, 404);
  });
} else {
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Ruta no encontrada. Construye el frontend (npm run build -w frontend) para servir la UI.",
        },
      },
      404,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Error handler global                                                */
/* ------------------------------------------------------------------ */

app.onError((err, c) => {
  if (err instanceof z.ZodError) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Datos inválidos.",
          details: err.issues.map((i) => ({ field: i.path.join("."), issue: i.message })),
        },
      },
      400,
    );
  }
  if (err instanceof HTTPException) {
    return c.json(
      {
        error: {
          code: err.status === 429 ? "RATE_LIMITED" : err.status === 400 ? "BAD_REQUEST" : "HTTP_ERROR",
          message: err.message,
        },
      },
      err.status,
    );
  }
  console.error(`[${c.get("requestId")}]`, err);
  return c.json({ error: { code: "INTERNAL", message: "Error interno" } }, 500);
});

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[wakfu-coach] API en http://0.0.0.0:${info.port}${frontendDist ? " · UI servida desde " + frontendDist : ""}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
