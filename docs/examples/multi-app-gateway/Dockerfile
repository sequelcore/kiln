FROM oven/bun:1.4.0-alpine

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY . .

# Persistent storage for tenant configs and memory databases
VOLUME /root/.kiln/gateway

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["bun", "run", "server.ts"]
