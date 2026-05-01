#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/bootstrap_xlotyl_contract_env.sh [--no-install] [--no-build] [--skip-bun]

Bootstraps the local Stoneforge + XLOTYL contract test toolchain.

Defaults assume this layout:

  XLOTYL/
    .local/       generated shared tool/env/cache state
    xlotyl/       XLOTYL/xlotyl checkout
    stoneforge/   this repository

Environment overrides:
  XLOTYL_WORKSPACE_ROOT  Parent workspace root; default is the parent of this repo.
  XLOTYL_REPO_ROOT       XLOTYL checkout; default is $XLOTYL_WORKSPACE_ROOT/xlotyl.
  XLOTYL_LOCAL_ROOT      Shared generated state root; default is $XLOTYL_WORKSPACE_ROOT/.local.
  XLOTYL_NODE_VERSION    Local Node version; default is 22.22.2.

Generated env:
  $XLOTYL_LOCAL_ROOT/env/xlotyl-stoneforge-contract.env
USAGE
}

log() {
  printf '[stoneforge-contract-env] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'error: required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

run_install=1
run_build=1
install_bun=1
NODE_VERSION="${XLOTYL_NODE_VERSION:-22.22.2}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --no-install)
      run_install=0
      shift
      ;;
    --no-build)
      run_build=0
      shift
      ;;
    --skip-bun)
      install_bun=0
      shift
      ;;
    *)
      printf 'error: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="${XLOTYL_WORKSPACE_ROOT:-$(cd -- "$REPO_ROOT/.." && pwd)}"
LOCAL_ROOT="${XLOTYL_LOCAL_ROOT:-$WORKSPACE_ROOT/.local}"
XLOTYL_ROOT="${XLOTYL_REPO_ROOT:-$WORKSPACE_ROOT/xlotyl}"

ENV_DIR="$LOCAL_ROOT/env"
ENV_FILE="$ENV_DIR/xlotyl-stoneforge-contract.env"
NODE_LINK="$LOCAL_ROOT/node"
NPM_PREFIX="$LOCAL_ROOT/npm-global"
NPM_CACHE="$LOCAL_ROOT/npm-cache"
PNPM_STORE="$LOCAL_ROOT/pnpm-store"
BUN_INSTALL_DIR="$LOCAL_ROOT/bun"
BUN_BIN="$BUN_INSTALL_DIR/bin/bun"
NODE_TOOL_BIN="$NPM_PREFIX/node_modules/.bin"
NPM_BIN="$NODE_TOOL_BIN/npm"
PNPM_BIN="$NODE_TOOL_BIN/pnpm"

node_platform() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *)
      printf 'error: unsupported OS for local Node install: %s\n' "$(uname -s)" >&2
      exit 1
      ;;
  esac
}

node_arch() {
  case "$(uname -m)" in
    arm64|aarch64) printf 'arm64' ;;
    x86_64|amd64) printf 'x64' ;;
    *)
      printf 'error: unsupported architecture for local Node install: %s\n' "$(uname -m)" >&2
      exit 1
      ;;
  esac
}

install_node() {
  local platform arch node_dir archive url tmp_dir
  platform="$(node_platform)"
  arch="$(node_arch)"
  node_dir="$LOCAL_ROOT/node-v$NODE_VERSION-$platform-$arch"

  if [[ -x "$node_dir/bin/node" ]]; then
    ln -sfn "$node_dir" "$NODE_LINK"
    return
  fi

  require_cmd curl
  require_cmd tar
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/xlotyl-node.XXXXXX")"
  archive="$tmp_dir/node.tar.xz"
  url="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$platform-$arch.tar.xz"
  log "Installing Node v$NODE_VERSION under $node_dir"
  curl -fsSL "$url" -o "$archive"
  mkdir -p "$LOCAL_ROOT"
  tar -xJf "$archive" -C "$tmp_dir"
  rm -rf "$node_dir"
  mv "$tmp_dir/node-v$NODE_VERSION-$platform-$arch" "$node_dir"
  ln -sfn "$node_dir" "$NODE_LINK"
  rm -rf "$tmp_dir"
}

if [[ "$run_install" -eq 1 ]]; then
  install_node
elif [[ ! -x "$NODE_LINK/bin/node" ]]; then
  require_cmd node
  NODE_LINK="$(cd -- "$(dirname -- "$(command -v node)")/.." && pwd)"
fi

NODE_BIN_DIR="$NODE_LINK/bin"
NODE_BIN="$NODE_BIN_DIR/node"
export PATH="$NODE_BIN_DIR:$NODE_TOOL_BIN:$BUN_INSTALL_DIR/bin:$PATH"

if [[ ! -x "$NODE_BIN" ]]; then
  printf 'error: Node binary not found at %s\n' "$NODE_BIN" >&2
  exit 1
fi

