FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG EXPO_PUBLIC_API_URL=http://localhost:8000
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=1 \
    EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL

RUN corepack enable

COPY . .

RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @workspace/mobile exec expo export --platform web --output-dir dist

FROM nginx:1.27-alpine

COPY artifacts/mobile/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/mobile/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
