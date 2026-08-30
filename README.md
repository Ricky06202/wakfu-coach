# Wakfu Coach

Asistente **RAG** y coach personalizado para **Wakfu**, optimizado para cuenta **free-to-play**
y enfocado en la clase **Ninivix**: eficiencia de recursos, recetas, equipamiento y guías de la comunidad.

Stack: **Hono** (TypeScript / Node 20) · **Drizzle ORM** + **SQLite (FTS5)** · **Astro** + **React** · **Docker**.

## Arquitectura

```
wakfu-coach/
├── package.json            # workspaces (server + frontend)
├── Dockerfile              # multi-etapa (build frontend + build/prune server) -> runtime node:20-alpine
├── docker-compose.yml      # despliegue LAN, volumen ./data:/app/data
├── server/                 # API Hono + RAG + ingesta
│   ├── index.ts            # app Hono: POST /api/chat, GET /api/health, /api/search, estáticos
│   ├── env.ts              # configuración validada (zod) desde variables de entorno
│   ├── db.ts               # esquema Drizzle + cliente SQLite + init (FTS5, WAL, índices)
│   ├── rag.ts              # motor RAG: retrieve (FTS5 BM25 + boost léxico) + generate (Ollama o extractivo)
│   ├── seed-data.ts        # dataset de muestra embebido (Ninivix/F2P/objetos/recetas)
│   └── ingest/
│       ├── index.ts        # CLI de ingesta: `npm run ingest`
│       ├── encyclopedia.ts # scraper de la Enciclopedia Oficial (wakfu.com)
│       └── wiki.ts         # scraper MediaWiki de la Wiki Oficial (wakfu.wiki.gg)
├── frontend/               # Astro (SSG) + isla React de chat
│   └── src/pages/index.astro
└── data/                   # persistencia SQLite (volume Docker ./data:/app/data)
```

## Flujo RAG

1. `POST /api/chat` recibe **todos los mensajes previos** de la sesión (historial), manteniendo
   el contexto de la conversación.
2. `rag.retrieve()` consulta **FTS5** (BM25, OR de tokens normalizados) + coincidencia léxica
   sobre la tabla `chunks`, con **boost** si la consulta menciona tags relevantes
   (`ninivix`, `f2p`, `elementos`…).
3. `rag.lookupEntities()` detecta si la consulta pide una **ficha/receta concreta** y la busca
   en los archivos oficiales (objetos y recetas de SQLite, insensible a acentos).
4. **Puerta estricta anti-alucinación**: si se pide un objeto/receta concreto y **no** está
   registrado, responde `mode: "strict"` con *"No tengo registrado este objeto en los archivos
   oficiales"* — nunca inventa estadísticas ni recetas.
5. `rag.generate()` redacta la respuesta:
   - Si hay un LLM configurado (Ollama u OpenAI-compatible) → respuesta redactada con el contexto.
   - Si no → **modo extractivo** autocontenido.
6. La respuesta incluye `sources[]` (título, url, tipo) y `entities[]` (fichas/recetas estructuradas
   que el frontend renderiza como **tarjetas RPG** con rareza, stats e ingredientes).

El historial de la sesión se persiste en el navegador (`localStorage`) y se reenvía íntegro en cada
petición, de modo que la IA conserva el hilo de la charla incluso tras recargar la página.

## Visión (capturas de pantalla del juego)

Con un modelo **con visión** la jugadora puede **adjuntar capturas** (fichas de objeto, recetas,
inventario) desde el botón de la consola. El flujo:

1. El modelo de visión lee la captura y extrae el **nombre del objeto** (OCR).
2. El nombre se busca en los archivos oficiales (SQLite). Si no está registrado →
   respuesta `strict` ("No tengo registrado…") en vez de inventar stats.
3. Si está registrado → se adjunta la ficha oficial como contexto y el modelo responde
   contrastando la imagen con los datos oficiales.

> **DeepSeek y visión:** el endpoint nativo (`/chat/completions`) acepta el campo `image[]`
> pero **no procesa imágenes**. Para visión con DeepSeek usa el endpoint **Anthropic-compatible**:
> `LLM_BASE_URL=https://api.deepseek.com/anthropic` (el formato de imagen se autodetecta por la URL).
> Verificado: el modelo describe correctamente imágenes adjuntas en este endpoint.

> **Seguridad:** la API key solo se configura por **variable de entorno** (p.ej. `.env` del host o
> `docker-compose` con `env_file`). **Nunca** se versiona en el repo (que es público).

