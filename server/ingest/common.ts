import { and, eq } from "drizzle-orm";
import { db, raw, normalizeName } from "../db.js";
import { chunks, guides, items, recipes } from "../db.js";
import type { SeedGuide, SeedItem, SeedRecipe } from "../seed-data.js";

export const now = () => new Date();

/** Divide contenido markdown en fragmentos por secciones `## `. */
export function chunkText(title: string, content: string, tags: string[], url: string | null) {
  const out: Array<{ title: string; content: string; tags: string[]; url: string | null }> = [];
  const parts = content.split(/^##\s+/gm);
  parts.forEach((part, i) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    if (i === 0) {
      out.push({ title: `${title} (resumen)`, content: trimmed.slice(0, 600), tags, url });
      return;
    }
    const [rawHeading, ...bodyLines] = trimmed.split("\n");
    const heading = rawHeading?.trim() ?? "";
    const body = bodyLines.join("\n").trim();
    if (!body) return;
    out.push({ title: `${title} — ${heading}`, content: `${heading}\n\n${body}`, tags, url });
  });
  return out.length ? out : [{ title, content, tags, url }];
}

/* ------------------------------- Guides ------------------------------- */

export function upsertGuide(g: SeedGuide): number {
  const existing = db.select({ id: guides.id }).from(guides).where(eq(guides.slug, slugify(g.title))).get();
  const payload = {
    title: g.title,
    slug: slugify(g.title),
    url: g.url,
    content: g.content,
    summary: g.summary,
    tags: JSON.stringify(g.tags),
    source: "wiki",
    createdAt: now(),
  };
  if (existing) {
    db.update(guides).set({ ...payload, lastUpdated: new Date().toISOString() }).where(eq(guides.id, existing.id)).run();
    return existing.id;
  }
  return Number(db.insert(guides).values(payload).run().lastInsertRowid);
}

export function replaceGuideChunks(guideId: number, g: SeedGuide): void {
  raw.prepare("DELETE FROM chunks WHERE source_type = 'guide' AND source_id = ?").run(guideId);
  const chunksOut = chunkText(g.title, g.content, g.tags, g.url);
  for (const c of chunksOut) {
    db.insert(chunks)
      .values({
        sourceType: "guide",
        sourceId: guideId,
        title: c.title,
        content: c.content,
        tags: JSON.stringify(c.tags),
        weight: 1.0,
        url: c.url,
        createdAt: now(),
      })
      .run();
  }
}

/* ------------------------------- Items -------------------------------- */

export function upsertItem(it: SeedItem): number {
  const existing = db.select({ id: items.id }).from(items).where(eq(items.slug, slugify(it.name))).get();
  const payload = {
    name: it.name,
    nameNorm: normalizeName(it.name),
    slug: slugify(it.name),
    level: it.level,
    type: it.type,
    category: it.category ?? null,
    rarity: it.rarity,
    description: it.description ?? null,
    imageUrl: it.imageUrl ?? null,
    obtain: it.obtain ?? null,
    effects: JSON.stringify(it.effects),
    url: it.url,
    source: "seed",
    updatedAt: now(),
  };
  if (existing) {
    db.update(items).set(payload).where(eq(items.id, existing.id)).run();
    return existing.id;
  }
  return Number(db.insert(items).values({ ...payload, createdAt: now() }).run().lastInsertRowid);
}

export function replaceItemChunk(itemId: number, it: SeedItem): void {
  raw.prepare("DELETE FROM chunks WHERE source_type = 'item' AND source_id = ?").run(itemId);
  const effects = it.effects.map((e) => `- ${e.label}: ${e.value}`).join("\n");
  const content = [
    it.description ? `Descripción: ${it.description}` : null,
    `Nivel: ${it.level} · Tipo: ${it.type}${it.category ? ` (${it.category})` : ""} · Rareza: ${it.rarity}`,
    effects ? `Efectos:\n${effects}` : null,
    it.obtain ? `Cómo se consigue: ${it.obtain}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  db.insert(chunks)
    .values({
      sourceType: "item",
      sourceId: itemId,
      title: `Ficha: ${it.name}`,
      content,
      tags: JSON.stringify(["objeto", it.type, it.category ?? "", it.rarity].filter(Boolean)),
      weight: 1.0,
      url: it.url,
      createdAt: now(),
    })
    .run();
}

/* ------------------------------- Recetas ------------------------------ */

export function upsertRecipe(r: SeedRecipe): number {
  const match = db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.name, r.itemName))
    .get();
  const payload = {
    itemId: match?.id ?? null,
    itemName: r.itemName,
    itemNameNorm: normalizeName(r.itemName),
    profession: r.profession,
    professionLevel: r.professionLevel,
    yields: r.yields,
    ingredients: JSON.stringify(r.ingredients),
    cost: r.cost ?? null,
    url: r.url,
    source: "seed",
    createdAt: now(),
  };
  const existing = db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.itemName, r.itemName), eq(recipes.profession, r.profession)))
    .get();
  if (existing) {
    db.update(recipes).set(payload).where(eq(recipes.id, existing.id)).run();
    return existing.id;
  }
  return Number(db.insert(recipes).values(payload).run().lastInsertRowid);
}

export function replaceRecipeChunk(recipeId: number, r: SeedRecipe): void {
  raw.prepare("DELETE FROM chunks WHERE source_type = 'recipe' AND source_id = ?").run(recipeId);
  const ing = r.ingredients.map((i) => `- ${i.quantity}× ${i.name}`).join("\n");
  const content = [
    `Oficio: ${r.profession} (nivel ${r.professionLevel})`,
    `Produce: ${r.yields}× ${r.itemName}`,
    `Ingredientes:\n${ing}`,
    r.cost ? `Coste medio orientativo: ${r.cost} kamás` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  db.insert(chunks)
    .values({
      sourceType: "recipe",
      sourceId: recipeId,
      title: `Receta: ${r.itemName}`,
      content,
      tags: JSON.stringify(["receta", r.profession, "f2p"]),
      weight: 1.0,
      url: r.url,
      createdAt: now(),
    })
    .run();
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
