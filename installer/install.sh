#!/bin/sh
# SDODS installer for macOS and Linux.
#
#   curl -fsSL https://sdods.com/install.sh | sh
#   curl -fsSL https://sdods.com/install.sh | sh -s -- --workspace ~/tests --mcp claude
#
# What it does: checks Node 22+, installs Bun into the SDODS home if needed, fetches SDODS
# (npm when published, otherwise a shallow git clone), installs dependencies and browser
# browsers, and writes an `sdods` shim on your PATH. Re-running upgrades in place.
#
# Nothing is written outside $SDODS_HOME (default ~/.sdods) and $BIN_DIR (default
# ~/.local/bin), and the shell rc file is only touched with --modify-path.
#
# Exit codes: 0 ok · 1 failed · 2 usage · 3 unsupported platform · 4 missing prerequisite
#             5 Node missing/too old · 6 download failed · 7 install failed · 8 permission denied
#
# Apache-2.0 · https://github.com/siri1410/SDODS

set -eu

SDODS_REPO_SLUG='siri1410/SDODS'
SDODS_REPO_URL="${SDODS_REPO_URL:-https://github.com/${SDODS_REPO_SLUG}.git}"
SDODS_API_URL="${SDODS_API_URL:-https://api.github.com/repos/${SDODS_REPO_SLUG}}"
SITE_URL='https://sdods.com'
DOCS_URL='https://docs.sdods.com'
NODE_MIN_MAJOR=22
BUN_VERSION_PIN='1.4.0'
INSTALLER_VERSION='1.0.0'

# ── options (every flag has an environment equivalent) ───────────────────────────────────────
SDODS_HOME="${SDODS_HOME:-${HOME:-/tmp}/.sdods}"
BIN_DIR="${SDODS_BIN_DIR:-}"
REF="${SDODS_VERSION:-}"
PM="${SDODS_PM:-}"
BROWSERS="${SDODS_BROWSERS:-chromium}"
WORKSPACE="${SDODS_WORKSPACE:-}"
SOURCE="${SDODS_SOURCE:-auto}"
MCP_CLIENTS="${SDODS_MCP:-}"
INSTALL_NODE="${SDODS_INSTALL_NODE:-0}"
MODIFY_PATH="${SDODS_MODIFY_PATH:-0}"
ASSUME_YES="${SDODS_YES:-0}"
VERBOSE="${SDODS_VERBOSE:-0}"
DO_UNINSTALL=0
DRY_RUN=0
VERSION_CHECK=0

TMP_DIR=''
NODE_BIN='node'
NPM_BIN='npm'
RESOLVED_REF=''
APP_DIR=''

# ── output ──────────────────────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
  C_RESET=$(printf '\033[0m'); C_DIM=$(printf '\033[2m'); C_BOLD=$(printf '\033[1m')
  C_RED=$(printf '\033[31m'); C_GREEN=$(printf '\033[32m'); C_YELLOW=$(printf '\033[33m')
  C_CYAN=$(printf '\033[36m')
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi

say() { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }
ok() { printf '%s✔%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
debug() { [ "$VERBOSE" = 1 ] && printf '%s   %s%s\n' "$C_DIM" "$*" "$C_RESET" >&2 || true; }
die() {
  code=$1; shift
  printf '%s✖%s %s\n' "$C_RED" "$C_RESET" "$1" >&2
  shift || true
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
  printf '  %sDocs: %s/docs/getting-started/installation/%s\n' "$C_DIM" "$DOCS_URL" "$C_RESET" >&2
  exit "$code"
}

cleanup() { [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ] && rm -rf "$TMP_DIR" || true; }
trap cleanup EXIT INT TERM

# Run a command, honouring --dry-run and --verbose. Output is hidden unless --verbose or the
# command fails, in which case the captured log is printed (the command never runs twice).
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would run: %s%s\n' "$C_DIM" "$*" "$C_RESET"
    return 0
  fi
  debug "run: $*"
  if [ "$VERBOSE" = 1 ]; then
    "$@"
    return $?
  fi
  log="${TMPDIR:-/tmp}/sdods-install-$$.log"
  if "$@" >"$log" 2>&1; then
    rm -f "$log"
    return 0
  fi
  status=$?
  printf '%s\n' "--- output of: $* ---" >&2
  tail -n 40 "$log" >&2 || true
  rm -f "$log"
  return $status
}

