# --- Build-Stage ---
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY index.html ./
COPY src ./src
COPY public ./public

RUN npm run build

# --- Runtime-Stage (nginx) ---
FROM nginx:alpine

# Standard nginx-HTML-Ordner leeren und unsere Files reinkopieren
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

# Optional: eigenes nginx.conf spaeter
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
