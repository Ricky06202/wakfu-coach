import { replaceItemChunk, replaceRecipeChunk, slugify, upsertItem, upsertRecipe } from "./common.js";
import type { SeedItem, SeedRecipe } from "../seed-data.js";
import { raw } from "../db.js";

/**
 * Ingesta ESTRUCTURADA desde la base Cargo de wakfu.wiki.gg.
 *
 * Las stats de los items NO están en el wikitexto: viven en las tablas Cargo
 * de la wiki (Items, Recipes) con TODOS los items (~5.500) y columnas por stat
 * (fireMastery, initiative, armorGiven…). Consultarlas por API da datos exactos
 * y completos, mucho mejor que parsear texto.
 *
 * Endpoint: action=cargoquery · paginación por offset (máx 500/lote).
 */

const WIKI_API = "https://wakfu.wiki.gg/api.php";
const USER_AGENT = "wakfu-coach/1.0 (ingesta cargo; contacto: ricardosanjurg@gmail.com)";
const RATE_LIMIT_MS = 250;
const BATCH = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- utilidades ----------------------------- */

function cleanText(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#3[49];/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&#91;/g, "[")
    .replace(/&#93;/g, "]")
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[{}#@|^\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isJunkName(name: string): boolean {
  if (!name || name.length < 3) return true;
  if (!/^[\p{L}\p{N}]/u.test(name)) return true;
  if (/["!@#%^&*()=+]/u.test(name.slice(0, 2))) return true;
  return false;
}

async function cargoQuery(tables: string, fields: string, where: string | undefined, limit: number, offset: number): Promise<Array<Record<string, string>>> {
  const params: Record<string, string> = {
    action: "cargoquery",
    tables,
    fields,
    limit: String(limit),
    offset: String(offset),
    format: "json",
  };
  if (where) params.where = where;
  const url = new URL(WIKI_API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`cargo HTTP ${res.status}`);
  const data = (await res.json()) as { cargoquery?: Array<{ title: Record<string, string> }>; error?: { info?: string } };
  if (data.error?.info) throw new Error(`cargo error: ${data.error.info.slice(0, 200)}`);
  return (data.cargoquery ?? []).map((r) => r.title);
}

/* --------------------------- mapping de stats --------------------------- */

/** Nombre de columna Cargo -> etiqueta en español para la tarjeta. */
const STAT_LABELS: Record<string, string> = {
  hp: "PV",
  ap: "PA",
  mp: "PM",
  wp: "PW",
  criticalHit: "Crítico",
  block: "Bloqueo",
  initiative: "Iniciativa",
  dodge: "Esquiva",
  control: "Control",
  fow: "Percepción (FOW)",
  equiprange: "Rango del equipo",
  equiplock: "Bloqueo del equipo",
  healingMastery: "Dominio Curación",
  berserkMastery: "Dominio Berserk",
  meleeMastery: "Dominio Cuerpo a cuerpo",
  distanceMastery: "Dominio Distancia",
  critMastery: "Dominio Crítico",
  rearMastery: "Dominio Espalda",
  critResist: "Resist. Crítico",
  rearResist: "Resist. Espalda",
  armorGiven: "Armadura otorgada",
  armorReceived: "Armadura recibida",
  elementalMastery: "Dominio elemental",
  relementalMastery: "Dominio Rel. elemental",
  qelementalMastery: "Dominio Q. elemental",
  elementalResist: "Resist. elemental",
  relementalResist: "Resist. Rel. elemental",
  qelementalResist: "Resist. Q. elemental",
  fireMastery: "Dominio Fuego",
  waterMastery: "Dominio Agua",
  earthMastery: "Dominio Tierra",
  airMastery: "Dominio Aire",
  fireResist: "Resist. Fuego",
  waterResist: "Resist. Agua",
  earthResist: "Resist. Tierra",
  airResist: "Resist. Aire",
};

const ITEM_FIELDS = [
  "_pageName=page",
  "name",
  "level",
  "rarity",
  "type",
  "image",
  "description",
  "hp",
  "ap",
  "mp",
  "wp",
  "criticalHit",
  "block",
  "initiative",
  "dodge",
  "control",
  "fow",
  "equiprange",
  "equiplock",
  "healingMastery",
  "berserkMastery",
  "meleeMastery",
  "distanceMastery",
  "critMastery",
  "rearMastery",
  "critResist",
  "rearResist",
  "armorGiven",
  "armorReceived",
  "elementalMastery",
  "relementalMastery",
  "qelementalMastery",
  "elementalResist",
  "relementalResist",
  "qelementalResist",
  "fireMastery",
  "waterMastery",
  "earthMastery",
  "airMastery",
  "fireResist",
  "waterResist",
  "earthResist",
  "airResist",
].join(",");

/** Tipo Cargo (inglés) -> taxonomía propia para icono/tarjeta. */
function mapType(cargoType: string): { type: string; category: string } {
  const t = (cargoType ?? "").toLowerCase();
  const weapons = ["axe", "sword", "dagger", "bow", "staff", "wand", "chakram", "hammer", "pickaxe", "scythe", "blade", "spear", "rapier", "gun", "shovel"];
  const armors = ["breastplate", "boots", "belt", "cape", "cloak", "helmet", "hat", "shield", "ring", "amulet", "necklace", "gloves", "gauntlet", "shoulders", "epaulettes"];
  const consumables = ["potion", "food", "drink", "consumable", "scroll", "book", "tome", "recipe"];
  const resources = ["resource", "ore", "wood", "plant", "ingredient", "material", "component"];
  if (weapons.some((w) => t.includes(w))) return { type: "weapon", category: cargoType };
  if (armors.some((a) => t.includes(a))) return { type: "armor", category: cargoType };
  if (consumables.some((c) => t.includes(c))) return { type: "consumable", category: cargoType };
  if (t.includes("pet")) return { type: "pet", category: cargoType };
  if (t.includes("mount")) return { type: "mount", category: cargoType };
  if (resources.some((r) => t.includes(r))) return { type: "resource", category: cargoType };
  return { type: "miscellaneous", category: cargoType };
}

function mapRarity(r: string): string {
  const k = (r ?? "").toLowerCase();
  if (k.includes("legend")) return "legendario";
  if (k.includes("myth")) return "mítico";
  if (k.includes("epic")) return "épico";
  if (k.includes("rare")) return "raro";
  if (k.includes("relic")) return "reliquia";
  return "común";
}

function rowToSeedItem(row: Record<string, string>): SeedItem | null {
  const name = cleanText(row.name ?? "");
  if (isJunkName(name)) return null;
  const { type, category } = mapType(row.type ?? "");
  const effects: { label: string; value: string }[] = [];
  for (const [col, label] of Object.entries(STAT_LABELS)) {
    const v = (row[col] ?? "").trim();
    if (v && v !== "0") effects.push({ label, value: v });
  }
  const description = cleanText(row.description ?? "");
  const image = (row.image ?? "").trim();
  return {
    name,
    level: Number(row.level) || 1,
    type,
    category,
    rarity: mapRarity(row.rarity ?? ""),
    description: description && !/^[#@\[\]|^]*$/.test(description) ? description : undefined,
    effects,
    imageUrl: image && !isJunkName(image) ? `https://wakfu.wiki.gg/wiki/Special:FilePath/${encodeURIComponent(image)}` : null,
    url: `https://wakfu.wiki.gg/wiki/${encodeURIComponent((row.page ?? name).replace(/ /g, "_"))}`,
  };
}

/* ------------------------------ ingesta ------------------------------ */

export interface CargoSummary {
  items: number;
  recipes: number;
  chunks: number;
}

/** Ingiere todos los items estructurados de la tabla Cargo Items. */
export async function ingestCargoItems(opts: { max?: number; onProgress?: (done: number) => void } = {}): Promise<{ items: number; chunks: number }> {
  let offset = 0;
  let itemsN = 0;
  let chunksN = 0;
  const max = opts.max ?? 0;

  while (true) {
    if (max > 0 && itemsN >= max) break;
    const batch = await cargoQuery("Items", ITEM_FIELDS, undefined, BATCH, offset);
    if (!batch.length) break;
    for (const row of batch) {
      if (max > 0 && itemsN >= max) break;
      const item = rowToSeedItem(row);
      if (!item) continue;
      try {
        const id = upsertItem(item);
        replaceItemChunk(id, item);
        itemsN++;
        chunksN++;
      } catch (err) {
        console.warn(`[cargo] error con "${item.name}":`, (err as Error).message);
      }
    }
    console.log(`[cargo] items: ${itemsN} procesados (offset ${offset})`);
    opts.onProgress?.(itemsN);
    if (batch.length < BATCH) break;
    offset += BATCH;
    await sleep(RATE_LIMIT_MS);
  }
  return { items: itemsN, chunks: chunksN };
}

const RECIPE_FIELDS = ["name", "profession", "level", "ing1", "ing1q", "ing2", "ing2q", "ing3", "ing3q", "ing4", "ing4q", "ing5", "ing5q", "ing6", "ing6q", "ing7", "ing7q", "ing8", "ing8q", "quantity"].join(",");

/** Ingiere todas las recetas de la tabla Cargo Recipes. */
export async function ingestCargoRecipes(opts: { max?: number; onProgress?: (done: number) => void } = {}): Promise<{ recipes: number; chunks: number }> {
  let offset = 0;
  let recipesN = 0;
  let chunksN = 0;
  const max = opts.max ?? 0;

  while (true) {
    if (max > 0 && recipesN >= max) break;
    const batch = await cargoQuery("Recipes", RECIPE_FIELDS, undefined, BATCH, offset);
    if (!batch.length) break;
    for (const row of batch) {
      if (max > 0 && recipesN >= max) break;
      const name = cleanText(row.name ?? "");
      if (isJunkName(name)) continue;
      const ingredients: { name: string; quantity: number; isResource?: boolean }[] = [];
      for (let i = 1; i <= 8; i++) {
        const ing = cleanText(row[`ing${i}`] ?? "");
        if (!ing || isJunkName(ing)) continue;
        ingredients.push({ name: ing, quantity: Number(row[`ing${i}q`]) || 1 });
      }
      if (!ingredients.length) continue;
      const recipe: SeedRecipe = {
        itemName: name,
        profession: cleanText(row.profession ?? "oficio"),
        professionLevel: Number(row.level) || 1,
        yields: Number(row.quantity) || 1,
        ingredients,
        url: `https://wakfu.wiki.gg/wiki/${encodeURIComponent(name.replace(/ /g, "_"))}`,
      };
      try {
        const id = upsertRecipe(recipe);
        replaceRecipeChunk(id, recipe);
        recipesN++;
        chunksN++;
      } catch (err) {
        console.warn(`[cargo] error con receta "${name}":`, (err as Error).message);
      }
    }
    console.log(`[cargo] recetas: ${recipesN} procesadas (offset ${offset})`);
    opts.onProgress?.(recipesN);
    if (batch.length < BATCH) break;
    offset += BATCH;
    await sleep(RATE_LIMIT_MS);
  }
  return { recipes: recipesN, chunks: chunksN };
}

/** Ingiesta completa de Cargo (items + recetas). */
export async function ingestCargo(opts: { max?: number } = {}): Promise<CargoSummary> {
  const items = await ingestCargoItems({ max: opts.max });
  const recipes = await ingestCargoRecipes({ max: opts.max });
  void raw; // (import para mantener el módulo de db vivo)
  return { items: items.items, recipes: recipes.recipes, chunks: items.chunks + recipes.chunks };
}
