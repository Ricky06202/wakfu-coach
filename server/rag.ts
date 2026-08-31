import { lookupItemByName, lookupRecipeByName, normalizeName, raw, searchChunks, type QueryMatch } from "./db.js";
import { env } from "./env.js";
import { apiStyle, buildUserMessage, complete, isOpenAIProviderConfigured, type LlmMessage } from "./llm.js";

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
  sourceId: number | null;
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
      sourceId: r.sourceId,
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

export type Entity = ItemEntity | RecipeEntity | EntityCard;

/** Tarjeta genérica de entidad Cargo (monstruo, hechizo, mazmorra, …). */
export interface EntityCard {
  kind: "entity";
  topic: string;
  title: string;
  url: string | null;
  imageUrl: string | null;
  fields: { label: string; value: string }[];
}

function prettyLabel(col: string): string {
  return col
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Construye tarjetas de entidades (monstruos/hechizos/…) desde los hits recuperados. */
function entityCardsFromHits(hits: RagHit[]): EntityCard[] {
  const cards: EntityCard[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.sourceType !== "entity" || h.sourceId == null) continue;
    const row = raw
      .prepare("SELECT topic, title, url, data FROM entities WHERE id = ?")
      .get(h.sourceId) as { topic: string; title: string; url: string | null; data: string } | undefined;
    if (!row) continue;
    const key = `${row.topic}:${row.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    const fields: { label: string; value: string }[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (k === "image" || v == null || String(v).trim() === "") continue;
      const s = String(v).trim();
      if (s.length > 200) continue;
      fields.push({ label: prettyLabel(k), value: s });
      if (fields.length >= 10) break;
    }
    const image = typeof data.image === "string" && data.image ? (data.image as string) : null;
    cards.push({
      kind: "entity",
      topic: row.topic,
      title: row.title,
      url: row.url,
      imageUrl: image && !/^["!@#]/.test(image) ? `/api/img?f=${encodeURIComponent(image)}` : null,
      fields,
    });
  }
  return cards;
}

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
      if (e.kind === "entity") {
        const fx = e.fields.map((f) => `    - ${f.label}: ${f.value}`).join("\n");
        return [`FICHA (${e.topic}): ${e.title}`, fx ? `  Datos:\n${fx}` : null, e.url ? `  Fuente: ${e.url}` : null]
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

export type PlayerProfile = Array<{ key: string; value: string }>;

/** Prompt de COACH proactivo: adapta el consejo al perfil y pide contexto si falta. */
function buildSystemPrompt(profile: PlayerProfile, images: boolean): string {
  let sys = `Eres Wakfu Coach, un entrenador personal (coach) del MMORPG Wakfu para una jugadora en modo free-to-play (sin abono).

Tu rol es COACHEAR, no solo informar:
- Da instrucciones PRÁCTICAS paso a paso (qué hacer ahora y en qué orden).
- Si te falta contexto (nivel, elemento, equipo, ubicación, objetivo o lo que la jugadora tiene/hace), PREGÚNTALO de forma breve en lugar de adivinar.
- Interpreta frases como "mira, tengo esto", "estoy aquí", "me piden esto": la jugadora describe su estado y quiere saber cómo seguir.
- Usa TU conocimiento del juego para orientar, pero distingue SIEMPRE entre:
  1) datos VERIFICADOS (los del <contexto>: stats, recetas, precios exactos) y
  2) orientación general (si no está en el contexto, márcalo como "según mi experiencia").
- NUNCA inventes cifras exactas, estadísticas, ingredientes ni recetas que no estén en el <contexto>.
- Si la jugadora pregunta por un objeto o receta concreto y NO está en el contexto, responde literalmente: "No tengo registrado este objeto en los archivos oficiales."
- Responde SIEMPRE en español, conciso, con pasos o viñetas cuando ayude, y con tono de entrenador (firme pero cercano).
- Si usaste fuentes del contexto, cítalas al final como "[1] Título (url)".`;
  if (profile.length) {
    sys += `\n\nPERFIL DE LA JUGADORA (adapta TODO el consejo a esto):\n${profile
      .map((p) => `- ${p.key}: ${p.value}`)
      .join("\n")}`;
  }
  if (images) {
    sys += `\n\nLa jugadora adjunta CAPTURAS DE PANTALLA del juego (fichas de objeto, recetas, inventario).
