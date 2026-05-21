# Frontend Dockerfile
FROM node:22-bullseye-slim AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

ENV npm_config_user_agent=pnpm/

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY . .
RUN pnpm install --frozen-lockfile

ARG BASE_PATH=/
ARG PORT=4173
ENV BASE_PATH=${BASE_PATH}
ENV PORT=${PORT}
WORKDIR /workspace/artifacts/frontend
RUN BASE_PATH=${BASE_PATH} pnpm run build

FROM nginx:stable-alpine AS runtime
COPY --from=builder /workspace/artifacts/frontend/dist/public /usr/share/nginx/html
COPY artifacts/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
