import { lookupItemByName, lookupRecipeByName, normalizeName, searchChunks, type QueryMatch } from "./db.js";
import { env } from "./env.js";
import { buildUserContent, chatCompletions, isOpenAIProviderConfigured, type LlmMessage } from "./llm.js";

/* ------------------------------------------------------------------ */
/* Recuperación (retrieve)                                             */
/* ------------------------------------------------------------------ */

export interface RagSource {
  title: string;
  url: string | null;
  sourceType: string;
  score: number;
}

export interface RagHit {
  title: string;
  content: string;
  tags: string[];
  url: string | null;
  sourceType: string;
  score: number;
}

export function retrieve(query: string, topK = env.TOP_K): RagHit[] {
  const rows = searchChunks(query, topK);
  return rows.map((r: QueryMatch) => {
    let tags: string[] = [];
    try {
      tags = JSON.parse(r.tags) as string[];
    } catch {
      /* ignore */
    }
    return {
      title: r.title,
      content: r.content,
      tags,
      url: r.url,
      sourceType: r.sourceType,
      score: r.score,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Entidades estructuradas (fichas de objetos y recetas)               */
/* ------------------------------------------------------------------ */

export interface ItemEntity {
  kind: "item";
  id: number;
  name: string;
  level: number;
  type: string;
  category: string | null;
  rarity: string;
  description: string | null;
  effects: { label: string; value: string }[];
  obtain: string | null;
  imageUrl: string | null;
  url: string | null;
}

export interface RecipeEntity {
  kind: "recipe";
  id: number;
  itemName: string;
  profession: string;
  professionLevel: number;
  yields: number;
  ingredients: { name: string; quantity: number; isResource?: boolean }[];
  cost: number | null;
  url: string | null;
}

export type Entity = ItemEntity | RecipeEntity;

/** Palabras que delatan preguntas genéricas (no un objeto concreto). */
const GENERIC_WORDS = new Set([
  "equipo", "build", "stats", "stat", "oficio", "nivelar", "nivelado", "farming",
  "progresion", "economia", "dinero", "kamas", "kamás", "kama", "mejor", "mejores",
  "buen", "buena", "bueno", "para", "cuenta", "abono", "f2p", "mazmorra", "guia",
  "guías", "drop", "consejo", "consejos", "truco", "trucos", "clase", "ninivix",
  "ficha", "receta", "objeto", "objetos", "precio", "mercado", "vale", "renta",
  "rentable", "como", "como?", "subir", "ganar", "empezar", "inicio",
]);

/**
 * Extrae un candidato de "entidad concreta" de la consulta.
 * Devuelve null si la pregunta es genérica o no tiene intención de ficha/receta.
 */
export function lookupCandidate(query: string): { candidate: string; confident: boolean } | null {
  const q = query.trim();
  if (!q) return null;

  // 1) Nombre entre comillas → intención explícita de entidad.
  const quoted = q.match(/["«“]([^"»”]{3,60})["»”]/);
  if (quoted) {
    const candidate = (quoted[1] as string).trim();
    return { candidate, confident: true };
  }

  // 2) Patrones de intención: "receta de X", "ficha de X", "cómo se hace X"…
  const patterns = [
    /^(?:¿)?(?:cual es (?:la|el) (?:receta|ficha|info|informacion)|receta|ficha|objeto|item|como se hace|como se fabrica|como fabrico|como hago|como consigo|como obtengo|donde consigo|donde obtengo|existe|se puede fabricar|ingredientes de|materiales de)\s+(?:de\s+|para\s+|el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|unos\s+|unas\s+)?(.+?)\s*\??$/i,
    /^(?:que es|que son|informacion de|info de)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+?)\s*\??$/i,
  ];
  let candidate: string | null = null;
  for (const p of patterns) {
    const m = q.match(p);
    if (m && m[1]) {
      candidate = (m[1] as string).trim();
      break;
    }
  }
  if (!candidate) return null;
  if (candidate.length < 3 || candidate.length > 60) return null;

  // 3) Determina si la consulta es "específica de una entidad" o una pregunta genérica.
  const words = normalizeName(candidate)
    .split(" ")
    .filter((w) => w.length >= 3);
  const genericHits = words.filter((w) => GENERIC_WORDS.has(w)).length;
  const confident = words.length > 0 && words.length <= 4 && genericHits < 2;
  return { candidate, confident };
}

/** Busca la entidad en los archivos oficiales (objetos y recetas). */
export function lookupEntities(token: string): { items: ItemEntity[]; recipes: RecipeEntity[]; exact: boolean } {
  const items: ItemEntity[] = [];
  const recipes: RecipeEntity[] = [];
  let exact = false;

  const item = lookupItemByName(token);
  if (item) {
    let effects: { label: string; value: string }[] = [];
    try {
      effects = JSON.parse(item.effects) as { label: string; value: string }[];
    } catch {
      /* ignore */
    }
    items.push({
      kind: "item",
      id: item.id,
      name: item.name,
      level: item.level,
      type: item.type,
      category: item.category,
      rarity: item.rarity,
      description: item.description,
      effects,
      obtain: item.obtain,
      imageUrl: item.imageUrl,
      url: item.url,
    });
    exact = true;
  }

  const recipe = lookupRecipeByName(token);
  if (recipe) {
    let ingredients: { name: string; quantity: number; isResource?: boolean }[] = [];
    try {
      ingredients = JSON.parse(recipe.ingredients) as { name: string; quantity: number; isResource?: boolean }[];
    } catch {
      /* ignore */
    }
    recipes.push({
      kind: "recipe",
      id: recipe.id,
      itemName: recipe.itemName,
      profession: recipe.profession,
      professionLevel: recipe.professionLevel,
      yields: recipe.yields,
      ingredients,
      cost: recipe.cost,
      url: recipe.url,
    });
    exact = true;
  }

  return { items, recipes, exact };
}

const MAX_CHUNK_CHARS = 1600;

function formatContext(hits: RagHit[]): string {
  return hits
    .map((h, i) => {
      const trimmed = h.content.length > MAX_CHUNK_CHARS ? `${h.content.slice(0, MAX_CHUNK_CHARS)}…` : h.content;
      return `[Fuente ${i + 1}] ${h.title}${h.url ? ` (${h.url})` : ""}\n${trimmed}`;
    })
    .join("\n\n---\n\n");
}

function formatEntities(entities: Entity[]): string {
  return entities
    .map((e) => {
      if (e.kind === "item") {
        const fx = e.effects.map((f) => `    - ${f.label}: ${f.value}`).join("\n");
        return [
          `FICHA OFICIAL DE OBJETO: ${e.name}`,
          `  Nivel ${e.level} · ${e.type}${e.category ? ` (${e.category})` : ""} · Rareza: ${e.rarity}`,
          e.description ? `  Descripción: ${e.description}` : null,
          fx ? `  Efectos:\n${fx}` : null,
          e.obtain ? `  Obtención: ${e.obtain}` : null,
          e.url ? `  Fuente: ${e.url}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      }
      const ing = e.ingredients.map((i) => `    - ${i.quantity}× ${i.name}`).join("\n");
      return [
        `RECETA OFICIAL: ${e.itemName}`,
        `  Oficio: ${e.profession} (nivel ${e.professionLevel}) · Produce ${e.yields}×`,
        `  Ingredientes:\n${ing}`,
        e.cost ? `  Coste orientativo: ${e.cost} kamás` : null,
        e.url ? `  Fuente: ${e.url}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Generación                                                          */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `Eres Wakfu Coach, un asistente RAG especializado en el MMORPG Wakfu.
Tu jugadora es una cuenta FREE-TO-PLAY (sin abono) de clase NINIVIX.
Responde SIEMPRE en español, de forma concisa y práctica.
Usa EXCLUSIVAMENTE el contexto entre los delimitadores <contexto> y </contexto>,
incluidas las fichas/recetas oficiales que ahí aparezcan.
Si la jugadora pregunta por un objeto o receta concreto y NO está en el contexto,
responde literalmente: "No tengo registrado este objeto en los archivos oficiales."
y sugiere la Wiki Oficial (https://wakfu.wiki.gg) o la Enciclopedia Oficial.
Si el contexto no responde la pregunta, dilo claramente.
Cita las fuentes numeradas que uses, al final, como "[1] Título (url)".
No inventes cifras, estadísticas, ingredientes ni mecánicas: si no está en el contexto, no lo afirmes.`;

const VISION_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

La jugadora adjunta CAPTURAS DE PANTALLA del juego (fichas de objeto, recetas, inventario).
Analiza cada imagen con cuidado: lee el NOMBRE EXACTO del objeto y sus estadísticas.
Verifica SIEMPRE contra los archivos oficiales del contexto: si el objeto de la imagen NO está
registrado, responde literalmente "No tengo registrado este objeto en los archivos oficiales."
Si hay discrepancias entre la imagen y los archivos (versiones, parches), señálalo en vez de inventar.`;

const EXTRACT_PROMPT = `Identifica el objeto, recurso o receta de Wakfu en la(s) imagen(es) adjunta(s).
Responde SOLO con el nombre exacto del objeto en una línea, sin comillas, sin números ni explicaciones.
Si no puedes identificarlo, responde exactamente: DESCONOCIDO`;

function buildPrompt(query: string, context: string, history: Array<{ role: string; content: string }>): string {
  const chat = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Jugadora" : "Coach"}: ${m.content}`)
    .join("\n");
  return `<contexto>
${context}
</contexto>

Historial reciente:
${chat || "(sin historial)"}

Pregunta actual de la jugadora:
${query}`;
}

export type Mode = "llm" | "extractive" | "strict";

export interface GenerateResult {
  answer: string;
  mode: Mode;
}

async function generateWithOllama(query: string, context: string, history: Array<{ role: string; content: string }>, images: string[] = []): Promise<GenerateResult> {
  const prompt = buildPrompt(query, context, history);
  const body: Record<string, unknown> = {
    model: env.OLLAMA_MODEL,
    prompt,
    system: SYSTEM_PROMPT,
    stream: false,
    options: {
      temperature: env.OLLAMA_TEMPERATURE,
      num_predict: env.MAX_TOKENS,
      stop: ["</contexto>"],
    },
  };
  if (images.length) {
    body.images = images.map((img) => img.split(",")[1] ?? img); // Ollama quiere base64 puro
  }
  const res = await fetch(`${env.OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as { response?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return { answer: data.response?.trim() ?? "", mode: "llm" };
}

async function generateWithOpenAI(query: string, context: string, history: Array<{ role: string; content: string }>, images: string[] = []): Promise<GenerateResult> {
  const system = images.length ? VISION_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const chat: LlmMessage[] = history
    .slice(-6)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const messages: LlmMessage[] = [
    { role: "system", content: system },
    ...chat,
    { role: "user", content: buildUserContent(buildPrompt(query, context, history), images) },
  ];
  const answer = await chatCompletions(messages);
  return { answer, mode: "llm" };
}

/** Llama al modelo de visión para extraer el nombre del objeto de la(s) captura(s). */
async function tryExtractName(images: string[]): Promise<string | null> {
  try {
    const messages: LlmMessage[] = [
      { role: "system", content: "Eres un extractor de nombres de objetos del juego Wakfu. Solo devuelves nombres." },
      { role: "user", content: buildUserContent(EXTRACT_PROMPT, images) },
    ];
    const out = await chatCompletions(messages, { maxTokens: 40, temperature: 0 });
    const name = out.trim().replace(/^["'¿¡]+|["'¿¡.;:]+$/g, "");
    if (!name || name.toUpperCase() === "DESCONOCIDO" || name.length < 3 || name.length > 60) return null;
    return name;
  } catch (err) {
    console.warn("[rag] extracción de nombre desde imagen falló:", (err as Error).message);
    return null;
  }
}

/** Modo extractivo autocontenido: resume los fragmentos más relevantes. */
function extractiveAnswer(query: string, hits: RagHit[], entities: Entity[]): GenerateResult {
  const lines: string[] = [];

  if (entities.length > 0) {
    lines.push("Encontré la ficha oficial en la base de conocimiento:");
    for (const e of entities) {
      if (e.kind === "item") {
        const fx = e.effects.map((f) => `- **${f.label}**: ${f.value}`).join("\n");
        lines.push(
          `\n**${e.name}** _(${e.rarity} · nivel ${e.level} · ${e.type}${e.category ? ` / ${e.category}` : ""})_`,
          e.description ?? "",
          fx ? `\nEfectos:\n${fx}` : "",
          e.obtain ? `\nCómo se consigue: ${e.obtain}` : "",
        );
      } else {
        const ing = e.ingredients.map((i) => `- ${i.quantity}× ${i.name}`).join("\n");
        lines.push(
          `\n**Receta: ${e.itemName}** _(${e.profession} nivel ${e.professionLevel} · produce ${e.yields}×)_`,
          `\nIngredientes:\n${ing}`,
          e.cost ? `\nCoste orientativo: ${e.cost} kamás` : "",
        );
      }
    }
    lines.push("");
  }

  if (hits.length > 0) {
    lines.push(
      hits.length && !entities.length
        ? `No hay un LLM conectado (OLLAMA_URL vacío), así que respondo con los fragmentos más relevantes de la base para: *${query}*.`
        : "Contexto adicional de las guías:",
    );
    for (const h of hits.slice(0, 3)) {
      const snippet = h.content.slice(0, 700);
      lines.push(`\n**${h.title}**${h.tags.length ? ` _[${h.tags.slice(0, 3).join(", ")}]_` : ""}\n${snippet}`);
    }
  }

  const refs: Array<{ label: string; url: string | null }> = [
    ...entities.map((e) => ({ label: e.kind === "item" ? e.name : `Receta: ${e.itemName}`, url: e.url })),
    ...hits.slice(0, 2).map((h) => ({ label: h.title, url: h.url })),
  ];
  lines.push(
    "\n---\n**Verifica en las fuentes:** " +
      refs.map((r) => `[${r.label}](${r.url ?? "https://wakfu.wiki.gg"})`).join(" · ") +
      "\n> Pista: configura `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` (con visión) para respuestas redactadas por un LLM.",
  );
  return { answer: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), mode: "extractive" };
}

/** Respuesta estricta: la entidad pedida no está en los archivos oficiales. */
function strictAnswer(query: string, candidate: string, hits: RagHit[]): RagAnswer {
  const lines = [
    `**No tengo registrado \`${candidate}\` en los archivos oficiales.**`,
    "",
    "No voy a inventar estadísticas ni recetas: esa ficha no existe en la base de conocimiento local (Enciclopedia Oficial de wakfu.com ni Wiki Oficial de wakfu.wiki.gg).",
    "",
    "Opciones:",
    "- Revisa la ortografía o el nombre exacto del objeto.",
    "- Consulta la **Enciclopedia Oficial**: https://www.wakfu.com/es/mmorpg/enciclopedia",
    "- Busca en la **Wiki Oficial**: https://wakfu.wiki.gg",
    "- Si el contenido es nuevo, ejecuta la ingesta (`--wiki` / `--encyclopedia`) para incorporarlo a la base.",
  ];
  if (hits.length > 0) {
    lines.push("", "Contenido relacionado que **sí** tengo registrado:");
    for (const h of hits.slice(0, 3)) lines.push(`- **${h.title}**${h.url ? ` — ${h.url}` : ""}`);
  }
  return {
    answer: lines.join("\n"),
    mode: "strict",
    sources: hits.map((h) => ({ title: h.title, url: h.url, sourceType: h.sourceType, score: h.score })),
    retrieved: hits,
    retrievedCount: hits.length,
    entities: [],
  };
}

/* ------------------------------------------------------------------ */
/* Orquestador RAG                                                     */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RagAnswer {
  answer: string;
  mode: Mode;
  sources: RagSource[];
  retrieved: RagHit[];
  retrievedCount: number;
  entities: Entity[];
}

type Provider = "ollama" | "openai" | "none";

function resolveProvider(): Provider {
  if (env.LLM_PROVIDER === "ollama") return env.OLLAMA_URL ? "ollama" : "none";
  if (env.LLM_PROVIDER === "openai") return isOpenAIProviderConfigured() ? "openai" : "none";
  if (env.OLLAMA_URL) return "ollama";
  if (isOpenAIProviderConfigured()) return "openai";
  return "none";
}

function dedupeEntities(list: Entity[]): Entity[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const k = `${e.kind}:${e.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface AnswerOptions {
  images?: string[];
}

export async function answerQuestion(
  query: string,
  history: ChatMessage[] = [],
  topK = env.TOP_K,
  opts: AnswerOptions = {},
): Promise<RagAnswer> {
  const images = opts.images ?? [];
  const provider = resolveProvider();
  const hits = retrieve(query, topK);
  const sources: RagSource[] = hits.map((h) => ({
    title: h.title,
    url: h.url,
    sourceType: h.sourceType,
    score: h.score,
  }));

  let entities: Entity[] = [];

  // 1) Imágenes: el modelo de visión lee la captura y busca la ficha oficial.
  let visionName: string | null = null;
  if (images.length && provider === "openai") {
    visionName = await tryExtractName(images);
    if (visionName) {
      const found = lookupEntities(visionName);
      entities = dedupeEntities([...entities, ...found.items, ...found.recipes]);
    }
  }

  // 2) Intención de ficha/receta concreta por texto.
  const lookup = lookupCandidate(query);
  let exactEntity = false;
  if (lookup) {
    const found = lookupEntities(lookup.candidate);
    entities = dedupeEntities([...entities, ...found.items, ...found.recipes]);
    exactEntity = found.exact;
  }

  // Puerta estricta anti-alucinación:
  //  - Por texto: objeto/receta concreto sin coincidencia exacta.
  //  - Por imagen: el modelo leyó un nombre que no está en los archivos oficiales.
  if (lookup && lookup.confident && !exactEntity) {
    return strictAnswer(query, lookup.candidate, hits);
  }
  if (images.length && visionName && entities.length === 0) {
    return strictAnswer(query, visionName, hits);
  }

  // Sin ninguna base de conocimiento relevante.
  if (hits.length === 0 && entities.length === 0) {
    return {
      answer: images.length
        ? "Recibí tu captura, pero no hay un modelo con visión configurado para analizarla. " +
          "Configura `LLM_BASE_URL`, `LLM_API_KEY` y `LLM_MODEL` (con visión) en el entorno, " +
          "o prueba a escribir el nombre del objeto en el chat."
        : "No encontré información relevante en la base de conocimiento local para esa consulta. " +
          "Intenta reformularla o ejecuta la ingesta de la Wiki Oficial (`--wiki`). También puedes consultar https://wakfu.wiki.gg directamente.",
      mode: "extractive",
      sources: [],
      retrieved: [],
      retrievedCount: 0,
      entities: [],
    };
  }

  const context = [formatContext(hits), entities.length ? formatEntities(entities) : ""].filter(Boolean).join("\n\n");
  let result: GenerateResult;

  if (provider === "openai") {
    try {
      result = await generateWithOpenAI(query, context, history, images);
      if (!result.answer) throw new Error("respuesta vacía del modelo");
    } catch (err) {
      console.warn("[rag] fallo de LLM OpenAI, degradando a modo extractivo:", (err as Error).message);
      result = extractiveAnswer(query, hits, entities);
    }
  } else if (provider === "ollama") {
    try {
      result = await generateWithOllama(query, context, history, images);
      if (!result.answer) throw new Error("respuesta vacía del modelo");
    } catch (err) {
      console.warn("[rag] fallo de Ollama, degradando a modo extractivo:", (err as Error).message);
      result = extractiveAnswer(query, hits, entities);
    }
  } else {
    result = extractiveAnswer(query, hits, entities);
  }

  return { answer: result.answer, mode: result.mode, sources, retrieved: hits, retrievedCount: hits.length, entities };
}
