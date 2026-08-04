FROM dhi.io/bun:1.3.14-dev AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

ARG SITE_URL=http://localhost
ARG PUBLIC_API_URL=""
ARG DEV_MODE=false
ARG PUBLIC_UMAMI_WEBSITE_ID=""
ARG PUBLIC_UMAMI_SRC="/u/script.js"
ENV SITE_URL=$SITE_URL
ENV PUBLIC_API_URL=$PUBLIC_API_URL
ENV PUBLIC_UMAMI_WEBSITE_ID=$PUBLIC_UMAMI_WEBSITE_ID
ENV PUBLIC_UMAMI_SRC=$PUBLIC_UMAMI_SRC
RUN if [ "$DEV_MODE" = "true" ]; then NODE_ENV=development bun run build; else bun run build; fi

FROM dhi.io/nginx:1-alpine3.21 AS production

LABEL org.opencontainers.image.source=https://github.com/hadestructhor/canireplaceit
LABEL org.opencontainers.image.description="canireplaceit frontend"

COPY apps/frontend/front.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

EXPOSE 80
