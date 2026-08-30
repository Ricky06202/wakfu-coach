# ---------- Etapa 1: build (deps + compilación) ----------
FROM node:20-alpine AS build
WORKDIR /app

# Herramientas de compilación nativa (better-sqlite3 sobre alpine/musl)
RUN apk add --no-cache python3 make g++

# Instalación con cache de capa: solo manifiestos primero
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY frontend/package.json ./frontend/
RUN npm ci --no-audit --no-fund

# Fuente y build (API: tsc -> server/dist · UI: astro -> frontend/dist)
COPY . .
RUN npm run build

# Podar devDependencies (runtime sin toolchain)
RUN npm prune --omit=dev --no-audit --no-fund

# ---------- Etapa 2: runtime (imagen mínima) ----------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/wakfu.db \
    AUTO_SEED=true

# Solo lo necesario para ejecutar
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/frontend/dist ./frontend/dist

# Directorio de la base (montado como volume)
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1);console.log('ok')}).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