# Same, but always shows output (long steps where silence looks like a hang).
run_loud() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would run: %s%s\n' "$C_DIM" "$*" "$C_RESET"
    return 0
  fi
  debug "run: $*"
  "$@"
}

has() { command -v "$1" >/dev/null 2>&1; }

# First line of `cmd --version`, or "not installed". Never fails, never prints to stderr.
probe() {
  bin=$1; shift
  if has "$bin"; then
    out=$("$bin" "$@" 2>/dev/null | head -n 1 || true)
    [ -n "$out" ] && printf '%s' "$out" || printf 'installed'
  else
    printf 'not installed'
  fi
}

# Ask before something destructive. --yes skips it; with no terminal we refuse rather than guess.
confirm() {
  if [ "$ASSUME_YES" = 1 ]; then return 0; fi
  if [ -r /dev/tty ] && [ -t 1 ]; then
    printf '%s [y/N] ' "$1"
    read -r reply </dev/tty || return 1
    case "$reply" in [yY] | [yY][eE][sS]) return 0 ;; *) return 1 ;; esac
  fi
  warn 'No terminal to confirm on. Re-run with --yes to proceed non-interactively.'
  return 1
}

usage() {
  cat <<EOF
${C_BOLD}SDODS installer${C_RESET} ${C_DIM}v${INSTALLER_VERSION}${C_RESET}

  curl -fsSL ${SITE_URL}/install.sh | sh
  curl -fsSL ${SITE_URL}/install.sh | sh -s -- [options]

Options (environment equivalent in parentheses):
  --version <ref>       git tag, branch or commit to install (SDODS_VERSION)
  --dir <path>          install root, default \$HOME/.sdods (SDODS_HOME)
  --bin-dir <path>      where the sdods shim goes, default \$HOME/.local/bin (SDODS_BIN_DIR)
  --pm bun|pnpm|npm     package manager, default bun (SDODS_PM)
  --browsers all|chromium|none
                        browser engines to install, default chromium (SDODS_BROWSERS)
  --workspace <dir>     also scaffold a workspace there with 'sdods init' (SDODS_WORKSPACE)
  --source git|npm|auto how to fetch SDODS, default auto (SDODS_SOURCE)
  --mcp claude|codex|all
                        register the SDODS MCP server with those CLIs (SDODS_MCP)
  --install-node        install Node ${NODE_MIN_MAJOR} via fnm when missing or too old (SDODS_INSTALL_NODE=1)
  --modify-path         append the PATH export to your shell rc (SDODS_MODIFY_PATH=1)
  --yes                 never prompt; assumed when not a TTY or CI is set (SDODS_YES=1)
  --uninstall           remove the shim and the install root
  --dry-run             print what would happen, change nothing
  --verbose             show every command (SDODS_VERBOSE=1)
  --version-check       print resolved versions and paths, then exit
  --help                this message

Examples:
  curl -fsSL ${SITE_URL}/install.sh | sh -s -- --workspace ~/my-tests --mcp claude
  curl -fsSL ${SITE_URL}/install.sh | sh -s -- --version v0.2.0 --browsers all --modify-path
  curl -fsSL ${SITE_URL}/install.sh | sh -s -- --uninstall --yes

Honours HTTPS_PROXY / HTTP_PROXY / NO_PROXY and NO_COLOR.
EOF
}

