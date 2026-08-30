import { raw } from "../db.js";
import { seedGuides, seedItems, seedRecipes } from "../seed-data.js";
import {
  replaceGuideChunks,
  replaceItemChunk,
  replaceRecipeChunk,
  upsertGuide,
  upsertItem,
  upsertRecipe,
} from "./common.js";

export interface SeedSummary {
  guides: number;
  items: number;
  recipes: number;
  chunks: number;
}

/** Carga el dataset de muestra de forma idempotente (upsert por slug/nombre). */
export function loadSeed(): SeedSummary {
  const before = countRawChunks();

  let guidesN = 0;
  for (const g of seedGuides) {
    const id = upsertGuide(g);
    replaceGuideChunks(id, g);
    guidesN++;
  }

  let itemsN = 0;
  for (const it of seedItems) {
    const id = upsertItem(it);
    replaceItemChunk(id, it);
    itemsN++;
  }

  let recipesN = 0;
  for (const r of seedRecipes) {
    const id = upsertRecipe(r);
    replaceRecipeChunk(id, r);
    recipesN++;
  }

  const after = countRawChunks();
  return { guides: guidesN, items: itemsN, recipes: recipesN, chunks: after - before };
}

function countRawChunks(): number {
  const row = raw.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number };
  return row.n;
}
