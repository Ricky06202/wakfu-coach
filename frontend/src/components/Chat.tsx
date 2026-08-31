import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { API_BASE, chatRequest, type ProfileItem } from "../lib/api.ts";
import type { ChatMessage, ChatSource } from "../lib/api.ts";
import { Markdown } from "../lib/markdown.tsx";
import { EntityCards } from "./Cards.tsx";

const SUGGESTIONS = [
  "¿Cómo consigo un buen equipo de Ninivix sin abono?",
  "¿Qué recetas dan mejor valor para una cuenta F2P?",
  "¿Cuál es la prioridad de stats para Ninivix?",
  "¿Qué conviene farmear para ganar kamás sin abono?",
  "¿Qué oficio conviene subir primero como Ninivix?",
];

const SOURCE_LABEL: Record<string, string> = {
  guide: "Guía",
  item: "Ficha",
  recipe: "Receta",
};

const STORAGE_KEY = "wakfu-coach:chat:v1";
const SESSION_KEY = "wakfu-coach:session";
const PROFILE_KEY = "wakfu-coach:profile";

const PROFILE_FIELDS = [
  "nombre",
  "clase",
  "nivel",
  "elemento",
  "oficios",
  "kamas",
  "zona",
  "mision",
  "objetivo",
] as const;

const PROFILE_PLACEHOLDERS: Record<string, string> = {
  nombre: "p.ej. Ninivix-Fuego",
  clase: "ninivix",
  nivel: "p.ej. 40",
  elemento: "p.ej. fuego / agua",
  oficios: "p.ej. herrero, alquimista",
  kamas: "p.ej. 120k (economía)",
  zona: "p.ej. Amakna",
  mision: "lo que te piden ahora",
  objetivo: "p.ej. subir a nivel 60",
};

const MAX_IMAGES = 2;
const MAX_IMAGE_MB = 8;

function loadChat(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function sessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10).toUpperCase();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "———";
  }
}

