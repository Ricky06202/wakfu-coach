import { readFileSync } from "node:fs";
import { replaceItemChunk, slugify, upsertItem } from "./common.js";
import type { SeedItem } from "../seed-data.js";
import { raw } from "../db.js";

/**
 * Motor de ingesta para la Enciclopedia Oficial de Wakfu:
 *   https://www.wakfu.com/es/mmorpg/enciclopedia
 *
 * La enciclopedia es una SPA cuyo HTML/JS cambia con frecuencia. Por eso esta
 * ingesta es BEST-EFFORT y soporta tres fuentes de datos:
 *
 *  1. `--json <path|url>` : carga fichas desde un feed JSON local o remoto
 *     (el mismo shape que SeedItem, en un array bajo la clave "items").
 *  2. Escaneo del HTML de las páginas de listado buscando enlaces a fichas.
 *  3. Si nada responde, avisa al usuario para que use la Wiki (recomendada).
 */

const ENCYC_BASE = "https://www.wakfu.com/es/mmorpg/enciclopedia";
const USER_AGENT = "wakfu-coach/1.0 (asistente personal RAG)";

function normalizeWakfuItem(rawItem: Record<string, unknown>): SeedItem {
  return {
    name: String(rawItem.name ?? rawItem.nom ?? "Objeto desconocido"),
    level: Number(rawItem.level ?? 1),
    type: String(rawItem.type ?? rawItem.tipo ?? "miscellaneous"),
    category: rawItem.category ? String(rawItem.category) : undefined,
    rarity: String(rawItem.rarity ?? "común"),
    description: rawItem.description ? String(rawItem.description) : undefined,
    effects: Array.isArray(rawItem.effects)
      ? (rawItem.effects as { label: string; value: string }[])
      : [],
    obtain: rawItem.obtain ? String(rawItem.obtain) : undefined,
    imageUrl: rawItem.imageUrl ?? rawItem.image ?? rawItem.icon ? String(rawItem.imageUrl ?? rawItem.image ?? rawItem.icon) : null,
    url: rawItem.url ? String(rawItem.url) : ENCYC_BASE,
  };
}

async function loadJsonFeed(feed: string): Promise<SeedItem[]> {
  const data = feed.startsWith("http")
    ? await (await fetch(feed, { headers: { "User-Agent": USER_AGENT } })).json()
    : JSON.parse(readFileSync(feed, "utf8"));
  const list = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(list)) throw new Error(`feed JSON sin clave "items" o sin array raíz`);
  return list.map(normalizeWakfuItem);
}

/** Escaneo HTML best-effort: extrae enlaces a fichas del listado. */
async function scanHtmlListings(): Promise<SeedItem[]> {
  const res = await fetch(ENCYC_BASE, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`enciclopedia HTTP ${res.status}`);
  const html = await res.text();

  const found: SeedItem[] = [];
  const linkRe = /href=["']([^"']*enciclopedia[^"']*?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && found.length < 40) {
    const url = m[1] as string;
    const inner = m[2] as string;
    const name = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const imgMatch = inner.match(/<img[^>]+src=["']([^"']+)["']/i);
    const imageUrl = imgMatch ? (imgMatch[1] as string) : null;
    if (!name || name.length < 3 || name.toLowerCase().includes("enciclopedia")) continue;
    found.push({
      name,
      level: 1,
      type: "miscellaneous",
      rarity: "común",
      effects: [],
      imageUrl: imageUrl && imageUrl.startsWith("http") ? imageUrl : imageUrl ? new URL(imageUrl, ENCYC_BASE).href : null,
      url: url.startsWith("http") ? url : new URL(url, ENCYC_BASE).href,
    });
  }

  // Heurística: si el HTML embebe un objeto JSON con el estado de la app,
  // intenta extraer nombres/ids de objetos.
  const stateMatch = html.match(/window\.__.*?=(\{[\s\S]{200,200000}?\});?\s*<\/script>/i);
  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch[1] as string);
      const walk = (node: unknown, depth = 0): void => {
        if (depth > 6 || !node || typeof node !== "object") return;
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (/^(name|nom|label)$/i.test(k) && typeof v === "string" && v.length >= 3 && v.length <= 60) {
            const name = v as string;
            if (!found.some((f) => f.name === name)) {
              found.push({ name, level: 1, type: "miscellaneous", rarity: "común", effects: [], url: ENCYC_BASE });
            }
          } else if (v && typeof v === "object") {
            walk(v, depth + 1);
          }
        }
      };
      walk(state);
    } catch {
      /* el estado embebido no es parseable; seguir */
    }
  }

  // Dedupe por slug manteniendo el primero
  const seen = new Set<string>();
  return found.filter((f) => (seen.has(slugify(f.name)) ? false : (seen.add(slugify(f.name)), true)));
}

export interface EncycSummary {
  items: number;
  chunks: number;
  message?: string;
}

/** Ingesta desde la enciclopedia oficial. `jsonFeed` opcional (path o URL). */
export async function ingestEncyclopedia(jsonFeed?: string): Promise<EncycSummary> {
  let items: SeedItem[] = [];
  let message: string | undefined;

  if (jsonFeed) {
    items = await loadJsonFeed(jsonFeed);
    console.log(`[enciclopedia] ${items.length} fichas desde feed JSON`);
  } else {
    try {
      items = await scanHtmlListings();
      console.log(`[enciclopedia] ${items.length} fichas desde escaneo HTML`);
    } catch (err) {
      message = (err as Error).message;
      console.warn(`[enciclopedia] escaneo HTML falló: ${message}`);
    }
  }

  if (!items.length) {
    const hint = jsonFeed
      ? "el feed no devolvió fichas."
      : message
        ? `el sitio respondió un error (${message}). La enciclopedia de wakfu.com usa CloudFront y suele bloquear peticiones de servidores (403).`
        : "la SPA no expone fichas en su HTML.";
    console.warn(
      `[enciclopedia] no se pudo extraer contenido (${hint}). ` +
        "Usa `--wiki` (wakfu.wiki.gg, API MediaWiki estable) o `--encyclopedia --json <feed>` con un feed propio.",
    );
    return { items: 0, chunks: 0, message: hint };
  }

  let chunksN = 0;
  let itemsN = 0;
  for (const it of items) {
    try {
      const id = upsertItem(it);
      replaceItemChunk(id, it);
      itemsN++;
      const row = raw.prepare("SELECT COUNT(*) AS n FROM chunks WHERE source_type='item' AND source_id=?").get(id) as { n: number };
      chunksN += row.n;
    } catch (err) {
      console.warn(`[enciclopedia] error con "${it.name}":`, (err as Error).message);
    }
  }
  return { items: itemsN, chunks: chunksN, message };
}
