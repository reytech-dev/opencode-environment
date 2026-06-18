#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# --------------------------------------------------------------------
# Output helpers
# --------------------------------------------------------------------

log_info()    { printf '  %s\n' "$*"; }
log_success() { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
log_warn()    { printf '\033[0;33m  ! %s\033[0m\n' "$*" >&2; }
log_error()   { printf '\033[0;31m  ✗ %s\033[0m\n' "$*" >&2; }
fail()        { log_error "$*"; exit 1; }

# --------------------------------------------------------------------
# Main
# --------------------------------------------------------------------

main() {
    cd "$REPO_ROOT"

    local force=false
    if [[ "${1:-}" == "--force" ]]; then
        force=true
    fi

    echo
    log_info "opencode-environment cleanup"
    echo

    local items=(
        "install.sh"
        ".git/"
        "LICENSE"
        "CHANGELOG.md"
        ".github/"
        ".releaserc.yml"
        "commitlint.config.cjs"
        "package.json"
        "package-lock.json"
        "node_modules/"
    )

    log_info "The following bootstrap artifacts will be removed:"
    echo
    for item in "${items[@]}"; do
        if [[ -e "$item" ]]; then
            printf '    %s\n' "$item"
        fi
    done
    echo

    # Confirmation
    local interactive=false
    [[ -t 1 ]] && [[ -e /dev/tty ]] && interactive=true

    if $interactive; then
        printf '  Remove these bootstrap artifacts? [y/N]: ' > /dev/tty
        read -r answer < /dev/tty
        if [[ "$answer" != "y" ]] && [[ "$answer" != "Y" ]]; then
            log_info "Cleanup cancelled."
            echo
            exit 0
        fi
    elif ! $force; then
        log_info "Non-interactive mode — use --force to remove without confirmation:"
        echo
        log_info "  ./bin/oe cleanup --force"
        echo
        exit 0
    fi

    echo

    local removed=0
    local failed=0
    for item in "${items[@]}"; do
        if [[ -e "$item" ]]; then
            if rm -rf "$item" 2>/dev/null; then
                log_success "Removed $item"
                removed=$((removed + 1))
            else
                log_warn "Could not remove $item (permission denied)"
                failed=$((failed + 1))
            fi
        fi
    done

    echo
    if [[ $failed -gt 0 ]]; then
        log_warn "Cleanup complete — removed $removed artifacts, $failed could not be removed (check permissions)."
    else
        log_success "Cleanup complete — removed $removed bootstrap artifacts."
    fi
    echo
    log_info "Next:"
    log_info "  git init && git add -A && git commit -m \"Initial workbench\""
    log_info "  ./bin/oe doctor"
    echo
}

main "$@"
