import { replaceGuideChunks, slugify, upsertGuide } from "./common.js";
import type { SeedGuide } from "../seed-data.js";
import { env } from "../env.js";
import { raw } from "../db.js";

const WIKI_API = "https://wakfu.wiki.gg/api.php";
const USER_AGENT = "wakfu-coach/1.0 (asistente personal RAG; contacto: ricardosanjurg@gmail.com)";
const RATE_LIMIT_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(params: Record<string, string>): Promise<any> {
  const url = new URL(WIKI_API);
  for (const [k, v] of Object.entries({ format: "json", formatversion: "2", ...params })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`wiki.gg API HTTP ${res.status}`);
  return res.json();
}

/** Búsqueda de páginas en la wiki (MediaWiki list=search). */
export async function searchPages(term: string, limit = 8): Promise<string[]> {
  const data = await api({ action: "query", list: "search", srsearch: term, srlimit: String(limit) });
  return (data?.query?.search ?? []).map((s: { title: string }) => s.title);
}

/** Obtiene el wikitext de una página. */
export async function fetchWikitext(title: string): Promise<{ title: string; wikitext: string } | null> {
  const data = await api({ action: "parse", page: title, prop: "wikitext" });
  const page = data?.parse;
  if (!page) return null;
  return { title: page.title ?? title, wikitext: page.wikitext ?? "" };
}

/**
 * Itera TODAS las páginas de la wiki (ns0, sin redirects) vía `allpages`,
 * paginando con `apcontinue`, en streaming (no carga todo en memoria).
 * Descarta stubs y subpáginas de variantes. `maxPages` 0 = sin límite.
 */
async function* iterateAllPages(maxPages: number): AsyncGenerator<string> {
  let apcontinue: string | undefined;
  let collected = 0;
  while (maxPages === 0 || collected < maxPages) {
    const params: Record<string, string> = {
      action: "query",
      list: "allpages",
      apnamespace: "0",
      apfilterredir: "nonredirects",
      aplimit: "500",
    };
    if (apcontinue) params.apcontinue = apcontinue;
    const data = await api(params);
    const pages: Array<{ title: string }> = data?.query?.allpages ?? [];
    for (const p of pages) {
      const t = p.title;
      if (t.includes("/")) continue; // variantes tipo "Item/Legendary"
      if (t.length < 4) continue; // stubs
      if (!/^[\p{L}\p{N}]/u.test(t)) continue; // stubs que empiezan con comillas/símbolos
      yield t;
      collected++;
      if (maxPages !== 0 && collected >= maxPages) return;
    }
    apcontinue = data?.continue?.apcontinue;
    if (!apcontinue) break;
    await sleep(150);
  }
}