## Puesta en marcha

### Con Docker (NAS / red local)

```bash
docker compose up -d --build
# UI en http://<ip-nas>:3000 · health en /api/health
```

La base se auto-siembra con el dataset de muestra si está vacía (`AUTO_SEED=true`).
Para poblar con datos reales de la wiki/enciclopedia:

```bash
docker compose exec wakfu-coach node server/dist/ingest/index.js --wiki --encyclopedia
```

Persistencia: la base vive en `./data/wakfu.db` del host (volume `:/app/data`).

### Sin Docker (desarrollo)

```bash
npm install
npm run dev        # API en :3000 (Hono+tsx watch) · UI en :4321 (Astro, proxy /api)
npm run ingest     # ejecuta la ingesta manual (ver flags abajo)
```

## Endpoints

| Método | Ruta                    | Descripción                                      |
|--------|-------------------------|--------------------------------------------------|
| GET    | `/api/health`           | Estado + nº de fragmentos indexados              |
| GET    | `/api/search?q=&limit=` | Búsqueda cruda sobre la base de conocimiento     |
| POST   | `/api/chat`             | Chat RAG: `{ messages: [{role,content}] }` → `{ answer, mode, sources, entities }` |
| POST   | `/api/ingest/seed`      | Carga el dataset de muestra                      |

## Variables de entorno

| Variable           | Defecto                    | Descripción                                   |
|--------------------|----------------------------|-----------------------------------------------|
| `PORT`             | `3000`                     | Puerto HTTP                                   |
| `DB_PATH`          | `./data/wakfu.db`          | Ruta de la base SQLite (en Docker: `/app/data/wakfu.db`) |
| `AUTO_SEED`        | `true`                     | Siembra el dataset de muestra si la base está vacía |
| `OLLAMA_URL`       | *(vacío)*                  | URL de Ollama p.ej. `http://host.docker.internal:11434` |
| `OLLAMA_MODEL`     | `llama3.2:3b`              | Modelo usado en el modo LLM                    |
| `LLM_PROVIDER`     | `auto`                     | `auto` \| `ollama` \| `openai` \| `anthropic` |
| `LLM_BASE_URL`     | *(vacío)*                  | Endpoint del proveedor. Para visión con DeepSeek usa `https://api.deepseek.com/anthropic` |
| `LLM_API_KEY`      | *(vacío)*                  | API key del proveedor (**solo por entorno, nunca en el repo**) |
| `LLM_MODEL`        | `deepseek-chat`              | Modelo de conversación/coach (fuerte)          |
| `LLM_VISION_MODEL` | `deepseek-v4-flash-vision-exp` | Modelo de visión (solo para leer capturas)   |
| `LLM_API_STYLE`    | `auto`                     | `auto` \| `openai` \| `anthropic` (se autodetecta por la URL) |
| `LLM_IMAGE_API`    | `auto`                     | `auto` \| `openai` \| `deepseek` \| `anthropic` |
| `LLM_ANTHROPIC_VERSION` | `2023-06-01`          | Versión del header `anthropic-version`         |
| `LLM_MAX_IMAGES`   | `2`                        | Capturas máximas por mensaje                  |
| `LLM_MAX_IMAGE_MB` | `8`                        | Tamaño máximo por imagen                      |
| `TOP_K`            | `8`                        | Fragmentos recuperados por consulta            |
| `MAX_TOKENS`       | `1200`                     | Tokens máximos de respuesta LLM                |
| `ALLOWED_ORIGINS`  | *(vacío = todos)*          | Orígenes CORS permitidos (separados por coma)  |

## Ingesta

```bash
npm run ingest -- --seed            # dataset de muestra (determinista, offline)
npm run ingest -- --wiki ninivix    # guías de la Wiki Oficial (wakfu.wiki.gg)
npm run ingest -- --encyclopedia    # Enciclopedia Oficial (wakfu.com)
npm run ingest -- --wiki --encyclopedia --seed   # todo
```

> Los scrapers son best-effort: si una fuente no responde o cambia su HTML, el proceso
> lo notifica y continúa (la base nunca queda corrupta). El dataset de muestra garantiza
> que el asistente funcione sin red.

## Notas

- El repo es de carácter educativo; las fichas de muestra son resúmenes orientativos.
  La información de juego real procede de las fuentes oficiales al ejecutar la ingesta.
- `better-sqlite3` se compila en la etapa de build del Dockerfile (alpine/musl); no requiere
  runtime adicional.