# ── argument parsing ────────────────────────────────────────────────────────────────────────
need_value() { [ -n "${2:-}" ] || die 2 "$1 needs a value." "Run with --help for usage."; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version) need_value "$1" "${2:-}"; REF=$2; shift 2 ;;
    --version=*) REF=${1#*=}; shift ;;
    --dir) need_value "$1" "${2:-}"; SDODS_HOME=$2; shift 2 ;;
    --dir=*) SDODS_HOME=${1#*=}; shift ;;
    --bin-dir) need_value "$1" "${2:-}"; BIN_DIR=$2; shift 2 ;;
    --bin-dir=*) BIN_DIR=${1#*=}; shift ;;
    --pm) need_value "$1" "${2:-}"; PM=$2; shift 2 ;;
    --pm=*) PM=${1#*=}; shift ;;
    --browsers) need_value "$1" "${2:-}"; BROWSERS=$2; shift 2 ;;
    --browsers=*) BROWSERS=${1#*=}; shift ;;
    --workspace) need_value "$1" "${2:-}"; WORKSPACE=$2; shift 2 ;;
    --workspace=*) WORKSPACE=${1#*=}; shift ;;
    --source) need_value "$1" "${2:-}"; SOURCE=$2; shift 2 ;;
    --source=*) SOURCE=${1#*=}; shift ;;
    --mcp) need_value "$1" "${2:-}"; MCP_CLIENTS=$2; shift 2 ;;
    --mcp=*) MCP_CLIENTS=${1#*=}; shift ;;
    --install-node) INSTALL_NODE=1; shift ;;
    --modify-path) MODIFY_PATH=1; shift ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    --uninstall) DO_UNINSTALL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --verbose | -v) VERBOSE=1; shift ;;
    --version-check) VERSION_CHECK=1; shift ;;
    --help | -h) usage; exit 0 ;;
    *) die 2 "Unknown option: $1" "Run with --help for the option list." ;;
  esac
done

case "$PM" in '' | bun | pnpm | npm) ;; *) die 2 "--pm must be bun, pnpm or npm (got '$PM')." ;; esac
case "$BROWSERS" in all | chromium | none) ;; *) die 2 "--browsers must be all, chromium or none (got '$BROWSERS')." ;; esac
case "$SOURCE" in git | npm | auto) ;; *) die 2 "--source must be git, npm or auto (got '$SOURCE')." ;; esac
case "$MCP_CLIENTS" in '' | claude | codex | all) ;; *) die 2 "--mcp must be claude, codex or all (got '$MCP_CLIENTS')." ;; esac