function loadProfile(): ProfileItem[] {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ProfileItem[]) : [];
  } catch {
    return [];
  }
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState("————");
  const hydrated = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<string[]>([]);
  const [dbChunks, setDbChunks] = useState<number | null>(null);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [profile, setProfile] = useState<ProfileItem[]>([]);
  const [showProfile, setShowProfile] = useState(false);
  const [llmOn, setLlmOn] = useState<boolean | null>(null);

  // Carga del historial persistido y del id de sesión (solo en cliente, sin
  // mismatch de hidratación en el SSR de Astro).
  useEffect(() => {
    setMessages(loadChat());
    setSession(sessionId());
    setProfile(loadProfile());
    hydrated.current = true;
    void refreshStats();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      /* ignore */
    }
  }, [profile]);

  function setProfileField(field: string, value: string) {
    // Guardamos el texto CRUDO (sin trim): recortar aquí rompía la barra
    // espaciadora al borrar los espacios en cada pulsación.
    setProfile((prev) => {
      const next = prev.filter((p) => p.key !== field);
      if (value) next.push({ key: field, value });
      return next;
    });
  }

  async function refreshStats() {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.ok) {
        const h = (await res.json()) as { db?: { chunks?: number }; rag?: { llmConfigured?: boolean } };
        setDbChunks(h.db?.chunks ?? null);
        setLlmOn(h.rag?.llmConfigured ?? null);
      }
    } catch {
      /* API no disponible */
    }
  }

  async function runIngest(kind: "wiki" | "seed" | "encyclopedia" | "cargo", all = false) {
    if (ingesting) return;
    setIngesting(true);
    setIngestMsg(
      kind === "cargo"
        ? "descargando TODO el Cargo de la wiki (items, monstruos, hechizos, quests…)…"
        : all
          ? "cargando TODA la wiki (puede tardar horas)…"
          : `cargando ${kind}…`,
    );
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ingest/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: all ? JSON.stringify({ all: true }) : undefined,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        guides?: number;
        pages?: number;
        items?: number;
        recipes?: number;
        chunks?: number;
        rows?: number;
        topics?: Array<{ topic: string }>;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setIngestMsg(`error al cargar ${kind}`);
        return;
      }
      if (data.message) {
        setIngestMsg(data.message);
        return;
      }
      setIngestMsg(
        kind === "cargo"
          ? `cargo completo: ${data.items ?? "?"} items + ${data.recipes ?? "?"} recetas, ${data.topics?.length ?? "?"} temas (${data.chunks ?? "?"} fragmentos)`
          : all
            ? `wiki completo: ${data.guides ?? data.pages ?? "?"} guías, ${data.chunks ?? "?"} fragmentos`
            : kind === "seed"
              ? `seed cargado: ${data.chunks ?? "?"} fragmentos nuevos`
              : kind === "wiki"
                ? `wiki cargado: ${data.guides ?? data.pages ?? "?"} guías, ${data.chunks ?? "?"} fragmentos`
                : `enciclopedia cargada: ${data.items ?? "?"} objetos`,
      );
      await refreshStats();
    } catch {
      setIngestMsg(`no se pudo conectar con la API para cargar ${kind}`);
    } finally {
      setIngesting(false);
    }
  }

  // Persistencia de la sesión: el historial sobrevive a recargas de la página.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    const attached = [...images];
    if ((!trimmed && attached.length === 0) || busy) return;
    // Se envía TODO el historial previo en cada petición para mantener el contexto.
    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed || "Analiza esta captura del juego." }];
    setMessages(next);
    setInput("");
    setImages([]);
    setBusy(true);
    setError(null);
    try {
      const res = await chatRequest(next, attached, profile);
      setMessages([
        ...next,
        { role: "assistant", content: res.answer, sources: res.sources, mode: res.mode, entities: res.entities },
      ]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onPickImages(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    addImagesFromFiles(files);
    e.target.value = "";
  }

  /** Añade imágenes (data URLs) desde archivos o desde el portapapeles. */
  function addImagesFromFiles(files: File[]) {
    const slots = MAX_IMAGES - images.length;
    files.slice(0, slots).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
        setError(`La imagen "${file.name}" supera ${MAX_IMAGE_MB} MB`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") setImages((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  }

  /** Pega capturas directamente del portapapeles (Ctrl+V) en el cuadro de texto. */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((it) => it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length) {
      e.preventDefault(); // evita pegar el nombre binario de la imagen como texto
      addImagesFromFiles(files);
    }
  }

  function clearChat() {
    if (busy) return;
    setMessages([]);
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  const profileName = profile.find((p) => p.key === "nombre")?.value?.trim() || "";

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-edge bg-panel/90 shadow-2xl backdrop-blur">
      {/* Cabecera — consola táctica */}
      <div className="flex items-center gap-3 border-b border-edge bg-ink/40 px-4 py-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-teal/40 bg-teal/10 text-teal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4" strokeDasharray="3 2" />
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3" strokeLinecap="round" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-paper">Wakfu Coach</p>
          <p className="truncate font-mono text-[11px] text-muted">
            sesión <span className="text-teal">{session}</span> · cuenta f2p
            {profileName ? <span> · perfil <span className="text-teal">{profileName}</span></span> : null}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 border border-edge px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-teal" /> archivos oficiales: encicl. + wiki
          </span>
          <button
            onClick={clearChat}
            disabled={busy || messages.length === 0}
            title="Reiniciar sesión"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-edge text-muted transition hover:border-ember/50 hover:text-ember disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4">
              <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Barra de datos: estado de la base + carga desde fuentes oficiales */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-edge bg-panel/60 px-4 py-2 font-mono text-[11px]">
        {llmOn === false && (
          <span
            className="flex items-center gap-1.5 rounded border border-ember/50 bg-ember/10 px-2 py-0.5 uppercase tracking-wider text-ember"
            title="Sin LLM configurado (LLM_BASE_URL + LLM_API_KEY en el .env). El coach solo puede 'informar', no recomendar ni conversar."
          >
            sin llm · solo informa
          </span>
        )}
        <span className="flex items-center gap-1.5 text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${dbChunks === null ? "bg-ember" : "bg-teal"}`} />
          base: <span className="text-paper">{dbChunks ?? "?"}</span> fragmentos
        </span>
        <span className="text-edge">|</span>
        <button
          onClick={() => void runIngest("cargo")}
          disabled={ingesting}
          title="Extrae TODO del Cargo de la wiki: items, recetas, monstruos, hechizos, quests, mazmorras, drops…"
          className="rounded border border-teal/40 px-1.5 py-0.5 uppercase tracking-wider text-muted transition hover:border-teal/70 hover:text-teal disabled:opacity-40"
        >
          + cargo (todo)
        </button>
        <button
          onClick={() => setShowProfile((v) => !v)}
          className={`rounded border px-1.5 py-0.5 uppercase tracking-wider transition ${showProfile ? "border-teal/60 text-teal" : "border-edge text-muted hover:border-teal/50 hover:text-teal"}`}
          title="Tu perfil de juego (nivel, clase, elemento…) — el coach lo usa para adaptar el consejo"
        >
          perfil
        </button>
        {ingestMsg && (
          <span className={`ml-auto truncate text-right ${ingestMsg.startsWith("no") || ingestMsg.startsWith("error") ? "text-ember" : "text-teal"}`}>
            {ingestMsg}
          </span>
        )}
      </div>

      {/* Perfil de la jugadora */}
      {showProfile && (
        <div className="border-b border-edge bg-panel/60 px-4 py-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">
            Perfil de la jugadora — el coach adapta todo el consejo a esto y lo recuerda entre mensajes
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PROFILE_FIELDS.map((f) => (
              <label key={f} className="block">
                <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-wider text-muted">{f}</span>
                <input
                  value={profile.find((p) => p.key === f)?.value ?? ""}
                  onChange={(e) => setProfileField(f, e.target.value)}
                  className="w-full rounded border border-edge bg-panel-2 px-2 py-1.5 font-mono text-xs text-paper outline-none transition focus:border-teal/60"
                  placeholder={PROFILE_PLACEHOLDERS[f] ?? ""}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <div>
              <p className="font-mono text-lg font-bold uppercase tracking-widest text-paper">
                Conectando… <span className="text-teal">_</span>
              </p>
              <p className="mt-1 text-sm text-muted">
                Hola{profileName ? `, ${profileName}` : ""} — pregúntame por builds, recetas, farming o eficiencia para tu cuenta sin abono.
              </p>
            </div>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={busy}
                  className="rounded-md border border-edge bg-panel-2 px-3 py-1.5 font-mono text-xs text-muted transition hover:border-teal/50 hover:text-teal disabled:opacity-50"
                >
                  &gt; {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const strict = m.role === "assistant" && m.mode === "strict";
          return (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[92%] rounded-lg px-4 py-3 text-sm sm:max-w-[85%] ${
                  m.role === "user"
                    ? "rounded-tr-none border border-teal/30 bg-teal-dim/20 text-paper"
                    : strict
                      ? "rounded-tl-none border border-ember/50 bg-ember/[0.07] text-paper"
                      : "rounded-tl-none border border-edge bg-panel-2 text-paper"
                }`}
              >
                {m.role === "user" ? (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <>
                    {strict && (
                      <span className="mb-2 inline-flex items-center gap-1.5 rounded border border-ember/50 bg-ember/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-ember">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                          <path d="M12 8v4M12 16h.01" />
                          <circle cx="12" cy="12" r="9" />
                        </svg>
                        sin registro oficial
                      </span>
                    )}
                    <Markdown text={m.content} />
                    {m.entities && m.entities.length > 0 && <EntityCards entities={m.entities} />}
                    {m.sources && m.sources.length > 0 && (
                      <div className="mt-3 border-t border-edge pt-2.5">
                        <p className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
                          Fuentes ({m.sources.length}){m.mode === "extractive" ? " · respuesta extractiva" : m.mode === "llm" ? " · llm local" : ""}
                        </p>
                        <ul className="space-y-1">
                          {m.sources.map((s: ChatSource, j) => (
                            <li key={j} className="flex items-center gap-2 text-xs">
                              <span className="rounded bg-teal/10 px-1.5 py-0.5 font-mono text-teal">
                                {SOURCE_LABEL[s.sourceType] ?? s.sourceType}
                              </span>
                              {s.url ? (
                                <a
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="truncate text-muted underline-offset-2 hover:text-teal hover:underline"
                                >
                                  {s.title}
                                </a>
                              ) : (
                                <span className="truncate text-muted">{s.title}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-lg rounded-tl-none border border-edge bg-panel-2 px-4 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-teal" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-teal [animation-delay:120ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-teal [animation-delay:240ms]" />
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 font-mono text-xs text-ember">{error}</p>
          </div>
        )}
      </div>

      {/* Entrada — prompt estilo terminal */}
      <form
        className="border-t border-edge bg-ink/40 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
              adjuntadas ({images.length}/{MAX_IMAGES})
            </span>
            {images.map((src, i) => (
              <div key={i} className="group relative h-16 w-16 overflow-hidden rounded-md border border-teal/40 bg-panel-2">
                <img src={src} alt={`captura ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  title="Quitar imagen"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/80 text-[10px] text-ember opacity-0 transition group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <span className="hidden pb-2.5 font-mono text-teal sm:block">$</span>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            onPaste={onPaste}
            rows={1}
            placeholder="consulta ›  (Enter envía · Shift+Enter salto · Ctrl+V pega captura)"
            className="max-h-40 flex-1 resize-none rounded-md border border-edge bg-panel-2 px-3.5 py-2.5 font-mono text-sm text-paper outline-none transition placeholder:text-muted/60 focus:border-teal/60"
          />
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={onPickImages} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || images.length >= MAX_IMAGES}
            title="Adjuntar captura del juego (visión)"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-edge text-muted transition hover:border-teal/50 hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="9" cy="10" r="1.5" />
              <path d="m5 17 4.5-4.5a1 1 0 0 1 1.4 0L15 16.5M13 14l2-2a1 1 0 0 1 1.4 0L19 15" />
            </svg>
          </button>
          <button
            type="submit"
            disabled={busy || (!input.trim() && images.length === 0)}
            className="rounded-md border border-teal/60 bg-teal/15 px-4 py-2.5 font-mono text-sm font-semibold text-teal transition hover:bg-teal/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            [ejecutar]
          </button>
        </div>
      </form>
    </div>
  );
}
