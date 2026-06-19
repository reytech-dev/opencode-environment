FROM node:22-bookworm

RUN corepack enable

ARG OPENCODE_VERSION=1.16.2
ARG SPECKIT_VERSION="v0.11.2"

ENV NON_ROOT_USERNAME="node"
ENV HOME="/home/${NON_ROOT_USERNAME}"
ENV NPM_CONFIG_PREFIX="${HOME}/.npm-global"
ENV NPM_CONFIG_CACHE="${HOME}/.npm-cache"
ENV PATH="${HOME}/.npm-global/bin:${HOME}/.npm-global/lib/node_modules/opencode-ai/bin:${HOME}/.local/bin:${PATH}"
ENV OPENCODE_VERSION="${OPENCODE_VERSION}"
ENV OPENCODE_STORAGE="$HOME/.local/share/opencode"
ENV OPENCODE_CONFIG_DIR="$HOME/.config/opencode"

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    git \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    docker-ce-cli \
    docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

# Install Opencode
RUN mkdir -p "${HOME}/.npm-global" "${HOME}/.npm-cache" && \
    npm install -g "opencode-ai@${OPENCODE_VERSION}"

# Create session storage for opencode
RUN mkdir -p "${OPENCODE_STORAGE}" "${OPENCODE_CONFIG_DIR}" && \
  chown -R "${NON_ROOT_USERNAME}:${NON_ROOT_USERNAME}" "${HOME}"

WORKDIR /workspace

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.11.22 /uv /uvx /bin/

COPY dev/runners/opencode/entrypoint.sh /usr/local/bin/opencode-entrypoint.sh
RUN chmod +x /usr/local/bin/opencode-entrypoint.sh

USER "${NON_ROOT_USERNAME}"
RUN /bin/uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@${SPECKIT_VERSION}

ENTRYPOINT ["/usr/local/bin/opencode-entrypoint.sh"]
CMD ["sleep", "infinity"]