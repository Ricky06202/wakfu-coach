#!/usr/bin/env node
/**
 * CLI de ingesta para Wakfu Coach.
 *
 *   npm run ingest -- --seed
 *   npm run ingest -- --wiki ninivix "free to play"
 *   npm run ingest -- --encyclopedia [--json <path|url>]
 *   npm run ingest -- --wiki --encyclopedia --seed
 *
 * Uso en Docker:
 *   docker compose exec wakfu-coach node server/dist/ingest/index.js --wiki --encyclopedia
 */
import { initDb, raw } from "../db.js";
import { loadSeed } from "./seed.js";
import { ingestWikiAll, ingestWikiTerms } from "./wiki.js";
import { ingestEncyclopedia } from "./encyclopedia.js";
import { ingestCargo } from "./cargo.js";

const DEFAULT_WIKI_TERMS = ["ninivix", "free to play", "professions", "crafting", "wakfu f2p guide"];

interface CliArgs {
  seed: boolean;
  wiki: boolean;
  wikiAll: boolean;
  maxPages: number | undefined;
  wikiTerms: string[];
  encyclopedia: boolean;
  cargo: boolean;
  jsonFeed?: string;
  rebuildFts: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { seed: false, wiki: false, wikiAll: false, maxPages: undefined, wikiTerms: [], encyclopedia: false, cargo: false, rebuildFts: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    switch (a) {
      case "--seed":
        args.seed = true;
        break;
      case "--wiki":
        args.wiki = true;
        break;
      case "--all":
        args.wikiAll = true;
        break;
      case "--max":
        args.maxPages = Number(argv[++i]);
        break;
      case "--encyclopedia":
        args.encyclopedia = true;
        break;
      case "--cargo":
        args.cargo = true;
        break;
      case "--json":
        args.jsonFeed = argv[++i];
        break;
      case "--rebuild-fts":
        args.rebuildFts = true;
        break;
      default:
        if (args.wiki) args.wikiTerms.push(a);
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.seed && !args.wiki && !args.wikiAll && !args.encyclopedia && !args.cargo && !args.rebuildFts) {
    console.log(
      "Uso:\n  --seed                     dataset de muestra\n  --wiki [términos...]         guías específicas de wakfu.wiki.gg\n  --wiki --all [--max N]       ingesta masiva: TODA la wiki (tarda horas; --max 0 = sin límite)\n  --cargo [--max N]            items + recetas ESTRUCTURADOS (base Cargo de la wiki)\n  --encyclopedia [--json feed] Enciclopedia oficial\n  --rebuild-fts                reconstruir índice FTS5",
    );
    return;
  }

  initDb();

  if (args.rebuildFts) {
    raw.exec("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')");
    console.log("[fts] índice reconstruido");
  }

  if (args.seed) {
    const s = loadSeed();
    console.log(`[seed] guías=${s.guides} objetos=${s.items} recetas=${s.recipes} chunks=${s.chunks}`);
  }

  if (args.cargo) {
    const s = await ingestCargo({ max: args.maxPages ?? 0 });
    console.log(`[cargo] items=${s.items} recetas=${s.recipes} chunks=${s.chunks}`);
  }

  if (args.wikiAll) {
    const s = await ingestWikiAll({ maxPages: args.maxPages });
    console.log(`[wiki-all] páginas=${s.pages} guías=${s.guides} chunks=${s.chunks}`);
  } else if (args.wiki) {
    const terms = args.wikiTerms.length ? args.wikiTerms : DEFAULT_WIKI_TERMS;
    const s = await ingestWikiTerms(terms);
    console.log(`[wiki] páginas=${s.pages} guías=${s.guides} chunks=${s.chunks}`);
  }

  if (args.encyclopedia) {
    const s = await ingestEncyclopedia(args.jsonFeed);
    console.log(`[enciclopedia] objetos=${s.items} chunks=${s.chunks}${s.message ? ` · ${s.message}` : ""}`);
  }

  console.log("[ingest] proceso completado");
}

main().catch((err) => {
  console.error("[ingest] error fatal:", err);
  process.exit(1);
});