case "$SDODS_HOME" in /*) ;; *) SDODS_HOME="$(pwd)/$SDODS_HOME" ;; esac
APP_DIR="$SDODS_HOME/app"

# ── platform detection ──────────────────────────────────────────────────────────────────────
detect_platform() {
  UNAME_S=$(uname -s 2>/dev/null || echo unknown)
  UNAME_M=$(uname -m 2>/dev/null || echo unknown)
  case "$UNAME_S" in
    Darwin) OS=macos ;;
    Linux) OS=linux ;;
    MINGW* | MSYS* | CYGWIN*)
      die 3 "This is Windows ($UNAME_S)." \
        "Use PowerShell instead:" \
        "  irm ${DOCS_URL}/install.ps1 | iex" \
        "Or install inside WSL, where this script works normally."
      ;;
    FreeBSD | OpenBSD | NetBSD)
      die 3 "$UNAME_S is not supported by the browser engines." \
        "You can still clone the repository and run API-layer tests."
      ;;
    *) die 3 "Unsupported operating system: $UNAME_S" ;;
  esac
  case "$UNAME_M" in
    x86_64 | amd64) ARCH=x64 ;;
    arm64 | aarch64) ARCH=arm64 ;;
    *) die 3 "Unsupported architecture: $UNAME_M" "SDODS needs x86_64 or arm64." ;;
  esac
  DISTRO=''
  if [ "$OS" = linux ] && [ -r /etc/os-release ]; then
    DISTRO=$(. /etc/os-release 2>/dev/null && printf '%s' "${ID:-}")
  fi
}

node_major() {
  v=$("$1" --version 2>/dev/null || printf 'v0')
  v=${v#v}
  printf '%s' "${v%%.*}"
}

node_fix_hint() {
  case "$OS:$DISTRO" in
    macos:*) say "  brew install node@${NODE_MIN_MAJOR}   (or: fnm install ${NODE_MIN_MAJOR} && fnm use ${NODE_MIN_MAJOR})" ;;
    linux:ubuntu | linux:debian) say "  curl -fsSL https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x | sudo -E bash - && sudo apt-get install -y nodejs" ;;
    linux:fedora | linux:rhel | linux:centos | linux:rocky | linux:almalinux) say "  sudo dnf module install nodejs:${NODE_MIN_MAJOR}/common" ;;
    linux:arch | linux:manjaro) say "  sudo pacman -S nodejs npm" ;;
    linux:alpine) say "  sudo apk add nodejs npm" ;;
    *) say "  Install Node ${NODE_MIN_MAJOR}+ from https://nodejs.org/en/download" ;;
  esac
  say "  Version managers: fnm (https://github.com/Schniz/fnm) or nvm (https://github.com/nvm-sh/nvm)"
  say "  Or re-run this installer with --install-node to set up fnm inside $SDODS_HOME"
}

install_node_with_fnm() {
  if has fnm; then
    step "Installing Node ${NODE_MIN_MAJOR} with fnm"
    run_loud fnm install "$NODE_MIN_MAJOR"
    FNM_DIR_LOCAL=$(fnm env --json 2>/dev/null | sed -n 's/.*"FNM_DIR"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' || true)
    eval "$(fnm env --shell bash 2>/dev/null || true)"
    fnm use "$NODE_MIN_MAJOR" >/dev/null 2>&1 || true
    debug "fnm dir: ${FNM_DIR_LOCAL:-unknown}"
  elif [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    step "Installing Node ${NODE_MIN_MAJOR} with nvm"
    # shellcheck disable=SC1091
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    run_loud nvm install "$NODE_MIN_MAJOR"
    nvm use "$NODE_MIN_MAJOR" >/dev/null 2>&1 || true
  else
    step "Installing fnm into $SDODS_HOME/.fnm"
    mkdir -p "$SDODS_HOME/.fnm"
    if ! curl -fsSL --proto '=https' --tlsv1.2 https://fnm.vercel.app/install |
      bash -s -- --install-dir "$SDODS_HOME/.fnm" --skip-shell >/dev/null 2>&1; then
      die 6 "Could not install fnm." "Install Node ${NODE_MIN_MAJOR}+ yourself, then re-run this installer."
    fi
    PATH="$SDODS_HOME/.fnm:$PATH"
    export PATH
    export FNM_DIR="$SDODS_HOME/.fnm"
    run_loud fnm install "$NODE_MIN_MAJOR"
    eval "$(fnm env --shell bash 2>/dev/null || true)"
    fnm use "$NODE_MIN_MAJOR" >/dev/null 2>&1 || true
    warn "fnm was installed inside $SDODS_HOME/.fnm. Add it to your shell to use node outside SDODS:"
    say "  export PATH=\"$SDODS_HOME/.fnm:\$PATH\" && eval \"\$(fnm env)\""
  fi
  has node || die 5 "Node is still not on PATH after installation." "Open a new shell and re-run the installer."
}

check_prerequisites() {
  if [ "$(id -u 2>/dev/null || echo 1000)" = 0 ] && [ "${SDODS_ALLOW_ROOT:-0}" != 1 ]; then
    die 8 "Refusing to install as root." \
      "Browsers and npm caches installed as root break for normal users." \
      "Re-run as your own user, or set SDODS_ALLOW_ROOT=1 if this is a container."
  fi
  has curl || has wget || die 4 "curl is required." "Install curl and re-run."
  if [ "$SOURCE" != npm ]; then
    has git || die 4 "git is required to install from source." \
      "macOS: xcode-select --install · Debian/Ubuntu: sudo apt-get install -y git"
  fi

  if ! has node; then
    if [ "$INSTALL_NODE" = 1 ]; then
      install_node_with_fnm
    else
      say ''
      warn "Node.js is not installed. SDODS needs Node ${NODE_MIN_MAJOR} or newer."
      node_fix_hint
      exit 5
    fi
  fi
  major=$(node_major node)
  if [ "$major" -lt "$NODE_MIN_MAJOR" ]; then
    if [ "$INSTALL_NODE" = 1 ]; then
      install_node_with_fnm
      major=$(node_major node)
      [ "$major" -ge "$NODE_MIN_MAJOR" ] || die 5 "Node is still v$major after installing."
    else
      say ''
      warn "Node v$major is too old. SDODS needs Node ${NODE_MIN_MAJOR} or newer."
      node_fix_hint
      exit 5
    fi
  fi
  NODE_BIN=$(command -v node)
  has npm && NPM_BIN=$(command -v npm) || NPM_BIN=''
  debug "node $($NODE_BIN --version) at $NODE_BIN"
}

# ── package manager ─────────────────────────────────────────────────────────────────────────
ensure_bun() {
  if has bun; then
    debug "bun $(bun --version) already installed"
    return 0
  fi
  if [ -x "$SDODS_HOME/.bun/bin/bun" ]; then
    PATH="$SDODS_HOME/.bun/bin:$PATH"; export PATH
    debug "using bun from $SDODS_HOME/.bun/bin"
    return 0
  fi
  step "Installing Bun ${BUN_VERSION_PIN} into $SDODS_HOME/.bun"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would run: curl -fsSL https://bun.sh/install | bash%s\n' "$C_DIM" "$C_RESET"
    return 0
  fi
  mkdir -p "$SDODS_HOME"
  if ! BUN_INSTALL="$SDODS_HOME/.bun" curl -fsSL --proto '=https' --tlsv1.2 https://bun.sh/install |
    BUN_INSTALL="$SDODS_HOME/.bun" bash -s "bun-v${BUN_VERSION_PIN}" >/dev/null 2>&1; then
    warn "Bun could not be installed; falling back to npm."
    PM=npm
    return 0
  fi
  PATH="$SDODS_HOME/.bun/bin:$PATH"; export PATH
  has bun || { warn "Bun install finished but bun is not on PATH; falling back to npm."; PM=npm; }
}

resolve_pm() {
  if [ -z "$PM" ]; then
    if has bun || [ -x "$SDODS_HOME/.bun/bin/bun" ]; then PM=bun
    elif has pnpm; then PM=pnpm
    else PM=bun; fi
  fi
  case "$PM" in
    bun) ensure_bun ;;
    pnpm) has pnpm || die 4 "pnpm is not installed." "npm i -g pnpm, or re-run with --pm bun." ;;
    npm) [ -n "$NPM_BIN" ] || die 4 "npm is not installed." "It ships with Node; reinstall Node ${NODE_MIN_MAJOR}+." ;;
  esac
  debug "package manager: $PM"
}

# ── source resolution ───────────────────────────────────────────────────────────────────────
npm_package_published() {
  [ -n "$NPM_BIN" ] || return 1
  "$NPM_BIN" view @sdods/cli version >/dev/null 2>&1
}

resolve_ref() {
  if [ -n "$REF" ]; then RESOLVED_REF=$REF; return 0; fi
  RESOLVED_REF=main
  latest=$(curl -fsS --max-time 10 "$SDODS_API_URL/releases/latest" 2>/dev/null |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 || true)
  if [ -n "$latest" ]; then RESOLVED_REF=$latest; fi
  debug "resolved ref: $RESOLVED_REF"
}

install_from_npm() {
  step "Installing @sdods/cli from npm"
  case "$PM" in
    bun) run_loud bun add -g @sdods/cli ;;
    pnpm) run_loud pnpm add -g @sdods/cli ;;
    npm) run_loud "$NPM_BIN" install -g @sdods/cli ;;
  esac
  ok "Installed @sdods/cli from the npm registry"
}

install_from_git() {
  step "Fetching SDODS ($RESOLVED_REF) into $APP_DIR"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would run: git clone --depth 1 --branch %s %s %s%s\n' \
      "$C_DIM" "$RESOLVED_REF" "$SDODS_REPO_URL" "$APP_DIR" "$C_RESET"
  elif [ -d "$APP_DIR/.git" ]; then
    debug "existing checkout found, updating"
    ( cd "$APP_DIR" &&
      git remote set-url origin "$SDODS_REPO_URL" &&
      git fetch --depth 1 origin "$RESOLVED_REF" >/dev/null 2>&1 &&
      git checkout -q --detach FETCH_HEAD ) ||
      die 6 "Could not update the existing checkout in $APP_DIR." \
        "Delete it and re-run: rm -rf \"$APP_DIR\""
  else
    mkdir -p "$SDODS_HOME"
    git clone --depth 1 --branch "$RESOLVED_REF" "$SDODS_REPO_URL" "$APP_DIR" >/dev/null 2>&1 ||
      git clone --depth 1 "$SDODS_REPO_URL" "$APP_DIR" >/dev/null 2>&1 ||
      die 6 "Could not clone $SDODS_REPO_URL." \
        "Check your network or proxy settings (HTTPS_PROXY) and try again."
  fi

  if [ "$DRY_RUN" != 1 ]; then
    head=$( cd "$APP_DIR" && git rev-parse HEAD 2>/dev/null || true )
    [ -n "$head" ] || die 6 "The checkout in $APP_DIR is not a valid git repository."
    [ -f "$APP_DIR/packages/cli/bin/sdods.js" ] ||
      die 7 "The checkout is missing packages/cli — the clone looks incomplete."
    ok "Checked out ${RESOLVED_REF} ($(printf '%.7s' "$head"))"
  fi

  step "Installing dependencies with $PM (this takes a minute)"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would run: cd %s && %s install%s\n' "$C_DIM" "$APP_DIR" "$PM" "$C_RESET"
    return 0
  fi
  case "$PM" in
    bun) ( cd "$APP_DIR" && run_loud bun install ) || die 7 "bun install failed in $APP_DIR." ;;
    pnpm) ( cd "$APP_DIR" && run_loud pnpm install ) || die 7 "pnpm install failed in $APP_DIR." ;;
    npm) ( cd "$APP_DIR" && run_loud "$NPM_BIN" install ) || die 7 "npm install failed in $APP_DIR." ;;
  esac
  ok "Dependencies installed"
}

install_browsers() {
  if [ "$BROWSERS" = none ]; then debug 'skipping browsers'; return 0; fi
  list=chromium
  if [ "$BROWSERS" = all ]; then list='chromium firefox webkit'; fi
  step "Installing browser engines: $list"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would install browser engines: %s%s\n' "$C_DIM" "$list" "$C_RESET"
    return 0
  fi
  with_deps=''
  if [ "$OS" = linux ]; then
    if [ "$(id -u 2>/dev/null || echo 1000)" = 0 ]; then
      with_deps='--with-deps'
    else
      warn "Skipping system libraries (needs root). If browsers fail to start, run:"
      say "  cd \"$APP_DIR\" && sudo ./node_modules/.bin/sdods browsers install --with-deps"
    fi
  fi
  # shellcheck disable=SC2086
  ( cd "$APP_DIR" 2>/dev/null || cd "$SDODS_HOME"
    run_loud npx --yes playwright install $with_deps $list ) ||
    warn "Browser download failed. Re-run later with: sdods browsers install"
}

write_shim() {
  if [ -z "$BIN_DIR" ]; then
    BIN_DIR="${HOME:-/tmp}/.local/bin"
    if [ ! -d "$BIN_DIR" ] && [ -w /usr/local/bin ] 2>/dev/null; then BIN_DIR=/usr/local/bin; fi
  fi
  step "Writing the sdods command to $BIN_DIR/sdods"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would write: %s/sdods%s\n' "$C_DIM" "$BIN_DIR" "$C_RESET"
    return 0
  fi
  mkdir -p "$BIN_DIR" 2>/dev/null ||
    die 8 "Cannot create $BIN_DIR." "Pass --bin-dir <writable path>."
  [ -w "$BIN_DIR" ] || die 8 "$BIN_DIR is not writable." "Pass --bin-dir <writable path>."
  cat >"$BIN_DIR/sdods" <<EOF
#!/bin/sh
# SDODS CLI shim — generated by install.sh, safe to delete.
SDODS_HOME="$SDODS_HOME"
export SDODS_HOME
[ -d "\$SDODS_HOME/.bun/bin" ] && PATH="\$SDODS_HOME/.bun/bin:\$PATH" && export PATH
exec node "$APP_DIR/packages/cli/bin/sdods.js" "\$@"
EOF
  chmod +x "$BIN_DIR/sdods"
  ok "Command installed: $BIN_DIR/sdods"
}

shell_rc() {
  case "${SHELL:-}" in
    */zsh) printf '%s' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    */bash) [ "$OS" = macos ] && printf '%s' "$HOME/.bash_profile" || printf '%s' "$HOME/.bashrc" ;;
    */fish) printf '%s' "$HOME/.config/fish/config.fish" ;;
    *) printf '%s' "$HOME/.profile" ;;
  esac
}

