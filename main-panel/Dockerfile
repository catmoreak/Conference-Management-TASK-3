FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY . /tmp/src
RUN if [ -f /tmp/src/main-panel/package.json ]; then cp -a /tmp/src/main-panel/. /app/; else cp -a /tmp/src/. /app/; fi
RUN npm install --include=optional --no-audit --no-fund

FROM node:20-bookworm-slim AS builder
WORKDIR /app

ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app /app
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["npm", "run", "start"]
