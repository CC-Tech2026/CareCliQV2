FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG VITE_DEV_CONSOLE_PASSWORD=
ARG SUPABASE_URL=
ARG SUPABASE_ANON_KEY=
ARG SUPABASE_REGION=ap-southeast-2
ARG SUPABASE_REGION_CHECK=enabled
ENV BASE_PATH=/ \
    PORT=3000 \
    VITE_DEV_CONSOLE_PASSWORD=$VITE_DEV_CONSOLE_PASSWORD \
    SUPABASE_URL=$SUPABASE_URL \
    SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY \
    SUPABASE_REGION=$SUPABASE_REGION \
    SUPABASE_REGION_CHECK=$SUPABASE_REGION_CHECK

RUN corepack enable

COPY . .

RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @workspace/frontend run build

FROM nginx:1.27-alpine

COPY artifacts/frontend/nginx.conf /etc/nginx/conf.d/default.conf.template
COPY --from=build /app/artifacts/frontend/dist/public /usr/share/nginx/html

ENV BACKEND_URL=http://backend:8000 \
    PORT=80

EXPOSE 80

CMD ["/bin/sh", "-c", "envsubst '${BACKEND_URL} ${PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
