# --- Build-Stage ---
FROM node:22-alpine AS build

WORKDIR /app

# 1. Nur package-Dateien fuer Cache
COPY package*.json ./
RUN npm ci

# 2. TS-Konfiguration & Build-Dateien
COPY tsconfig*.json ./
COPY vite.config.* ./
COPY index.html ./
COPY src ./src
COPY public ./public

# 3. Build
RUN npm run build

# --- Runtime-Stage (nginx) ---
FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 81

CMD ["nginx", "-g", "daemon off;"]