ensure_path() {
  case ":$PATH:" in *":$BIN_DIR:"*) ON_PATH=1 ;; *) ON_PATH=0 ;; esac
  if [ "$ON_PATH" = 1 ]; then return 0; fi
  rc=$(shell_rc)
  case "$rc" in
    */config.fish) line="fish_add_path $BIN_DIR" ;;
    *) line="export PATH=\"$BIN_DIR:\$PATH\"" ;;
  esac
  if [ "$MODIFY_PATH" = 1 ]; then
    if [ "$DRY_RUN" = 1 ]; then
      printf '%s   would append to %s: %s%s\n' "$C_DIM" "$rc" "$line" "$C_RESET"
    elif grep -Fq "$BIN_DIR" "$rc" 2>/dev/null; then
      debug "$rc already mentions $BIN_DIR"
    else
      mkdir -p "$(dirname "$rc")"
      printf '\n# SDODS\n%s\n' "$line" >>"$rc"
      ok "Added $BIN_DIR to PATH in $rc"
    fi
    say "  Open a new shell, or run: $line"
  else
    warn "$BIN_DIR is not on your PATH."
    say "  Add it now:   $line"
    say "  Or re-run the installer with --modify-path to append it to $rc"
  fi
  PATH="$BIN_DIR:$PATH"; export PATH
}

