# Use Bun slim image for the builder stage
FROM oven/bun:slim AS builder

WORKDIR /app

# Install dependencies with Bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build application
COPY . .
RUN bun run build

# Use Bun slim image for runtime stage
FROM oven/bun:slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy built server/client assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/docker-server.mjs ./docker-server.mjs

EXPOSE 5000

CMD ["bun", "docker-server.mjs"]
