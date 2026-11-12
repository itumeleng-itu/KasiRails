# Kasi Rails API server (apps/server), e.g. for Railway.
# Installs only the server workspace and the shared package, not the Expo app.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Manifests first so dependency installs are cached between code changes.
# All workspace manifests are copied so the lockfile matches; only the server's deps are installed.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/customer/package.json apps/customer/
RUN npm ci --workspace @kasi-rails/server --omit=dev --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/server apps/server

# Railway sets PORT; the server reads it (default 3000).
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "apps/server/src/index.ts"]
