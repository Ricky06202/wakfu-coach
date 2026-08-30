import { env } from "./env.js";

/* ------------------------------------------------------------------ */
/* Cliente LLM: OpenAI-compatible y Anthropic-compatible (visión)      */
/* ------------------------------------------------------------------ */

export interface LlmTextPart {
  type: "text";
  text: string;
}

export interface LlmImagePart {
  type: "image_url";
  image_url: { url: string };
}

/** Bloque de imagen del formato Anthropic Messages API. */
export interface AnthropicImagePart {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export type LlmContentPart = LlmTextPart | LlmImagePart | AnthropicImagePart;

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | LlmContentPart[];
  /** Campo propio de la API multimodal de DeepSeek nativa (base64 puro). */
  image?: string[];
}

export interface ChatCompletionsOpts {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  /** Override del modelo (p.ej. usar el de visión solo para extraer capturas). */
  model?: string;
}

export type ApiStyle = "openai" | "anthropic";

export const isOpenAIProviderConfigured = (): boolean => !!env.LLM_BASE_URL && !!env.LLM_API_KEY;

/** Detecta si la URL base es el endpoint Anthropic-compatible (/anthropic). */
export function isAnthropicUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes("anthropic");
  } catch {
    return false;
  }
}

/** Resuelve el estilo de API (override por env o por la forma de LLM_BASE_URL). */
export function apiStyle(): ApiStyle {
  if (env.LLM_API_STYLE === "anthropic" || env.LLM_API_STYLE === "openai") return env.LLM_API_STYLE;
  return isAnthropicUrl(env.LLM_BASE_URL ?? "") ? "anthropic" : "openai";
}

export type ImageFormat = "openai" | "deepseek" | "anthropic";

/** Resuelve el formato de imágenes del proveedor. */
export function resolveImageFormat(): ImageFormat {
  if (env.LLM_IMAGE_API === "openai" || env.LLM_IMAGE_API === "deepseek" || env.LLM_IMAGE_API === "anthropic") {
    return env.LLM_IMAGE_API;
  }
  const base = env.LLM_BASE_URL ?? "";
  if (isAnthropicUrl(base)) return "anthropic";
  try {
    const host = new URL(base).hostname;
    if (host === "api.deepseek.com" || host.endsWith(".deepseek.com")) return "deepseek";
  } catch {
    /* no configurada */
  }
  return "openai";
}

function rawBase64(dataUrl: string): { mime: string; data: string } {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return { mime: "image/png", data: dataUrl };
  const mime = (dataUrl.slice(5, dataUrl.indexOf(";") || comma).trim() || "image/png") as string;
  return { mime, data: dataUrl.slice(comma + 1) };
}

/** Construye el contenido de un mensaje user con texto + imágenes (estándar OpenAI). */
export function buildUserContent(text: string, images: string[] = []): LlmContentPart[] {
  const parts: LlmContentPart[] = [];
  for (const img of images) parts.push({ type: "image_url", image_url: { url: img } });
  parts.push({ type: "text", text });
  return parts;
}

/**
 * Construye un mensaje `user` con imágenes según el formato del proveedor:
 *  - "openai"    -> partes `image_url` dentro de `content`.
 *  - "deepseek"  -> `content` como texto + campo `image[]` con base64 puro.
 *  - "anthropic" -> bloques `image` de Anthropic Messages API (sí procesa visión en api.deepseek.com/anthropic).
 */
export function buildUserMessage(text: string, images: string[] = []): LlmMessage {
  const format = resolveImageFormat();
  if (format === "deepseek" && images.length) {
    return { role: "user", content: text, image: images.map((img) => rawBase64(img).data) };
  }
  if (format === "anthropic" && images.length) {
    const parts: LlmContentPart[] = [];
    for (const img of images) {
      const { mime, data } = rawBase64(img);
      parts.push({ type: "image", source: { type: "base64", media_type: mime, data } });
    }
    parts.push({ type: "text", text });
    return { role: "user", content: parts };
  }
  return { role: "user", content: buildUserContent(text, images) };
}

/* ------------------- OpenAI-compatible ------------------- */

export async function chatCompletions(messages: LlmMessage[], opts: ChatCompletionsOpts = {}): Promise<string> {
  if (!isOpenAIProviderConfigured()) {
    throw new Error("LLM OpenAI no configurado (LLM_BASE_URL + LLM_API_KEY)");
  }

  const body: Record<string, unknown> = {
    model: opts.model ?? env.LLM_MODEL,
    messages,
    temperature: opts.temperature ?? env.OLLAMA_TEMPERATURE,
    max_tokens: opts.maxTokens ?? env.MAX_TOKENS,
    stream: false,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150_000),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 400);
    throw new Error(`LLM HTTP ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | LlmContentPart[] } }>;
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);

  const content = data.choices?.[0]?.message?.content;
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((p): p is LlmTextPart => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  if (!text.trim()) throw new Error("respuesta vacía del LLM");
  return text.trim();
}

/* ------------------- Anthropic-compatible ------------------- */

export async function anthropicMessages(messages: LlmMessage[], opts: ChatCompletionsOpts = {}): Promise<string> {
  if (!isOpenAIProviderConfigured()) {
    throw new Error("LLM Anthropic no configurado (LLM_BASE_URL + LLM_API_KEY)");
  }

  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join("\n")))
    .join("\n\n");

  const body: Record<string, unknown> = {
    model: opts.model ?? env.LLM_MODEL,
    max_tokens: opts.maxTokens ?? env.MAX_TOKENS,
    temperature: opts.temperature ?? env.OLLAMA_TEMPERATURE,
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? [{ type: "text", text: m.content }]
            : m.content.filter((p) => p.type === "text" || p.type === "image"),
      })),
  };
  if (system) body.system = system;

  const res = await fetch(`${env.LLM_BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.LLM_API_KEY ?? "",
      "anthropic-version": env.LLM_ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 400);
    throw new Error(`LLM Anthropic HTTP ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);

  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  if (!text) throw new Error("respuesta vacía del LLM");
  return text;
}

/* ------------------- Router unificado ------------------- */

export async function complete(messages: LlmMessage[], opts: ChatCompletionsOpts = {}): Promise<string> {
  return apiStyle() === "anthropic" ? anthropicMessages(messages, opts) : chatCompletions(messages, opts);
}
