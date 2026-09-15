#!/bin/sh
# SDODS installer for macOS and Linux.
#
#   curl -fsSL https://sdods.com/install.sh | sh
#   curl -fsSL https://sdods.com/install.sh | sh -s -- --workspace ~/tests --mcp claude
#
# What it does: checks Node 22+, installs Bun into the SDODS home if needed, fetches SDODS from
# npm (a failed npm install is an error, never a silent clone; --source git builds from a source
# checkout instead), installs dependencies and browsers, and writes an `sdods` shim on your PATH.
# Re-running upgrades in place.
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
# Mirrors SPONSOR_ENABLED in packages/contracts/src/sponsor.ts (tests/sponsor.test.ts checks it).
SPONSOR_ENABLED=0
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
# Consent given explicitly (--yes or SDODS_YES), as opposed to inferred from CI below.
# Destructive actions require the explicit form.
YES_EXPLICIT="${SDODS_YES:-0}"
VERBOSE="${SDODS_VERBOSE:-0}"
DO_UNINSTALL=0
DRY_RUN=0
VERSION_CHECK=0

TMP_DIR=''
NODE_BIN='node'
NPM_BIN='npm'
RESOLVED_REF=''
APP_DIR=''
# The sdods executable to invoke. Distinct from BIN_DIR: on the npm path no shim is written and
# the command lives in the package manager's global directory.
SDODS_BIN=''
GLOBAL_SDODS=''
# Where a previous source install put its checkout, remembered across the npm path.
APP_DIR_LEGACY=''
# Set when --dir/--bin-dir name a specific tree: an uninstall scoped that way must not reach
# outside it and remove a globally installed package that belongs to a different install.
SCOPED=0

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
  --source git|npm|auto how to fetch SDODS, default auto: npm packages, never a silent
                        fallback to cloning. 'git' builds from a source checkout (SDODS_SOURCE)
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
    --dir) need_value "$1" "${2:-}"; SDODS_HOME=$2; SCOPED=1; shift 2 ;;
    --dir=*) SDODS_HOME=${1#*=}; SCOPED=1; shift ;;
    --bin-dir) need_value "$1" "${2:-}"; BIN_DIR=$2; SCOPED=1; shift 2 ;;
    --bin-dir=*) BIN_DIR=${1#*=}; SCOPED=1; shift ;;
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
    --yes | -y) ASSUME_YES=1; YES_EXPLICIT=1; shift ;;
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

