# --- Build-Stage ---
FROM node:22-alpine AS build

WORKDIR /app

# Nur package-Dateien zuerst (Caching)
COPY package*.json ./
RUN npm ci

# Restliche Files
COPY tsconfig.json ./
COPY src ./src

# TypeScript build
RUN npm run build

# --- Runtime-Stage ---
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Nur prod-Dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Gebauten Code aus Build-Stage
COPY --from=build /app/dist ./dist

EXPOSE 3001

CMD ["node", "dist/index.js"]
