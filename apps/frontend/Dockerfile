# The runtime tag is pinned to this exact patch, not the floating `1-`, because
# an nginx dynamic module is refused by any nginx but the one it was built
# against — "version 1026003 instead of 1029004". Bumping it means bumping the
# base and the module source together, which is what this single ARG is for.
ARG NGINX_VERSION=1.29.4

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

# nginx has no brotli of its own — it is a third-party module, and the hardened
# base ships no package manager to install one with. Alpine packages it, but for
# its own nginx 1.26.3, so that .so will not load here either.
#
# Compiling it against the base's own nginx source is what keeps the hardened
# runtime. `--with-compat` is the flag that makes a module loadable into an
# nginx configured differently from the one it was built beside, and the base is
# itself built with it.
FROM alpine:3.21 AS brotli
ARG NGINX_VERSION
# Pinned to a commit: ngx_brotli has no usable release tag, so the alternative
# is building whatever is on master the morning of the deploy.
ARG NGX_BROTLI_REF=a71f9312c2deb28875acc7bacfdd5695a111aa53
RUN apk add --no-cache brotli-dev build-base curl git linux-headers openssl-dev pcre2-dev zlib-dev
WORKDIR /build
RUN curl -fsSL "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" | tar xz
RUN git init ngx_brotli \
	&& git -C ngx_brotli remote add origin https://github.com/google/ngx_brotli.git \
	&& git -C ngx_brotli fetch --depth 1 origin "$NGX_BROTLI_REF" \
	&& git -C ngx_brotli checkout -q FETCH_HEAD \
	&& git -C ngx_brotli submodule update --init --recursive --depth 1
RUN cd "nginx-${NGINX_VERSION}" \
	&& ./configure --with-compat --add-dynamic-module=../ngx_brotli \
	&& make -j"$(nproc)" modules

FROM dhi.io/nginx:${NGINX_VERSION}-alpine3.21 AS production
ARG NGINX_VERSION

LABEL org.opencontainers.image.source=https://github.com/hadestructhor/canireplaceit
LABEL org.opencontainers.image.description="canireplaceit frontend"

COPY --from=brotli /build/nginx-${NGINX_VERSION}/objs/ngx_http_brotli_filter_module.so /usr/lib/nginx/modules/
COPY --from=brotli /build/nginx-${NGINX_VERSION}/objs/ngx_http_brotli_static_module.so /usr/lib/nginx/modules/
# The static module only reads .br files off disk and needs nothing. The filter
# module is the one that compresses, and it links libbrotlienc dynamically, so
# the encoder has to come with it — same Alpine 3.21 and same musl as the base.
COPY --from=brotli /usr/lib/libbrotlienc.so.1 /usr/lib/libbrotlicommon.so.1 /usr/lib/
COPY apps/frontend/front.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

# `load_module` is a main-context directive and this base includes conf.d/
# inside `http`, with no main-context include anywhere. Passing it through
# `-g` in CMD does run the server, but nothing else inherits it: `nginx -t`
# and `nginx -s reload` both die with `unknown directive "brotli"`, so any
# healthcheck, CI gate or operator sees what looks like a broken config and a
# graceful reload is impossible. Prepending to nginx.conf puts it where every
# invocation reads it. UID 0 only for the edit, because this base has no `root`
# entry in passwd; the runtime user is unchanged. The pid file is removed after
# the check because `nginx -t` writes one as the building user, and nginx then
# cannot overwrite a root-owned pid file at startup.
USER 0
RUN printf 'load_module modules/ngx_http_brotli_filter_module.so;\nload_module modules/ngx_http_brotli_static_module.so;\n' > /tmp/m.conf \
 && cat /etc/nginx/nginx.conf >> /tmp/m.conf \
 && cat /tmp/m.conf > /etc/nginx/nginx.conf \
 && rm /tmp/m.conf \
 && nginx -t \
 && rm -f /var/run/nginx.pid
USER nginx

CMD ["-g", "daemon off;"]

EXPOSE 80