PNPM_VERSION="$(
  REPO_ROOT="$REPO_ROOT" "$NODE_BIN" -e 'const pm=require(process.env.REPO_ROOT + "/package.json").packageManager || "pnpm@8.15.5"; console.log(pm.startsWith("pnpm@") ? pm.slice(5) : "8.15.5")'
)"
NPM_VERSION="$(
  XLOTYL_ROOT="$XLOTYL_ROOT" "$NODE_BIN" -e 'try { const pm=require(process.env.XLOTYL_ROOT + "/package.json").packageManager || "npm@latest"; console.log(pm.startsWith("npm@") ? pm.slice(4) : "latest") } catch { console.log("latest") }'
)"

mkdir -p "$ENV_DIR" "$NPM_PREFIX" "$NPM_CACHE" "$PNPM_STORE" "$BUN_INSTALL_DIR"

export NPM_CONFIG_CACHE="$NPM_CACHE"
if [[ "$run_install" -eq 1 ]]; then
  log "Using Node $("$NODE_BIN" --version) at $NODE_BIN"
  log "Installing npm@$NPM_VERSION and pnpm@$PNPM_VERSION under $NPM_PREFIX"
  "$NODE_BIN_DIR/npm" install --prefix "$NPM_PREFIX" "npm@$NPM_VERSION" "pnpm@$PNPM_VERSION"

  if [[ "$install_bun" -eq 1 && ! -x "$BUN_BIN" ]]; then
    require_cmd curl
    log "Installing Bun under $BUN_INSTALL_DIR"
    curl -fsSL https://bun.sh/install | BUN_INSTALL="$BUN_INSTALL_DIR" SHELL=/usr/bin/false bash
  elif [[ -x "$BUN_BIN" ]]; then
    log "Using Bun at $BUN_BIN"
  fi

  log "Installing Stoneforge pnpm workspace dependencies into $REPO_ROOT/node_modules"
  (cd "$REPO_ROOT" && "$PNPM_BIN" install --frozen-lockfile --store-dir "$PNPM_STORE")
  log "Rebuilding Stoneforge native modules for $("$NODE_BIN" --version)"
  (cd "$REPO_ROOT" && "$PNPM_BIN" rebuild better-sqlite3 node-pty --store-dir "$PNPM_STORE")

  if [[ -d "$XLOTYL_ROOT" && -f "$XLOTYL_ROOT/package-lock.json" ]]; then
    log "Installing XLOTYL npm workspace dependencies into $XLOTYL_ROOT/node_modules"
    (cd "$XLOTYL_ROOT" && "$NPM_BIN" ci)
  else
    log "XLOTYL checkout not found at $XLOTYL_ROOT; set XLOTYL_REPO_ROOT to build the decision provider"
  fi
fi

if [[ "$run_build" -eq 1 ]]; then
  log "Building Stoneforge Smithy sf.js"
  (cd "$REPO_ROOT" && "$PNPM_BIN" turbo run build --filter=@stoneforge/smithy)

  if [[ -d "$XLOTYL_ROOT" && -f "$XLOTYL_ROOT/package.json" ]]; then
    log "Building @xlotyl/core-dev-services"
    (cd "$XLOTYL_ROOT" && "$NPM_BIN" run build -w @xlotyl/core-dev-services)
  fi
fi

{
  printf '# Generated by %s\n' "$0"
  printf 'export XLOTYL_WORKSPACE_ROOT=%q\n' "$WORKSPACE_ROOT"
  printf 'export XLOTYL_REPO_ROOT=%q\n' "$XLOTYL_ROOT"
  printf 'export STONEFORGE_REPO_ROOT=%q\n' "$REPO_ROOT"
  printf 'export XLOTYL_LOCAL_ROOT=%q\n' "$LOCAL_ROOT"
  printf 'export XLOTYL_NODE_VERSION=%q\n' "$NODE_VERSION"
  printf 'export XLOTYL_NODE_BIN=%q\n' "$NODE_BIN"
  printf 'export NPM_CONFIG_CACHE=%q\n' "$NPM_CACHE"
  printf 'export NPM_CONFIG_PREFIX=%q\n' "$NPM_PREFIX"
  printf 'export PNPM_STORE_DIR=%q\n' "$PNPM_STORE"
  printf 'export BUN_INSTALL=%q\n' "$BUN_INSTALL_DIR"
  printf 'export STONEFORGE_SF_BIN=%q\n' "$REPO_ROOT/packages/smithy/dist/bin/sf.js"
  printf 'export XLOTYL_DECISION_MODULE=%q\n' "$XLOTYL_ROOT/services/core-dev-services/dist/stoneforge/daemon-decision.js"
  printf 'export PATH=%q:%q:%q:"$PATH"\n' "$NODE_BIN_DIR" "$NODE_TOOL_BIN" "$BUN_INSTALL_DIR/bin"
} > "$ENV_FILE"

log "Wrote $ENV_FILE"
log "Run: source $ENV_FILE"
log "Then: pnpm --filter @stoneforge/smithy test:xlotyl-daemon-decision"
