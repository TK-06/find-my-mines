# ── build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Copy manifests first so dependency install caches independently of source.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

COPY . .
RUN npm run build

# ── runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# The server runs TypeScript directly through tsx, so the toolchain stays in
# the image. For a course project that trade-off buys a much simpler build
# than emitting JS and rewiring the workspace import paths.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages

EXPOSE 3000

# The client bundle is served from the same origin, so this one port covers
# the game, the server console and the websocket.
CMD ["npm", "run", "start"]
