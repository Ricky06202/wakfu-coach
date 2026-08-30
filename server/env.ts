import { z } from "zod";

/**
 * Configuración de la aplicación validada al arranque.
 * En Docker la DB vive en el volumen /app/data.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z
    .string()
    .default(process.env.NODE_ENV === "production" ? "/app/data/wakfu.db" : "./data/wakfu.db"),
  AUTO_SEED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  OLLAMA_URL: z
    .union([z.literal(""), z.string().url()])
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  OLLAMA_MODEL: z.string().min(1).default("llama3.2:3b"),
  /**
   * LLM OpenAI/Anthropic-compatible con visión.
   * `LLM_PROVIDER`: "auto" (Ollama si OLLAMA_URL, si no el endpoint LLM_BASE_URL) | "ollama" | "openai" | "anthropic".
   * La API key NUNCA va en el repo: solo por variable de entorno.
   */
  LLM_PROVIDER: z.enum(["auto", "ollama", "openai", "anthropic"]).default("auto"),
  LLM_BASE_URL: z
    .union([z.literal(""), z.string().url()])
    .optional()
    .transform((v) => (v && v.trim() ? v.trim().replace(/\/+$/, "") : undefined)),
  LLM_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  LLM_MODEL: z.string().min(1).default("deepseek-v4-flash-vision-exp"),
  /**
   * Estilo de API: "openai" (chat/completions) | "anthropic" (/v1/messages) | "auto"
   * (detecta por la URL, p.ej. api.deepseek.com/anthropic). Para visión con
   * DeepSeek hay que usar el endpoint Anthropic-compatible.
   */
  LLM_API_STYLE: z.enum(["auto", "openai", "anthropic"]).default("auto"),
  /**
   * Formato de las imágenes en el payload:
   *  "openai"    -> content[].image_url (estándar OpenAI)
   *  "deepseek"  -> campo message.image[] con base64 puro (API DeepSeek multimodal nativa)
   *  "anthropic" -> bloques image (Anthropic Messages API)
   *  "auto"      -> detecta por el host/URL
   */
  LLM_IMAGE_API: z.enum(["auto", "openai", "deepseek", "anthropic"]).default("auto"),
  LLM_ANTHROPIC_VERSION: z.string().min(1).default("2023-06-01"),
  LLM_MAX_IMAGES: z.coerce.number().int().min(0).max(5).default(2),
  LLM_MAX_IMAGE_MB: z.coerce.number().int().min(1).max(20).default(8),
  TOP_K: z.coerce.number().int().positive().max(50).default(8),
  MAX_TOKENS: z.coerce.number().int().positive().default(1200),
  OLLAMA_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[env] Configuración inválida:", parsed.error.flatten());
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
