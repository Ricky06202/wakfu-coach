import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "./env.js";

/* ------------------------------------------------------------------ */
/* Esquema Drizzle (ORM)                                              */
/* ------------------------------------------------------------------ */

/** Fichas técnicas de la Enciclopedia Oficial (wakfu.com/es/mmorpg/enciclopedia). */
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nameNorm: text("name_norm"),
  slug: text("slug").notNull().unique(),
  level: integer("level").notNull().default(1),
  type: text("type").notNull(), // weapon | armor | consumable | resource | pet | mount | miscellaneous
  category: text("category"), // subcategoría (p.ej. «varita», «botas», «ofrenda»)
  rarity: text("rarity").default("común"), // común | raro | épico | legendario
  description: text("description"),
  imageUrl: text("image_url"),
  obtain: text("obtain"), // cómo se consigue (fabricación, NPC, drop, mazmorra…)
  effects: text("effects"), // JSON: [{ label, value }]
  url: text("url"),
  source: text("source").notNull().default("seed"), // seed | encyclopedia | wiki
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** Recetas de oficios (profesiones). */
export const recipes = sqliteTable("recipes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").references(() => items.id, { onDelete: "set null" }),
  itemName: text("item_name").notNull(),
  itemNameNorm: text("item_name_norm"),
  profession: text("profession").notNull(), // herrero, alquimista, zurrador, leñador, minero…
  professionLevel: integer("profession_level").notNull().default(1),
  yields: integer("yields").notNull().default(1),
  ingredients: text("ingredients").notNull(), // JSON: [{ name, quantity, isResource }]
  cost: integer("cost"), // kamás (mercado) orientativos
  url: text("url"),
  source: text("source").notNull().default("seed"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** Guías de la comunidad (Wiki Oficial wakfu.wiki.gg). */
export const guides = sqliteTable("guides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  url: text("url"),
  content: text("content").notNull(), // markdown/texto completo
  summary: text("summary"),
  tags: text("tags").notNull().default("[]"), // JSON array de tags (p.ej. ["ninivix","f2p"])
  source: text("source").notNull().default("wiki"),
  lastUpdated: text("last_updated"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/**
 * Fragmentos RAG. Cada fila es un "chunk" auto-contenido que se indexa en
 * FTS5 (chunks_fts) para búsqueda BM25. sourceType identifica el origen.
 */
export const chunks = sqliteTable("chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceType: text("source_type").notNull(), // item | recipe | guide
  sourceId: integer("source_id"), // id de la fila origen (opcional)
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").notNull().default("[]"),
  weight: real("weight").notNull().default(1.0), // prioridad manual
  url: text("url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** Historial de conversaciones (persistente). */
export const chats = sqliteTable("chats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messages: text("messages").notNull(), // JSON: [{ role, content, sources? }]
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/* ------------------------------------------------------------------ */
/* Cliente SQLite + Drizzle                                           */
/* ------------------------------------------------------------------ */

mkdirSync(dirname(env.DB_PATH), { recursive: true });

const sqlite = new Database(env.DB_PATH);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema: { items, recipes, guides, chunks, chats } });

/** Conexión cruda para queries FTS5/BM25 que Drizzle no expresa cómodamente. */
export const raw = sqlite;

/* ------------------------------------------------------------------ */
/* Inicialización idempotente de la base                              */
/* ------------------------------------------------------------------ */

export function initDb(): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_norm TEXT,
      slug TEXT NOT NULL UNIQUE,
      level INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL,
      category TEXT,
      rarity TEXT DEFAULT 'común',
      description TEXT,
      image_url TEXT,
      obtain TEXT,
      effects TEXT,
      url TEXT,
      source TEXT NOT NULL DEFAULT 'seed',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
      item_name TEXT NOT NULL,
      item_name_norm TEXT,
      profession TEXT NOT NULL,
      profession_level INTEGER NOT NULL DEFAULT 1,
      yields INTEGER NOT NULL DEFAULT 1,
      ingredients TEXT NOT NULL,
      cost INTEGER,
      url TEXT,
      source TEXT NOT NULL DEFAULT 'seed',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      url TEXT,
      content TEXT NOT NULL,
      summary TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'wiki',
      last_updated TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      weight REAL NOT NULL DEFAULT 1.0,
      url TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      messages TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      title,
      content='chunks',
      content_rowid='id'
    );

    -- Triggers de sincronización FTS5 (external content)
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, content, title) VALUES (new.id, new.content, new.title);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, content, title)
        VALUES ('delete', old.id, old.content, old.title);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, content, title)
        VALUES ('delete', old.id, old.content, old.title);
      INSERT INTO chunks_fts(rowid, content, title) VALUES (new.id, new.content, new.title);
    END;

    CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_items_level ON items(level);
    CREATE INDEX IF NOT EXISTS idx_items_name_norm ON items(name_norm);
    CREATE INDEX IF NOT EXISTS idx_recipes_item ON recipes(item_id);
    CREATE INDEX IF NOT EXISTS idx_recipes_name_norm ON recipes(item_name_norm);
    CREATE INDEX IF NOT EXISTS idx_guides_tags ON guides(tags);
  `);

  // Migración suave para bases creadas antes de las columnas normalizadas.
  addColumnIfMissing("items", "name_norm", "TEXT");
  addColumnIfMissing("recipes", "item_name_norm", "TEXT");
  backfillNameNorm();
}

function addColumnIfMissing(table: string, column: string, type: string): void {
  const cols = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** Rellena name_norm / item_name_norm para filas existentes (una sola vez). */
function backfillNameNorm(): void {
  const upItem = raw.prepare("UPDATE items SET name_norm = ? WHERE id = ?");
  const itemsRows = raw
    .prepare("SELECT id, name FROM items WHERE name_norm IS NULL OR name_norm = ''")
    .all() as Array<{ id: number; name: string }>;
  for (const r of itemsRows) upItem.run(normalizeName(r.name), r.id);

  const upRecipe = raw.prepare("UPDATE recipes SET item_name_norm = ? WHERE id = ?");
  const recipeRows = raw
    .prepare("SELECT id, item_name AS itemName FROM recipes WHERE item_name_norm IS NULL OR item_name_norm = ''")
    .all() as Array<{ id: number; itemName: string }>;
  for (const r of recipeRows) upRecipe.run(normalizeName(r.itemName), r.id);
}

export function chunkCount(): number {
  const row = raw.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number };
  return row.n;
}

/* ------------------------------------------------------------------ */
/* Tipos de fila para resultados de búsqueda                           */
/* ------------------------------------------------------------------ */

export interface ChunkRow {
  id: number;
  sourceType: string;
  sourceId: number | null;
  title: string;
  content: string;
  tags: string;
  weight: number;
  url: string | null;
  createdAt: number;
}

export type QueryMatch = ChunkRow & { score: number };

/** Escape de operadores FTS5: tokens limpios (sin acentos/acentos) unidos con OR. */
export function escapeFts(input: string): string {
  const tokens = normalize(input)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 12);
  return tokens.map((tok) => `"${tok}"*`).join(" OR ");
}

export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Búsqueda hibrida: FTS5 BM25 (OR de tokens, ranking de relevancia) + barrido léxico. */
export function searchChunks(query: string, limit: number): QueryMatch[] {
  const ftsQuery = escapeFts(query);
  const nq = normalize(query);
  const tokens = nq
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 8);

  const hits: QueryMatch[] = [];

  if (ftsQuery) {
    const rows = raw
      .prepare(
        `SELECT c.id, c.source_type AS sourceType, c.source_id AS sourceId,
                c.title, c.content, c.tags, c.weight, c.url,
                c.created_at AS createdAt, bm25(chunks_fts, 8.0, 1.0) AS fts_score
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ?
         ORDER BY fts_score LIMIT ?`,
      )
      .all(ftsQuery, limit * 3) as Array<ChunkRow & { fts_score: number }>;

    for (const r of rows) {
      hits.push({ ...r, score: -r.fts_score }); // bm25 negativo: mejor -> más cercano a 0
    }
  }

  // Barrido léxico token-a-token (OR) como red de seguridad para FTS/typos.
  const seen = new Set(hits.map((h) => h.id));
  if (tokens.length) {
    const where = tokens.map(() => "(instr(lower(c.title), ?) > 0 OR instr(lower(c.content), ?) > 0)").join(" OR ");
    const params: string[] = [];
    for (const t of tokens) params.push(t, t);
    const lexical = raw
      .prepare(
        `SELECT c.id, c.source_type AS sourceType, c.source_id AS sourceId,
                c.title, c.content, c.tags, c.weight, c.url,
                c.created_at AS createdAt, 0 AS fts_score
         FROM chunks c WHERE ${where} ORDER BY c.weight DESC LIMIT ?`,
      )
      .all(...params, limit * 3) as Array<ChunkRow & { fts_score: number }>;

    for (const r of lexical) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        hits.push({ ...r, score: r.weight });
      }
    }
  }

  // Scoring final: relevancia FTS + solape léxico + boost por tags.
  const scored = hits.map((h) => {
    const nc = normalize(`${h.title} ${h.content}`);
    let overlap = 0;
    for (const t of tokens) if (nc.includes(t)) overlap += 1;
    const overlapRatio = tokens.length ? overlap / tokens.length : 0;

    let tagBoost = 0;
    let tags: string[] = [];
    try {
      tags = JSON.parse(h.tags) as string[];
    } catch {
      /* tags corruptos -> ignorar */
    }
    const nTags = tags.map(normalize);
    for (const t of tokens) if (nTags.includes(t)) tagBoost += 0.6;

    return {
      ...h,
      score: h.score + overlapRatio * 1.2 + tagBoost + (h.weight - 1) * 0.5,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Lookup de entidades (objetos y recetas de los archivos oficiales)  */
/* ------------------------------------------------------------------ */

export interface ItemRow {
  id: number;
  name: string;
  slug: string;
  level: number;
  type: string;
  category: string | null;
  rarity: string;
  description: string | null;
  imageUrl: string | null;
  obtain: string | null;
  effects: string;
  url: string | null;
  source: string;
}

export interface RecipeRow {
  id: number;
  itemId: number | null;
  itemName: string;
  profession: string;
  professionLevel: number;
  yields: number;
  ingredients: string;
  cost: number | null;
  url: string | null;
  source: string;
}

/** Nombre normalizado (minúsculas, sin acentos, solo alfanumérico y espacios). */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameScore(name: string, token: string): number {
  const nn = normalizeName(name);
  if (nn === token) return 100;
  if (nn.startsWith(token)) return 80;
  if (nn.includes(token)) return 70 - Math.min(Math.max(nn.length - token.length, 0), 40);
  if (token.startsWith(nn) && nn.length >= 4) return 50;
  return 0;
}

/** Busca una ficha de objeto por nombre aproximado (coincidencia exacta primero). */
export function lookupItemByName(token: string): ItemRow | null {
  const nt = normalizeName(token);
  if (nt.length < 3) return null;
  const like = `%${nt}%`;
  const rows = raw
    .prepare(
      `SELECT id, name, slug, level, type, category, rarity, description,
              image_url AS imageUrl, obtain, effects, url, source
       FROM items WHERE name_norm LIKE ? LIMIT 20`,
    )
    .all(like) as ItemRow[];
  if (!rows.length) return null;

  let best: ItemRow | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const sc = nameScore(r.name, nt);
    if (sc > bestScore) {
      bestScore = sc;
      best = r;
    }
  }
  return bestScore >= 60 ? best : null;
}

/** Busca una receta por el nombre del objeto que produce. */
export function lookupRecipeByName(token: string): RecipeRow | null {
  const nt = normalizeName(token);
  if (nt.length < 3) return null;
  const like = `%${nt}%`;
  const rows = raw
    .prepare(
      `SELECT id, item_id AS itemId, item_name AS itemName, profession,
              profession_level AS professionLevel, yields, ingredients, cost, url, source
       FROM recipes WHERE item_name_norm LIKE ? LIMIT 20`,
    )
    .all(like) as RecipeRow[];
  if (!rows.length) return null;

  let best: RecipeRow | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const sc = nameScore(r.itemName, nt);
    if (sc > bestScore) {
      bestScore = sc;
      best = r;
    }
  }
  return bestScore >= 60 ? best : null;
}

/** Registro de una consulta/respuesta en el historial. */
export function saveChat(messages: unknown[]): number {
  const now = Date.now();
  const res = raw
    .prepare("INSERT INTO chats (messages, created_at, updated_at) VALUES (?, ?, ?)")
    .run(JSON.stringify(messages), now, now);
  return Number(res.lastInsertRowid);
}
