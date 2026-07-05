#!/usr/bin/env bash
set -euo pipefail

SENTINEL="${HOME}/.local/share/opencode/.specify-initialized"

if [[ ! -f "$SENTINEL" ]]; then
    echo "First-time init: running specify init in /project..."
    cd /project
    specify init --here --integration opencode --script sh --force
    specify extension add --from https://github.com/reytech-dev/spec-kit-draft/archive/refs/tags/v1.2.0.zip spec-kit-draft
    specify extension add --from https://github.com/reytech-dev/spec-kit-open-design/archive/refs/tags/v1.3.0.zip spec-kit-open-design
    specify extension add --from https://github.com/reytech-dev/spec-kit-workspace-map/archive/refs/tags/v1.0.0.zip spec-kit-workspace-map
    specify extension add --from https://github.com/reytech-dev/spec-kit-workspace-materialize/archive/refs/tags/v1.0.2.zip spec-kit-workspace-materialize
    specify extension add --from https://github.com/reytech-dev/spec-kit-design-frontend/archive/refs/tags/v1.0.0.zip spec-kit-design-frontend
    git init /project -b main
    touch "$SENTINEL"
    echo "Init complete."
fi

exec "$@"
