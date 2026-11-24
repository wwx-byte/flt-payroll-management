FROM --platform=$BUILDPLATFORM node:26.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global "$(node -p 'require("./package.json").packageManager')" \
    && pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY src/ ./src/
COPY dist/ ./dist/
RUN pnpm build

FROM node:26.13.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8765 PAYROLL_DATA_DIR=/app/data
RUN install -d -m 0700 -o node -g node /app/data
COPY --from=build /app/.output/ ./.output/
COPY scripts/start.mjs ./scripts/start.mjs
USER node
EXPOSE 8765
CMD ["node", "scripts/start.mjs"]
