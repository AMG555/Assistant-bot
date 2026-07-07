FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      fontconfig \
      fonts-dejavu-core \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY dist ./dist

ENV NODE_ENV=production
EXPOSE 10000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT:-10000}/healthz || exit 1

CMD ["node", "dist/server.js"]