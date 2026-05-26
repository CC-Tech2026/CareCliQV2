FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV BASE_PATH=/ \
    PORT=3000

RUN corepack enable

COPY . .

RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @workspace/frontend run build

FROM nginx:1.27-alpine

COPY artifacts/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/frontend/dist/public /usr/share/nginx/html

EXPOSE 80