scaffold_workspace() {
  [ -n "$WORKSPACE" ] || return 0
  step "Creating a workspace in $WORKSPACE"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would run: sdods init %s%s\n' "$C_DIM" "$WORKSPACE" "$C_RESET"
    return 0
  fi
  set -- init "$WORKSPACE" --no-browsers
  if [ "$PM" = pnpm ]; then set -- "$@" --pm pnpm; fi
  if [ "$SOURCE_USED" = git ] && [ "$PM" = bun ]; then set -- "$@" --link; fi
  run_loud "$BIN_DIR/sdods" "$@" || warn "sdods init did not finish; run it yourself: sdods init $WORKSPACE"
}

register_mcp() {
  [ -n "$MCP_CLIENTS" ] || return 0
  for client in claude codex; do
    case "$MCP_CLIENTS" in all | "$client") ;; *) continue ;; esac
    if has "$client"; then
      step "Registering the SDODS MCP server with $client"
      if [ "$DRY_RUN" = 1 ]; then
        printf '%s   would run: sdods mcp install %s%s\n' "$C_DIM" "$client" "$C_RESET"
        continue
      fi
      run_loud "$BIN_DIR/sdods" mcp install "$client" || warn "MCP registration for $client failed; run: sdods mcp install $client"
    else
      warn "$client CLI not found; skipping MCP registration. Later: sdods mcp install $client"
    fi
  done
}