Analiza cada imagen con cuidado: lee el NOMBRE EXACTO del objeto y sus estadísticas.
Verifica SIEMPRE contra los archivos oficiales del contexto: si el objeto de la imagen NO está
registrado, responde literalmente "No tengo registrado este objeto en los archivos oficiales."
Si hay discrepancias entre la imagen y los archivos (versiones, parches), señálalo en vez de inventar.`;
  }
  return sys;
}

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

async function generateWithOllama(query: string, context: string, history: Array<{ role: string; content: string }>, profile: PlayerProfile, images: string[] = []): Promise<GenerateResult> {
  const prompt = buildPrompt(query, context, history);
  const body: Record<string, unknown> = {
    model: env.OLLAMA_MODEL,
    prompt,
    system: buildSystemPrompt(profile, images.length > 0),
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

async function generateWithLlm(query: string, context: string, history: Array<{ role: string; content: string }>, profile: PlayerProfile, images: string[] = []): Promise<GenerateResult> {
  const chat: LlmMessage[] = history
    .slice(-6)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const messages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt(profile, images.length > 0) },
    ...chat,
    buildUserMessage(buildPrompt(query, context, history), images),
  ];
  const answer = await complete(messages);
  return { answer, mode: "llm" };
}

/** Llama al modelo de visión para extraer el nombre del objeto de la(s) captura(s). */
async function tryExtractName(images: string[]): Promise<string | null> {
  try {
    const messages: LlmMessage[] = [
      { role: "system", content: "Eres un extractor de nombres de objetos del juego Wakfu. Solo devuelves nombres." },
      buildUserMessage(EXTRACT_PROMPT, images),
    ];
    const out = await complete(messages, { maxTokens: 120, temperature: 0, model: env.LLM_VISION_MODEL });
    const name = out.trim().replace(/^["'¿¡]+|["'¿¡.;:]+$/g, "");
    if (!name || name.toUpperCase() === "DESCONOCIDO" || name.length < 3 || name.length > 60) return null;
    return name;
  } catch (err) {
    console.warn("[rag] extracción de nombre desde imagen falló:", (err as Error).message);
    return null;
  }
}

/** Modo extractivo autocontenido: responde con las fichas y guías de la base. */
function extractiveAnswer(query: string, hits: RagHit[], entities: Entity[]): GenerateResult {
  const lines: string[] = [];

  if (entities.length > 0) {
    lines.push("Aquí tienes la ficha oficial que tengo registrada:");
    for (const e of entities) {
      if (e.kind === "item") {
        const fx = e.effects.map((f) => `- **${f.label}**: ${f.value}`).join("\n");
        lines.push(
          `\n**${e.name}** _(${e.rarity} · nivel ${e.level} · ${e.type}${e.category ? ` / ${e.category}` : ""})_`,
          e.description ?? "",
          fx ? `\nEfectos:\n${fx}` : "",
          e.obtain ? `\nCómo se consigue: ${e.obtain}` : "",
        );
      } else if (e.kind === "entity") {
        const fx = e.fields.map((f) => `- **${f.label}**: ${f.value}`).join("\n");
        lines.push(`\n**${e.title}** _(${e.topic})_`, fx ? `\n${fx}` : "");
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
    lines.push(entities.length ? "Y esto complementa lo que dicen las guías de la comunidad:" : "Según las guías y fichas de mi base de conocimiento:");
    for (const h of hits.slice(0, 3)) {
      const snippet = h.content.slice(0, 700);
      lines.push(`\n**${h.title}**${h.tags.length ? ` _[${h.tags.slice(0, 3).join(", ")}]_` : ""}\n${snippet}`);
    }
  }

  const refs: Array<{ label: string; url: string | null }> = [
    ...entities.map((e) => ({ label: e.kind === "item" ? e.name : e.kind === "entity" ? e.title : `Receta: ${e.itemName}`, url: e.url })),
    ...hits.slice(0, 2).map((h) => ({ label: h.title, url: h.url })),
  ];
  if (refs.length) {
    lines.push("\n---\n**Fuentes:** " + refs.map((r) => `[${r.label}](${r.url ?? "https://wakfu.wiki.gg"})`).join(" · "));
  }
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

type Provider = "ollama" | "openai" | "anthropic" | "none";

/** Respuestas amables para saludos/charla breve (evitan el "no encontré información"). */
function smallTalkReply(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (/^(hola|buenas|buenos? dias|buenas tardes|buenas noches|hey|hi|hello|saludos|que tal|qué tal|como estas|cómo estás)[\s!.,]*$/i.test(q)) {
    return "¡Hola! Soy Wakfu Coach, tu asistente para Wakfu en modo free-to-play (clase Ninivix). Pregúntame por builds, recetas, farming o equipamiento.";
  }
  if (/^(gracias|muchas gracias|thx|thanks)[\s!.,]*$/i.test(q)) {
    return "¡De nada! Aquí estoy para lo que necesites: builds, recetas o eficiencia F2P.";
  }
  if (/(quien eres|quién eres|que eres|qué eres|como te llamas|como te llamas|qué haces|que haces|que es wakfu|qué es wakfu)/i.test(q)) {
    return "Soy Wakfu Coach, un asistente RAG con base de conocimiento local (Enciclopedia Oficial y Wiki Oficial de Wakfu), enfocado en cuentas free-to-play y la clase Ninivix.";
  }
  if (/^(adios|chao|hasta luego|bye|nos vemos)[\s!.,]*$/i.test(q)) {
    return "¡Hasta luego! Que el caos te sea leve en el mundo de los Doce. Vuelve cuando quieras.";
  }
  return null;
}

function resolveProvider(): Provider {
  if (env.LLM_PROVIDER === "ollama") return env.OLLAMA_URL ? "ollama" : "none";
  if (env.LLM_PROVIDER === "anthropic") return isOpenAIProviderConfigured() ? "anthropic" : "none";
  if (env.LLM_PROVIDER === "openai") return isOpenAIProviderConfigured() ? "openai" : "none";
  if (env.OLLAMA_URL) return "ollama";
  if (isOpenAIProviderConfigured()) {
    return apiStyle() === "anthropic" ? "anthropic" : "openai";
  }
  return "none";
}

function dedupeEntities(list: Entity[]): Entity[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const k = e.kind === "entity" ? `entity:${e.topic}:${e.title}` : `${e.kind}:${(e as { id: number }).id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface AnswerOptions {
  images?: string[];
  profile?: PlayerProfile;
}

export async function answerQuestion(
  query: string,
  history: ChatMessage[] = [],
  topK = env.TOP_K,
  opts: AnswerOptions = {},
): Promise<RagAnswer> {
  const images = opts.images ?? [];
  const profile = (opts.profile ?? []).filter((p) => p.key.trim() && p.value.trim());
  const provider = resolveProvider();

  // Recuperación sobre la consulta REAL (el perfil NO se inyecta en el query,
  // se usa como boost posterior para no contaminar la relevancia).
  const hits = retrieve(query, topK);

  // Boost posterior: si un fragmento menciona la clase/elemento/oficios del
  // perfil, sube su relevancia para el consejo de la jugadora.
  const profileBoostTerms = profile
    .filter((p) => ["clase", "elemento", "oficios", "zona"].includes(p.key))
    .map((p) => normalizeName(p.value))
    .filter((v) => v.length >= 3);
  if (profileBoostTerms.length) {
    for (const h of hits) {
      const hay = normalizeName(`${h.title} ${h.content}`);
      for (const v of profileBoostTerms) {
        if (hay.includes(v)) {
          h.score += 1.5;
          break;
        }
      }
    }
    hits.sort((a, b) => b.score - a.score);
  }

  // Charla breve / saludos: solo se responde de forma fija si NO hay LLM.
  // Con LLM activo la conversación la lleva el modelo (más natural).
  const smallTalk = provider === "none" ? smallTalkReply(query) : null;

  const sources: RagSource[] = hits.map((h) => ({
    title: h.title,
    url: h.url,
    sourceType: h.sourceType,
    score: h.score,
  }));

  let entities: Entity[] = [];

  // 1) Imágenes: el modelo de visión lee la captura y busca la ficha oficial.
  const hasVisionLlm = provider === "openai" || provider === "anthropic";
  let visionName: string | null = null;
  if (images.length && hasVisionLlm) {
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

  // 3) Tarjetas de entidades Cargo (monstruos, hechizos, mazmorras…) de los hits.
  entities = dedupeEntities([...entities, ...entityCardsFromHits(hits)]);

  // Puerta estricta anti-alucinación:
  //  - Por texto: objeto/receta concreto sin coincidencia exacta.
  //  - Por imagen: el modelo leyó un nombre que no está en los archivos oficiales.
  if (lookup && lookup.confident && !exactEntity) {
    return strictAnswer(query, lookup.candidate, hits);
  }
  if (images.length && visionName && entities.length === 0) {
    return strictAnswer(query, visionName, hits);
  }

  const context = [formatContext(hits), entities.length ? formatEntities(entities) : ""].filter(Boolean).join("\n\n");
  let result: GenerateResult;

  // Sin LLM: respuestas amables para saludos, extractivas para el resto.
  if (provider === "none") {
    if (smallTalk) {
      return {
        answer: smallTalk,
        mode: "extractive",
        sources: [],
        retrieved: [],
        retrievedCount: 0,
        entities: [],
      };
    }
    if (hits.length === 0 && entities.length === 0) {
      return {
        answer: images.length
          ? "Recibí tu captura, pero no hay un modelo con visión configurado para analizarla. " +
            "Configura `LLM_BASE_URL`, `LLM_API_KEY` y `LLM_MODEL` (con visión) en el entorno, " +
            "o prueba a escribir el nombre del objeto en el chat."
          : "Aún no tengo información sobre eso en mis archivos (Enciclopedia Oficial y Wiki de Wakfu). " +
            "Intenta reformular la pregunta o, si es un objeto nuevo, ejecuta la ingesta de la Wiki Oficial.",
        mode: "extractive",
        sources: [],
        retrieved: [],
        retrievedCount: 0,
        entities: [],
      };
    }
    result = extractiveAnswer(query, hits, entities);
  } else {
    // Con LLM: el coach conversa de verdad, incluso sin contexto (saludos, dudas generales).
    try {
      result =
        provider === "ollama"
          ? await generateWithOllama(query, context, history, profile, images)
          : await generateWithLlm(query, context, history, profile, images);
      if (!result.answer) throw new Error("respuesta vacía del modelo");
    } catch (err) {
      console.warn("[rag] fallo de LLM, degradando a modo extractivo:", (err as Error).message);
      result = extractiveAnswer(query, hits, entities);
    }
  }

  return { answer: result.answer, mode: result.mode, sources, retrieved: hits, retrievedCount: hits.length, entities };
}
