FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV ENVSHARE_MODE=self-hosted
ENV MAX_FILE_SIZE_MB=100
ENV DATA_DIR=/app/data
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN mkdir -p /app/data/meta /app/data/blobs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server.js"]
