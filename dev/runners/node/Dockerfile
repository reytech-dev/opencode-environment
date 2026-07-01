FROM node:22-bookworm

ARG PNPM_VERSION=11.5.2

USER root

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates rsync && rm -rf /var/lib/apt/lists/*

RUN corepack disable || true \
  && rm -f /usr/local/bin/pnpm /usr/local/bin/pnpx \
  && npm install -g --force "pnpm@${PNPM_VERSION}" \
  && rm -f /usr/local/bin/pnpm /usr/local/bin/pnpx \
  && printf '#!/bin/sh\nexec node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs "$@"\n' > /usr/local/bin/pnpm \
  && printf '#!/bin/sh\nexec node /usr/local/lib/node_modules/pnpm/bin/pnpx.cjs "$@"\n' > /usr/local/bin/pnpx \
  && chmod +x /usr/local/bin/pnpm /usr/local/bin/pnpx \
  && pnpm --version

USER node
WORKDIR /workspace