do_uninstall() {
  say ''
  say "This removes:"
  say "  $SDODS_HOME"
  if [ -z "$BIN_DIR" ]; then BIN_DIR="${HOME:-/tmp}/.local/bin"; fi
  say "  $BIN_DIR/sdods"
  say ''
  confirm "Remove SDODS?" || { say 'Cancelled.'; exit 0; }
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would remove %s and %s/sdods%s\n' "$C_DIM" "$SDODS_HOME" "$BIN_DIR" "$C_RESET"
    exit 0
  fi
  if [ -f "$BIN_DIR/sdods" ]; then
    rm -f "$BIN_DIR/sdods"
    ok "Removed $BIN_DIR/sdods"
  fi
  case "$SDODS_HOME" in
    "$HOME" | "$HOME/" | / | '' | /usr | /usr/* | /etc | /etc/*)
      die 1 "Refusing to remove $SDODS_HOME — that is not an SDODS install root."
      ;;
    *)
      if [ -d "$SDODS_HOME" ]; then
        rm -rf "$SDODS_HOME"
        ok "Removed $SDODS_HOME"
      fi
      ;;
  esac
  say ''
  say "SDODS is uninstalled. Workspaces you created are untouched."
  say "Browser engines stay in the shared cache; remove them with:"
  say "  rm -rf ~/Library/Caches/ms-playwright  # macOS"
  say "  rm -rf ~/.cache/ms-playwright          # Linux"
  exit 0
}

version_check() {
  say "${C_BOLD}SDODS installer${C_RESET} v${INSTALLER_VERSION}"
  say "  os              $OS/$ARCH${DISTRO:+ ($DISTRO)}"
  say "  node            $(probe node --version) (need >= v${NODE_MIN_MAJOR})"
  say "  npm             $(probe npm --version)"
  say "  bun             $(probe bun --version)"
  say "  pnpm            $(probe pnpm --version)"
  say "  git             $(probe git --version)"
  say "  curl            $(probe curl --version)"
  say "  claude          $(probe claude --version)"
  say "  codex           $(probe codex --version)"
  resolve_ref
  say "  install source  $SOURCE (ref $RESOLVED_REF)"
  say "  install root    $SDODS_HOME"
  say "  bin dir         ${BIN_DIR:-${HOME:-/tmp}/.local/bin}"
  say "  browsers        $BROWSERS"
  exit 0
}

next_steps() {
  # SDODS discovers projects from the current directory, so the demo needs a cd first.
  demo_dir=$APP_DIR
  if [ -n "$WORKSPACE" ]; then demo_dir=$WORKSPACE; fi
  say ''
  say "${C_BOLD}SDODS is ready.${C_RESET}"
  say ''
  say "  ${C_BOLD}Run the demo suite${C_RESET} ${C_DIM}(projects come from the current directory)${C_RESET}"
  say "    cd $demo_dir"
  say "    sdods run -p demo-shop -e staging -l api            ${C_DIM}# API layer, no browser${C_RESET}"
  say "    sdods run -p demo-shop -e staging -l ui -b chromium -t @smoke"
  say ''
  say "  ${C_BOLD}Start from your own app${C_RESET}"
  say "    sdods init ~/my-tests                               ${C_DIM}# new workspace with the demo project${C_RESET}"
  say "    sdods analyze /path/to/your-app --apply             ${C_DIM}# detect routes, API, test ids${C_RESET}"
  say ''
  say "  ${C_BOLD}See results${C_RESET}"
  say "    sdods report --last --open                          ${C_DIM}# HTML report + dashboard${C_RESET}"
  say "    sdods serve                                         ${C_DIM}# web UI on http://127.0.0.1:4444${C_RESET}"
  say ''
  say "  ${C_BOLD}Use it from Claude Code or Codex${C_RESET}"
  say "    sdods mcp install claude                            ${C_DIM}# or: codex${C_RESET}"
  say "    sdods agent install --for all"
  say ''
  say "  ${C_BOLD}Check the setup${C_RESET}     sdods doctor"
  say "  ${C_BOLD}Docs${C_RESET}                ${DOCS_URL}"
  say "  ${C_BOLD}Request a feature${C_RESET}   sdods feedback --feature"
  say ''
}

# ── main ────────────────────────────────────────────────────────────────────────────────────
if [ -n "${CI:-}" ]; then ASSUME_YES=1; fi

detect_platform
if [ "$VERSION_CHECK" = 1 ]; then version_check; fi
if [ "$DO_UNINSTALL" = 1 ]; then do_uninstall; fi

say ''
say "${C_BOLD}Installing SDODS${C_RESET} ${C_DIM}(${OS}/${ARCH}${DISTRO:+, $DISTRO})${C_RESET}"
if [ "$DRY_RUN" = 1 ]; then warn 'Dry run: nothing will be written.'; fi

check_prerequisites
resolve_pm

SOURCE_USED=git
if [ "$SOURCE" = npm ]; then
  npm_package_published || die 7 "@sdods/cli is not on the npm registry yet." \
    "Install from source instead: --source git"
  SOURCE_USED=npm
elif [ "$SOURCE" = auto ] && npm_package_published; then
  SOURCE_USED=npm
fi

if [ "$SOURCE_USED" = npm ]; then
  install_from_npm
  APP_DIR="(npm global)"
else
  resolve_ref
  install_from_git
fi

install_browsers
if [ "$SOURCE_USED" = git ]; then
  write_shim
else
  BIN_DIR=${BIN_DIR:-$(dirname "$(command -v sdods 2>/dev/null || echo /usr/local/bin/sdods)")}
fi
ensure_path
scaffold_workspace
register_mcp

if [ "$DRY_RUN" != 1 ]; then
  say ''
  step 'Checking the installation'
  "$BIN_DIR/sdods" doctor || warn 'doctor reported problems; the items above tell you what to fix.'
fi
next_steps
