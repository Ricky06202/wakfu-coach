import { env } from "./env.js";

/* ------------------------------------------------------------------ */
/* Cliente LLM OpenAI-compatible (con soporte de imágenes)             */
/* ------------------------------------------------------------------ */

export interface LlmTextPart {
  type: "text";
  text: string;
}

export interface LlmImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type LlmContentPart = LlmTextPart | LlmImagePart;

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | LlmContentPart[];
}

export interface ChatCompletionsOpts {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export const isOpenAIProviderConfigured = (): boolean =>
  !!env.LLM_BASE_URL && !!env.LLM_API_KEY;

/**
 * POST /chat/completions contra un endpoint OpenAI-compatible.
 * Devuelve el texto de la respuesta. Las imágenes viajan como data URLs
 * (partes `image_url`) que el modelo de visión interpreta.
 */
export async function chatCompletions(
  messages: LlmMessage[],
  opts: ChatCompletionsOpts = {},
): Promise<string> {
  if (!isOpenAIProviderConfigured()) {
    throw new Error("LLM OpenAI no configurado (LLM_BASE_URL + LLM_API_KEY)");
  }

  const body: Record<string, unknown> = {
    model: env.LLM_MODEL,
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

/** Construye el contenido de un mensaje user con texto + imágenes (data URLs). */
export function buildUserContent(text: string, images: string[] = []): LlmContentPart[] {
  const parts: LlmContentPart[] = [];
  for (const img of images) parts.push({ type: "image_url", image_url: { url: img } });
  parts.push({ type: "text", text });
  return parts;
}
