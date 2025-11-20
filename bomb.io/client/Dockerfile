# --- Build-Stage ---
FROM node:22-alpine AS build

WORKDIR /app

# Nur package-Dateien zuerst (Caching)
COPY package*.json ./
RUN npm ci

# Alle TS-Konfigs kopieren
COPY tsconfig*.json ./
COPY vite.config.* ./
COPY index.html ./
COPY src ./src
COPY public ./public

# Build ausfuehren
RUN npm run build

# --- Runtime-Stage (nginx) ---
FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