/** Convierte wikitext de MediaWiki a markdown plano consumible por el RAG. */
export function stripWikitext(src: string): string {
  let s = src;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<ref[\s\S]*?<\/ref>/gi, " ");
  s = s.replace(/<nowiki[\s\S]*?<\/nowiki>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");

  // Tablas MediaWiki: elimina bloques {| ... |}
  s = s.replace(/\{\|\s*/g, "\u0000TABLE").replace(/\|\}\s*/g, "\u0000ENDTABLE");
  s = s
    .split("\u0000ENDTABLE")
    .map((part) => {
      const idx = part.lastIndexOf("\u0000TABLE");
      return idx >= 0 ? part.slice(0, idx) : part;
    })
    .join("\n");
  s = s.replace(/\u0000TABLE/g, "");

  // Plantillas {{...}} (tolera anidamiento simple)
  let guard = 0;
  while (s.includes("{{") && guard++ < 12) {
    s = s.replace(/\{\{[^{}]*\}\}/g, " ");
  }
  s = s.replace(/\{\{[\s\S]*?\}\}/g, " ");

  // Enlaces [[Destino|Texto]] -> Texto · [[Destino]] -> Destino
  s = s.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1");
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // Headings MediaWiki -> markdown
  s = s.replace(/^====?\s*(.+?)\s*====?\s*$/gm, "### $1");
  s = s.replace(/^===\s*(.+?)\s*===\s*$/gm, "### $1");
  s = s.replace(/^==\s*(.+?)\s*==\s*$/gm, "## $1");

  // Énfasis y negritas
  s = s.replace(/'{5}(.+?)'{5}/g, "$1");
  s = s.replace(/'{3}(.+?)'{3}/g, "**$1**");
  s = s.replace(/''(.+?)''/g, "*$1*");

  // Líneas de lista y limpieza final
  s = s
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => !/^\s*[|}]/.test(l))
    .filter((l) => !/^\[\[(Categor|Category):/i.test(l))
    .filter((l) => !/^__/.test(l))
    .join("\n");

  return s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface WikiSummary {
  pages: number;
  guides: number;
  chunks: number;
}

/** Ingiere una página y la guarda como guía + fragmentos. Devuelve el id de la guía. */
async function ingestPage(title: string, extraTags: string[]): Promise<number | null> {
  const page = await fetchWikitext(title);
  if (!page) {
    console.warn(`[wiki] página "${title}" no disponible`);
    return null;
  }
  const content = stripWikitext(page.wikitext).slice(0, 60_000);
  if (content.length < 80) {
    console.warn(`[wiki] "${title}" sin contenido útil (${content.length} chars)`);
    return null;
  }
  const guide: SeedGuide = {
    title: page.title,
    url: `https://wakfu.wiki.gg/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    tags: [...extraTags, ...tagFromTitle(page.title)],
    summary: content.slice(0, 200),
    content,
  };
  const id = upsertGuide(guide);
  replaceGuideChunks(id, guide);
  return id;
}

function countGuideChunks(guideId: number): number {
  const row = raw
    .prepare("SELECT COUNT(*) AS n FROM chunks WHERE source_type='guide' AND source_id=?")
    .get(guideId) as { n: number };
  return row.n;
}

/**
 * Ingesta páginas de wakfu.wiki.gg para los términos indicados.
 * Cada página se guarda como guía + fragmentos (chunks) por sección.
 */
export async function ingestWikiTerms(terms: string[], opts: { perTerm?: number } = {}): Promise<WikiSummary> {
  const perTerm = opts.perTerm ?? 3;
  const summary: WikiSummary = { pages: 0, guides: 0, chunks: 0 };

  for (const term of terms) {
    let titles: string[] = [];
    try {
      titles = await searchPages(term, perTerm * 3);
    } catch (err) {
      console.warn(`[wiki] búsqueda falló para "${term}":`, (err as Error).message);
      continue;
    }

    // Prefiere coincidencia exacta; rellena con los primeros resultados.
    const exact = titles.find((t) => slugify(t) === slugify(term));
    const chosen = (exact ? [exact, ...titles.filter((t) => t !== exact)] : titles).slice(0, perTerm);

    for (const title of chosen) {
      try {
        const id = await ingestPage(title, [slugify(term)]);
        if (id) {
          summary.pages++;
          summary.guides++;
          summary.chunks += countGuideChunks(id);
        }
        await sleep(RATE_LIMIT_MS);
      } catch (err) {
        console.warn(`[wiki] error con "${title}":`, (err as Error).message);
      }
    }
  }
  return summary;
}

/**
 * Ingesta MASIVA: recorre TODAS las páginas de la wiki en streaming y las
 * procesa. Sin límite por defecto (maxPages 0 = toda la wiki, tarda horas).
 * Se puede acotar con `maxPages`/env INGEST_MAX_PAGES/CLI --max.
 * Progreso persistente: cada página se guarda en la base al momento.
 */
export async function ingestWikiAll(opts: { maxPages?: number; logProgress?: (done: number) => void } = {}): Promise<WikiSummary> {
  const maxPages = opts.maxPages ?? (env.INGEST_MAX_PAGES > 0 ? env.INGEST_MAX_PAGES : 0);
  const summary: WikiSummary = { pages: 0, guides: 0, chunks: 0 };
  console.log(`[wiki] ingesta masiva ${maxPages === 0 ? "SIN LÍMITE (toda la wiki, puede tardar horas)" : `máx ${maxPages} páginas`}`);

  let total = 0;
  let lastLog = Date.now();
  for await (const title of iterateAllPages(maxPages)) {
    total++;
    try {
      const id = await ingestPage(title, ["wiki"]);
      if (id) {
        summary.pages++;
        summary.guides++;
        summary.chunks += countGuideChunks(id);
      }
    } catch (err) {
      console.warn(`[wiki] error con "${title}":`, (err as Error).message);
    }
    if (total % 100 === 0 || (Date.now() - lastLog > 30_000 && total % 10 === 0)) {
      console.log(`[wiki] progreso: ${total} títulos procesados (${summary.guides} guías) · chunks=${summary.chunks}`);
      opts.logProgress?.(total);
      lastLog = Date.now();
    }
    await sleep(RATE_LIMIT_MS);
  }
  console.log(`[wiki] fin: ${total} títulos procesados · guías=${summary.guides} chunks=${summary.chunks}`);
  return summary;
}

function tagFromTitle(title: string): string[] {
  const t = slugify(title);
  if (t.includes("ninivix")) return ["ninivix", "clase"];
  if (t.includes("receta") || t.includes("craft") || t.includes("oficio") || t.includes("profession")) return ["receta", "oficio", "crafting"];
  if (t.includes("f2p") || t.includes("free")) return ["f2p"];
  if (t.includes("item") || t.includes("equipment") || t.includes("weapon") || t.includes("armor")) return ["objeto", "equipo"];
  return [t];
}