# A previous source install leaves three things that break a packaged install, all invisible
# until something crashes:
#   * $BIN_DIR/sdods -- a shim pointing into the checkout, which shadows the packaged command
#   * global `bun link` registrations for @playwright/test and playwright-bdd, created by
#     `sdods init --link`, which make the packaged install resolve Playwright out of the old
#     checkout and then fail with "Requiring @playwright/test second time"
#   * $SDODS_HOME/app itself, ~1.5 GB that nothing uses any more
migrate_from_source_install() {
  had_source=0
  if [ -n "$APP_DIR_LEGACY" ] && [ -d "$APP_DIR_LEGACY" ]; then had_source=1; fi
  shim=${BIN_DIR:-${HOME:-/tmp}/.local/bin}/sdods
  # Match the source shim specifically: it execs node against a checkout. The npm shim written
  # below also carries the "SDODS CLI shim" marker, and must not be mistaken for one.
  if [ -f "$shim" ] && grep -q 'packages/cli/bin/sdods.js' "$shim" 2>/dev/null; then had_source=1; fi
  [ "$had_source" = 1 ] || return 0

  step 'Migrating from a source install'
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would remove the source shim, stale global links and %s%s\n' \
      "$C_DIM" "$APP_DIR_LEGACY" "$C_RESET"
    return 0
  fi

  # Stale links first: they redirect dependencies into the checkout we are about to delete.
  if has bun; then
    gdir=$(bun pm bin -g 2>/dev/null || true)
    if [ -n "$gdir" ]; then
      for pkg in playwright-bdd @playwright/test; do
        link="$gdir/../install/global/node_modules/$pkg"
        if [ -L "$link" ]; then rm -f "$link"; debug "unlinked $pkg"; fi
      done
    fi
  fi

  if [ -f "$shim" ] && grep -q 'packages/cli/bin/sdods.js' "$shim" 2>/dev/null; then
    rm -f "$shim"
    ok "Removed the old source shim at $shim"
  fi

  if [ -d "$APP_DIR_LEGACY" ]; then
    case "$APP_DIR_LEGACY" in
      "$HOME" | "$HOME/" | / | '' | /usr | /usr/* | /etc | /etc/*)
        warn "Refusing to remove $APP_DIR_LEGACY" ;;
      *)
        size=$(du -sh "$APP_DIR_LEGACY" 2>/dev/null | cut -f1)
        # Twice: a Finder window open on the tree recreates .DS_Store behind rm as it walks,
        # which leaves "Directory not empty". Never fatal -- a leftover directory is untidy, not
        # a reason to abandon an otherwise good install.
        rm -rf "$APP_DIR_LEGACY" 2>/dev/null || rm -rf "$APP_DIR_LEGACY" 2>/dev/null || true
        if [ -d "$APP_DIR_LEGACY" ]; then
          warn "Could not fully remove $APP_DIR_LEGACY (close any window open on it, then: rm -rf \"$APP_DIR_LEGACY\")"
        else
          ok "Removed the old checkout at $APP_DIR_LEGACY (${size:-unknown} reclaimed)"
        fi ;;
    esac
  fi
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

# Where the package manager puts global bins. No shim is written on the npm path -- the package's
# own `bin` provides `sdods` -- so this is how we find it before it is on PATH.
resolve_global_bin() {
  # A dry run never installed anything, so there is no global bin to find. Report the path the
  # package manager would use and carry on; dying here would fail --dry-run on a clean machine.
  if [ "$DRY_RUN" = 1 ]; then
    GLOBAL_SDODS="(global bin)/sdods"
    return 0
  fi
  dir=''
  case "$PM" in
    bun) dir=$(bun pm bin -g 2>/dev/null || true) ;;
    pnpm) dir=$(pnpm bin -g 2>/dev/null || true) ;;
    npm) dir=$("$NPM_BIN" prefix -g 2>/dev/null || true); [ -n "$dir" ] && dir="$dir/bin" ;;
  esac
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then
    resolved=$(command -v sdods 2>/dev/null || true)
    [ -n "$resolved" ] && dir=$(dirname "$resolved")
  fi
  [ -n "$dir" ] || die 7 "Installed @sdods/cli but could not find the directory it put 'sdods' in." \
    "Run '$PM bin -g' and add that directory to your PATH."
  GLOBAL_SDODS="$dir/sdods"
  [ -x "$GLOBAL_SDODS" ] || die 7 "Installed @sdods/cli but $GLOBAL_SDODS is not executable." \
    "Run '$PM bin -g' and check the install."
  debug "global sdods: $GLOBAL_SDODS"
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
      if [ -n "$APP_DIR" ] && [ -d "$APP_DIR" ]; then
        say "  cd \"$APP_DIR\" && sudo ./node_modules/.bin/sdods browsers install --with-deps"
      else
        say "  sudo sdods browsers install --with-deps"
      fi
    fi
  fi
  # Playwright downloads into a shared cache, so the working directory only has to exist.
  work=$APP_DIR
  if [ -z "$work" ] || [ ! -d "$work" ]; then
    mkdir -p "$SDODS_HOME" 2>/dev/null || true
    if [ -d "$SDODS_HOME" ]; then work=$SDODS_HOME; else work=${HOME:-/tmp}; fi
  fi
  # shellcheck disable=SC2086
  ( cd "$work" &&
    run_loud npx --yes playwright install $with_deps $list ) ||
    warn "Browser download failed. Re-run later with: sdods browsers install"
}

# Points at the globally installed package rather than a checkout. Written for the same reason
# the source path writes one: $BIN_DIR (default ~/.local/bin) is conventionally on PATH, while a
# package manager's global bin frequently is not.
write_npm_shim() {
  if [ -z "$BIN_DIR" ]; then
    BIN_DIR="${HOME:-/tmp}/.local/bin"
    if [ ! -d "$BIN_DIR" ] && [ -w /usr/local/bin ] 2>/dev/null; then BIN_DIR=/usr/local/bin; fi
  fi
  step "Writing the sdods command to $BIN_DIR/sdods"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s   would write: %s/sdods -> %s%s\n' "$C_DIM" "$BIN_DIR" "$GLOBAL_SDODS" "$C_RESET"
    return 0
  fi
  mkdir -p "$BIN_DIR" 2>/dev/null ||
    die 8 "Cannot create $BIN_DIR." "Pass --bin-dir <writable path>."
  [ -w "$BIN_DIR" ] || die 8 "$BIN_DIR is not writable." "Pass --bin-dir <writable path>."
  cat >"$BIN_DIR/sdods" <<EOF
#!/bin/sh
# SDODS CLI shim (npm install) — generated by install.sh, safe to delete.
exec "$GLOBAL_SDODS" "\$@"
EOF
  chmod +x "$BIN_DIR/sdods"
  SDODS_BIN="$BIN_DIR/sdods"
  ok "Command installed: $BIN_DIR/sdods"
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
  SDODS_BIN="$BIN_DIR/sdods"
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
  run_loud "$SDODS_BIN" "$@" || warn "sdods init did not finish; run it yourself: sdods init $WORKSPACE"
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
      run_loud "$SDODS_BIN" mcp install "$client" || warn "MCP registration for $client failed; run: sdods mcp install $client"
    else
      warn "$client CLI not found; skipping MCP registration. Later: sdods mcp install $client"
    fi
  done
}

# A default install puts @sdods/cli in the package manager's global directory, not in SDODS_HOME,
# so removing SDODS_HOME alone would leave a working `sdods` behind. Checks every package manager
# present, because the install may have used a different one than is default today.
global_pkg_pm() {
  for pm in bun pnpm npm; do
    has "$pm" || continue
    case "$pm" in
      bun) if bun pm ls -g 2>/dev/null | grep -q '@sdods/cli'; then echo "$pm"; return 0; fi ;;
      pnpm) if pnpm list -g --depth 0 2>/dev/null | grep -q '@sdods/cli'; then echo "$pm"; return 0; fi ;;
      npm) if npm ls -g --depth 0 2>/dev/null | grep -q '@sdods/cli'; then echo "$pm"; return 0; fi ;;
    esac
  done
  return 0
}

# The exact removal command for a package manager, so the dry run prints what actually runs.
global_pkg_cmd() {
  case "$1" in
    bun) echo 'bun remove -g @sdods/cli' ;;
    pnpm) echo 'pnpm remove -g @sdods/cli' ;;
    npm) echo 'npm uninstall -g @sdods/cli' ;;
  esac
}

uninstall_global_pkg() {
  pm=$1
  [ -n "$pm" ] || return 0
  # shellcheck disable=SC2091
  $(global_pkg_cmd "$pm") >/dev/null 2>&1 || true
  ok "Removed the global @sdods/cli package ($pm)"
}

do_uninstall() {
  say ''
  # A scoped uninstall (--dir/--bin-dir) belongs to one sandbox; the globally installed package
  # is someone else's and must be left alone.
  if [ "$SCOPED" = 1 ]; then GLOBAL_PM=''; else GLOBAL_PM=$(global_pkg_pm); fi
  say "This removes:"
  if [ -n "$GLOBAL_PM" ]; then say "  the global @sdods/cli package ($GLOBAL_PM)"; fi
  say "  $SDODS_HOME"
  if [ -z "$BIN_DIR" ]; then BIN_DIR="${HOME:-/tmp}/.local/bin"; fi
  say "  $BIN_DIR/sdods"
  say ''
  # Running in CI implies --yes for installing, but never for deleting: consent to a
  # destructive action has to be explicit.
  if [ "$YES_EXPLICIT" != 1 ]; then ASSUME_YES=0; fi
  confirm "Remove SDODS?" || { say 'Cancelled.'; exit 0; }
  if [ "$DRY_RUN" = 1 ]; then
    if [ -n "$GLOBAL_PM" ]; then
      printf '%s   would run: %s%s\n' "$C_DIM" "$(global_pkg_cmd "$GLOBAL_PM")" "$C_RESET"
    fi
    printf '%s   would remove %s and %s/sdods%s\n' "$C_DIM" "$SDODS_HOME" "$BIN_DIR" "$C_RESET"
    exit 0
  fi
  uninstall_global_pkg "$GLOBAL_PM"
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
  # SDODS discovers projects from the current directory, so the demo needs a workspace to run in.
  # On the npm path there is no checkout to cd into: `sdods init` scaffolds one, demo included.
  demo_dir=''
  if [ -n "$WORKSPACE" ]; then demo_dir=$WORKSPACE
  elif [ -n "$APP_DIR" ] && [ -d "$APP_DIR" ]; then demo_dir=$APP_DIR; fi
  say ''
  say "${C_BOLD}SDODS is ready.${C_RESET}"
  say ''
  say "  ${C_BOLD}Run the demo suite${C_RESET} ${C_DIM}(projects come from the current directory)${C_RESET}"
  if [ -n "$demo_dir" ]; then
    say "    cd $demo_dir"
  else
    say "    sdods init ~/my-tests                               ${C_DIM}# scaffolds a workspace with the demo${C_RESET}"
    say "    cd ~/my-tests"
  fi
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
  if [ "$SPONSOR_ENABLED" = 1 ]; then
    say "  ${C_BOLD}Sponsor SDODS${C_RESET}       ${SITE_URL}/sponsor/"
  fi
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

# npm is the expected path: it installs a few MB of compiled packages. The git path clones the
# whole monorepo and installs every workspace's dependencies (~1.5 GB), so `auto` no longer falls
# back to it silently -- a registry outage should say so rather than hand someone a source tree.
SOURCE_USED=npm
if [ "$SOURCE" = git ]; then
  SOURCE_USED=git
elif ! npm_package_published; then
  if [ "$SOURCE" = npm ]; then
    die 7 "@sdods/cli is not available on the npm registry." \
      "Check your registry and network, or install from source with: --source git"
  fi
  die 7 "@sdods/cli could not be found on the npm registry." \
    "If the registry is reachable this is usually temporary -- retry shortly." \
    "To build from source instead (clones the repo, needs ~1.5 GB): --source git"
fi

if [ "$SOURCE_USED" = npm ]; then
  # No checkout on this path. APP_DIR stays empty; everything downstream must tolerate that
  # rather than treat it as a directory -- but remember where a previous source install put one,
  # and clear it before installing so stale links cannot capture the new dependency tree.
  APP_DIR_LEGACY=$APP_DIR
  APP_DIR=''
  migrate_from_source_install
  install_from_npm
  resolve_global_bin
  write_npm_shim
else
  resolve_ref
  install_from_git
fi

install_browsers
if [ "$SOURCE_USED" = git ]; then write_shim; fi
ensure_path
scaffold_workspace
register_mcp

if [ "$DRY_RUN" != 1 ]; then
  say ''
  step 'Checking the installation'
  # SDODS discovers projects from the current directory, so check from the workspace when we made
  # one -- otherwise doctor reports "projects none" on a perfectly good install.
  doctor_dir=$WORKSPACE
  if [ -z "$doctor_dir" ] || [ ! -d "$doctor_dir" ]; then doctor_dir=$APP_DIR; fi
  if [ -z "$doctor_dir" ] || [ ! -d "$doctor_dir" ]; then doctor_dir=$PWD; fi
  ( cd "$doctor_dir" && "$SDODS_BIN" doctor ) ||
    warn 'doctor reported problems; the items above tell you what to fix.'
fi
next_steps

# Exit explicitly for the same reason as install.ps1: a probe's status must not become ours.
exit 0
