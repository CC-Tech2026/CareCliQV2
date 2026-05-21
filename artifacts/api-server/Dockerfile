# API Server Dockerfile
FROM node:22-bullseye-slim AS base
WORKDIR /workspace

# Enable pnpm and install dependencies using the root workspace lockfile.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

ENV npm_config_user_agent=pnpm/

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /workspace/artifacts/api-server
RUN pnpm run build

EXPOSE 8000
ENV PORT=8000
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
