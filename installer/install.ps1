<#
.SYNOPSIS
  SDODS installer for Windows (PowerShell 5.1 and 7+).

.DESCRIPTION
  Checks Node 22+, installs Bun into the SDODS home if needed, fetches SDODS (npm when
  published, otherwise a shallow git clone), installs dependencies and browser engines, and
  writes an `sdods.cmd` shim. Re-running upgrades in place.

  Nothing is written outside -Dir (default $env:USERPROFILE\.sdods) and -BinDir (default
  $env:LOCALAPPDATA\SDODS\bin). The user PATH is only changed with -ModifyPath.

.EXAMPLE
  irm https://sdods.com/install.ps1 | iex

.EXAMPLE
  # With options, the script must be invoked as a script block:
  & ([scriptblock]::Create((irm https://sdods.com/install.ps1))) -Workspace C:\tests -Mcp claude

.NOTES
  Exit codes: 0 ok · 1 failed · 2 usage · 3 unsupported platform · 4 missing prerequisite
              5 Node missing/too old · 6 download failed · 7 install failed · 8 permission denied
  Apache-2.0 · https://github.com/siri1410/SDODS
#>
[CmdletBinding()]
param(
  [string] $Version,
  [string] $Dir,
  [string] $BinDir,
  [ValidateSet('bun', 'pnpm', 'npm')] [string] $Pm,
  [string] $Browsers,
  [string] $Workspace,
  [string] $Source,
  [ValidateSet('claude', 'codex', 'all')] [string] $Mcp,
  [switch] $ModifyPath,
  [switch] $Yes,
  [switch] $Uninstall,
  [switch] $DryRun,
  [switch] $VersionCheck,
  [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$RepoSlug = 'siri1410/SDODS'
$RepoUrl = if ($env:SDODS_REPO_URL) { $env:SDODS_REPO_URL } else { "https://github.com/$RepoSlug.git" }
$ApiUrl = "https://api.github.com/repos/$RepoSlug"
$DocsUrl = 'https://docs.sdods.com'
# Mirrors SPONSOR_ENABLED in packages/contracts/src/sponsor.ts (tests/sponsor.test.ts checks it).
$SponsorEnabled = $false
$NodeMinMajor = 22
$BunVersionPin = '1.4.0'
$InstallerVersion = '1.0.0'

# ── options: parameter wins, then environment, then default ──────────────────────────────────
function Coalesce([string] $Param, [string] $EnvName, [string] $Default) {
  if ($Param) { return $Param }
  $v = [Environment]::GetEnvironmentVariable($EnvName)
  if ($v) { return $v }
  return $Default
}

$SdodsHome = Coalesce $Dir 'SDODS_HOME' (Join-Path $env:USERPROFILE '.sdods')
$BinDirPath = Coalesce $BinDir 'SDODS_BIN_DIR' (Join-Path $env:LOCALAPPDATA 'SDODS\bin')
$Ref = Coalesce $Version 'SDODS_VERSION' ''
$PmName = Coalesce $Pm 'SDODS_PM' ''
$BrowsersOpt = Coalesce $Browsers 'SDODS_BROWSERS' 'chromium'
$WorkspacePath = Coalesce $Workspace 'SDODS_WORKSPACE' ''
$SourceOpt = Coalesce $Source 'SDODS_SOURCE' 'auto'
$McpClients = Coalesce $Mcp 'SDODS_MCP' ''
$DoModifyPath = $ModifyPath.IsPresent -or $env:SDODS_MODIFY_PATH -eq '1'
$AssumeYes = $Yes.IsPresent -or $env:SDODS_YES -eq '1' -or [bool]$env:CI
# Consent given explicitly, as opposed to inferred from CI. Destructive actions require this form.
$YesExplicit = $Yes.IsPresent -or $env:SDODS_YES -eq '1'
$AppDir = Join-Path $SdodsHome 'app'
$SourceUsed = 'git'
$GlobalSdods = ''
$AppDirLegacy = ''

if ($BrowsersOpt -notin @('all', 'chromium', 'none')) {
  Write-Host "ERROR -Browsers must be all, chromium or none (got '$BrowsersOpt')." -ForegroundColor Red; exit 2
}
if ($SourceOpt -notin @('git', 'npm', 'auto')) {
  Write-Host "ERROR -Source must be git, npm or auto (got '$SourceOpt')." -ForegroundColor Red; exit 2
}
if ($McpClients -and $McpClients -notin @('claude', 'codex', 'all')) {
  Write-Host "ERROR -Mcp must be claude, codex or all (got '$McpClients')." -ForegroundColor Red; exit 2
}

$UseColor = -not $env:NO_COLOR
function Say([string] $Text = '') { Write-Host $Text }
function Bold([string] $Text) { if ($UseColor) { Write-Host $Text -ForegroundColor White } else { Write-Host $Text } }
function Step([string] $Text) {
  if ($UseColor) { Write-Host '==> ' -ForegroundColor Cyan -NoNewline } else { Write-Host '==> ' -NoNewline }
  Write-Host $Text
}
function Ok([string] $Text) {
  if ($UseColor) { Write-Host 'OK  ' -ForegroundColor Green -NoNewline } else { Write-Host 'OK  ' -NoNewline }
  Write-Host $Text
}
function Warn([string] $Text) { Write-Host "!   $Text" -ForegroundColor Yellow }
function Dbg([string] $Text) { Write-Verbose $Text }

function Die([int] $Code, [string] $Message, [string[]] $Hints = @()) {
  Write-Host "ERROR $Message" -ForegroundColor Red
  foreach ($h in $Hints) { Write-Host "  $h" }
  Write-Host "  Docs: $DocsUrl/docs/getting-started/installation/"
  exit $Code
}

function Have([string] $Name) { $null -ne (Get-Command $Name -ErrorAction SilentlyContinue) }

# Where the sdods command lives: the generated shim for source installs, PATH for npm installs.
function Get-SdodsCmd {
  $shim = Join-Path $BinDirPath 'sdods.cmd'
  if (Test-Path $shim) { return $shim }
  if ($SourceUsed -eq 'npm' -and $GlobalSdods) { return $GlobalSdods }
  return $shim
}

function Probe([string] $Name, [string[]] $ProbeArgs = @('--version')) {
  if (-not (Have $Name)) { return 'not installed' }
  try {
    $out = & $Name @ProbeArgs 2>$null | Select-Object -First 1
    if ($out) { return "$out".Trim() } else { return 'installed' }
  } catch { return 'installed' }
}

# Run an external command; honours -DryRun. Throws on non-zero exit.
function Invoke-Step([string] $Exe, [string[]] $Arguments, [string] $WorkDir = $null) {
  $pretty = "$Exe $($Arguments -join ' ')"
  if ($DryRun) { Say "   would run: $pretty"; return }
  Dbg "run: $pretty"
  $prev = $null
  if ($WorkDir) { $prev = Get-Location; Set-Location $WorkDir }
  try {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$pretty exited with $LASTEXITCODE" }
  } finally {
    if ($prev) { Set-Location $prev }
  }
}

function Confirm-Action([string] $Question) {
  if ($AssumeYes) { return $true }
  if (-not [Environment]::UserInteractive) {
    Warn 'Not an interactive session. Re-run with -Yes to proceed.'
    return $false
  }
  $answer = Read-Host "$Question [y/N]"
  return $answer -match '^(y|yes)$'
}

function Show-Usage {
  @"
SDODS installer v$InstallerVersion

  irm $DocsUrl/install.ps1 | iex
  & ([scriptblock]::Create((irm $DocsUrl/install.ps1))) -Yes -Workspace C:\tests

Options (environment equivalent in parentheses):
  -Version <ref>        git tag, branch or commit to install (SDODS_VERSION)
  -Dir <path>           install root, default `$env:USERPROFILE\.sdods (SDODS_HOME)
  -BinDir <path>        where sdods.cmd goes, default `$env:LOCALAPPDATA\SDODS\bin (SDODS_BIN_DIR)
  -Pm bun|pnpm|npm      package manager, default bun (SDODS_PM)
  -Browsers all|chromium|none
                        browser engines to install, default chromium (SDODS_BROWSERS)
  -Workspace <dir>      also scaffold a workspace there with 'sdods init' (SDODS_WORKSPACE)
  -Source git|npm|auto  how to fetch SDODS, default auto (SDODS_SOURCE)
  -Mcp claude|codex|all register the SDODS MCP server with those CLIs (SDODS_MCP)
  -ModifyPath           add the bin directory to your user PATH (SDODS_MODIFY_PATH=1)
  -Yes                  never prompt (SDODS_YES=1)
  -Uninstall            remove the shim and the install root
  -DryRun               print what would happen, change nothing
  -Verbose              show every command
  -VersionCheck         print resolved versions and paths, then exit
  -Help                 this message

Node 22+ is required. Install it with:
  winget install OpenJS.NodeJS.LTS      or   scoop install nodejs-lts
  nvm install 22 && nvm use 22          (nvm-windows)
"@
}

function Get-NodeMajor([string] $Exe = 'node') {
  try {
    $v = (& $Exe --version 2>$null) -replace '^v', ''
    return [int](($v -split '\.')[0])
  } catch { return 0 }
}

function Test-Prerequisites {
  if (-not $env:USERPROFILE) { Die 3 'USERPROFILE is not set; this script is for Windows.' @("On macOS or Linux use: curl -fsSL $DocsUrl/install.sh | sh") }
  if ($SourceOpt -ne 'npm' -and -not (Have 'git')) {
    Die 4 'git is required to install from source.' @(
      'winget install Git.Git', 'or download from https://git-scm.com/download/win')
  }
  if (-not (Have 'node')) {
    Die 5 "Node.js is not installed. SDODS needs Node $NodeMinMajor or newer." @(
      'winget install OpenJS.NodeJS.LTS',
      'scoop install nodejs-lts',
      'nvm install 22 && nvm use 22   (https://github.com/coreybutler/nvm-windows)')
  }
  $major = Get-NodeMajor
  if ($major -lt $NodeMinMajor) {
    Die 5 "Node v$major is too old. SDODS needs Node $NodeMinMajor or newer." @(
      'winget upgrade OpenJS.NodeJS.LTS', 'nvm install 22 && nvm use 22')
  }
  Dbg "node $(& node --version)"
}

function Install-Bun {
  if (Have 'bun') { Dbg "bun $(& bun --version) already installed"; return }
  $bunExe = Join-Path $SdodsHome '.bun\bin\bun.exe'
  if (Test-Path $bunExe) {
    $env:PATH = "$(Split-Path $bunExe);$env:PATH"
    return
  }
  Step "Installing Bun $BunVersionPin into $SdodsHome\.bun"
  if ($DryRun) { Say '   would run: irm https://bun.sh/install.ps1 | iex'; return }
  try {
    $env:BUN_INSTALL = Join-Path $SdodsHome '.bun'
    New-Item -ItemType Directory -Force -Path $env:BUN_INSTALL | Out-Null
    & ([scriptblock]::Create((Invoke-RestMethod 'https://bun.sh/install.ps1'))) -Version $BunVersionPin
    $env:PATH = "$(Join-Path $env:BUN_INSTALL 'bin');$env:PATH"
  } catch {
    Warn "Bun could not be installed ($($_.Exception.Message)); falling back to npm."
    $script:PmName = 'npm'
    return
  }
  if (-not (Have 'bun')) { Warn 'Bun is not on PATH after install; falling back to npm.'; $script:PmName = 'npm' }
}

function Resolve-PackageManager {
  if (-not $PmName) {
    if (Have 'bun') { $script:PmName = 'bun' }
    elseif (Have 'pnpm') { $script:PmName = 'pnpm' }
    else { $script:PmName = 'bun' }
  }
  switch ($PmName) {
    'bun' { Install-Bun }
    'pnpm' { if (-not (Have 'pnpm')) { Die 4 'pnpm is not installed.' @('npm i -g pnpm, or re-run with -Pm bun') } }
    'npm' { if (-not (Have 'npm')) { Die 4 'npm is not installed.' @('It ships with Node; reinstall Node 22+.') } }
  }
  Dbg "package manager: $PmName"
}

function Test-NpmPublished {
  if (-not (Have 'npm')) { return $false }
  try {
    $null = & npm view '@sdods/cli' version 2>$null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

function Resolve-Ref {
  if ($Ref) { return $Ref }
  try {
    $rel = Invoke-RestMethod -Uri "$ApiUrl/releases/latest" -TimeoutSec 10 -ErrorAction Stop
    if ($rel.tag_name) { return $rel.tag_name }
  } catch { Dbg 'no published release; using main' }
  return 'main'
}

function Install-FromNpm {
  Step 'Installing @sdods/cli from npm'
  switch ($PmName) {
    'bun' { Invoke-Step 'bun' @('add', '-g', '@sdods/cli') }
    'pnpm' { Invoke-Step 'pnpm' @('add', '-g', '@sdods/cli') }
    default { Invoke-Step 'npm' @('install', '-g', '@sdods/cli') }
  }
  Ok 'Installed @sdods/cli from the npm registry'
}

# Where the package manager puts global bins. No shim is written on the npm path -- the package's
# own bin provides sdods -- so this is how we find it before it is on PATH.
# A previous source install leaves a shim pointing into the checkout, which shadows the packaged
# command, plus ~1.5 GB of checkout that nothing uses any more.
function Invoke-SourceMigration {
  $shim = Join-Path $BinDirPath 'sdods.cmd'
  $hadSource = (Test-Path $AppDirLegacy) -or
    ((Test-Path $shim) -and ((Get-Content $shim -Raw -ErrorAction SilentlyContinue) -match 'packages\\cli\\bin\\sdods\.js'))
  if (-not $hadSource) { return }
  Step 'Migrating from a source install'
  if ($DryRun) { Say "   would remove the source shim and $AppDirLegacy"; return }
  foreach ($f in @('sdods.cmd', 'sdods.ps1')) {
    $x = Join-Path $BinDirPath $f
    if ((Test-Path $x) -and ((Get-Content $x -Raw -ErrorAction SilentlyContinue) -match 'packages')) {
      Remove-Item $x -Force -ErrorAction SilentlyContinue
      Ok "Removed the old source shim at $x"
    }
  }
  if (Test-Path $AppDirLegacy) {
    try { Remove-Item $AppDirLegacy -Recurse -Force -ErrorAction Stop; Ok "Removed the old checkout at $AppDirLegacy" }
    catch { Warn "Could not fully remove $AppDirLegacy - remove it yourself once nothing is open on it." }
  }
}

# Points at the globally installed package. Written for the same reason the source path writes
# one: BinDirPath is put on PATH, while a package manager's global bin frequently is not.
function Write-NpmShim {
  Step "Writing the sdods command to $BinDirPath\sdods.cmd"
  if ($DryRun) { Say "   would write: $BinDirPath\sdods.cmd -> $GlobalSdods"; return }
  try { New-Item -ItemType Directory -Force -Path $BinDirPath | Out-Null }
  catch { Die 8 "Cannot create $BinDirPath." @('Pass -BinDir <writable path>.') }
  "@echo off`r`n`"$GlobalSdods`" %*" | Set-Content -Path (Join-Path $BinDirPath 'sdods.cmd') -Encoding ascii
  "& `"$GlobalSdods`" @args" | Set-Content -Path (Join-Path $BinDirPath 'sdods.ps1') -Encoding ascii
  Ok "Command installed: $BinDirPath\sdods.cmd"
}

function Resolve-GlobalBin {
  # A dry run never installed anything, so there is no global bin to find. Report the path the
  # package manager would use and carry on; dying here would fail -DryRun on a clean machine.
  if ($DryRun) { $script:GlobalSdods = '(global bin)\sdods'; return }
  $dir = ''
  try {
    switch ($PmName) {
      'bun' { $dir = (& bun pm bin -g 2>$null | Select-Object -First 1) }
      'pnpm' { $dir = (& pnpm bin -g 2>$null | Select-Object -First 1) }
      default {
        $prefix = (& npm prefix -g 2>$null | Select-Object -First 1)
        if ($prefix) { $dir = $prefix }
      }
    }
  } catch { $dir = '' }
  if ((-not $dir) -or (-not (Test-Path $dir))) {
    $resolved = (Get-Command sdods -ErrorAction SilentlyContinue)
    if ($resolved) { $dir = Split-Path -Parent $resolved.Source }
  }
  if (-not $dir) {
    Die 7 'Installed @sdods/cli but could not find the directory it put sdods in.' @("Run '$PmName bin -g' and add that directory to your PATH.")
  }
  $exe = Join-Path "$dir".Trim() 'sdods.cmd'
  if (-not (Test-Path $exe)) { $exe = Join-Path "$dir".Trim() 'sdods' }
  $script:GlobalSdods = $exe
}

function Install-FromGit([string] $ResolvedRef) {
  Step "Fetching SDODS ($ResolvedRef) into $AppDir"
  if ($DryRun) {
    Say "   would run: git clone --depth 1 --branch $ResolvedRef $RepoUrl $AppDir"
    Say "   would run: cd $AppDir && $PmName install"
    return
  }
  if (Test-Path (Join-Path $AppDir '.git')) {
    try {
      Invoke-Step 'git' @('remote', 'set-url', 'origin', $RepoUrl) $AppDir
      Invoke-Step 'git' @('fetch', '--depth', '1', 'origin', $ResolvedRef) $AppDir
      Invoke-Step 'git' @('checkout', '-q', '--detach', 'FETCH_HEAD') $AppDir
    } catch {
      Die 6 "Could not update the existing checkout in $AppDir." @("Delete it and re-run: Remove-Item -Recurse -Force '$AppDir'")
    }
  } else {
    New-Item -ItemType Directory -Force -Path $SdodsHome | Out-Null
    try {
      Invoke-Step 'git' @('clone', '--depth', '1', '--branch', $ResolvedRef, $RepoUrl, $AppDir)
    } catch {
      try { Invoke-Step 'git' @('clone', '--depth', '1', $RepoUrl, $AppDir) }
      catch { Die 6 "Could not clone $RepoUrl." @('Check your network or proxy settings and try again.') }
    }
  }
  if (-not (Test-Path (Join-Path $AppDir 'packages\cli\bin\sdods.js'))) {
    Die 7 'The checkout is missing packages/cli — the clone looks incomplete.'
  }
  $head = (& git -C $AppDir rev-parse HEAD).Substring(0, 7)
  Ok "Checked out $ResolvedRef ($head)"

  Step "Installing dependencies with $PmName (this takes a minute)"
  try { Invoke-Step $PmName @('install') $AppDir }
  catch { Die 7 "$PmName install failed in $AppDir." @($_.Exception.Message) }
  Ok 'Dependencies installed'
}

function Install-Browsers {
  if ($BrowsersOpt -eq 'none') { return }
  $list = if ($BrowsersOpt -eq 'all') { @('chromium', 'firefox', 'webkit') } else { @('chromium') }
  Step "Installing browser engines: $($list -join ' ')"
  if ($DryRun) { Say "   would install browser engines: $($list -join ' ')"; return }
  # Playwright downloads into a shared cache, so the working directory only has to exist. On the
  # npm path there is no checkout, so fall back to the SDODS home.
  $work = $AppDir
  if (-not $work -or -not (Test-Path $work)) {
    try { New-Item -ItemType Directory -Force -Path $SdodsHome | Out-Null } catch { }
    $work = if (Test-Path $SdodsHome) { $SdodsHome } else { $env:USERPROFILE }
  }
  try { Invoke-Step 'npx' (@('--yes', 'playwright', 'install') + $list) $work }
  catch { Warn 'Browser download failed. Re-run later with: sdods browsers install' }
}

function Write-Shim {
  Step "Writing the sdods command to $BinDirPath\sdods.cmd"
  if ($DryRun) { Say "   would write: $BinDirPath\sdods.cmd"; return }
  try { New-Item -ItemType Directory -Force -Path $BinDirPath | Out-Null }
  catch { Die 8 "Cannot create $BinDirPath." @('Pass -BinDir <writable path>.') }
  $entry = Join-Path $AppDir 'packages\cli\bin\sdods.js'
  $bunBin = Join-Path $SdodsHome '.bun\bin'
  @"
@echo off
rem SDODS CLI shim — generated by install.ps1, safe to delete.
set "SDODS_HOME=$SdodsHome"
if exist "$bunBin" set "PATH=$bunBin;%PATH%"
node "$entry" %*
"@ | Set-Content -Path (Join-Path $BinDirPath 'sdods.cmd') -Encoding ASCII

  # PowerShell-native wrapper so `sdods` works with arguments containing spaces in pwsh.
  @"
#!/usr/bin/env pwsh
# SDODS CLI shim — generated by install.ps1, safe to delete.
`$env:SDODS_HOME = '$SdodsHome'
if (Test-Path '$bunBin') { `$env:PATH = '$bunBin;' + `$env:PATH }
node '$entry' @args
exit `$LASTEXITCODE
"@ | Set-Content -Path (Join-Path $BinDirPath 'sdods.ps1') -Encoding UTF8
  Ok "Command installed: $BinDirPath\sdods.cmd"
}

function Add-ToPath {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -and ($userPath -split ';' | Where-Object { $_ -eq $BinDirPath })) {
    $env:PATH = "$BinDirPath;$env:PATH"
    return
  }
  if ($DoModifyPath) {
    if ($DryRun) { Say "   would add $BinDirPath to the user PATH"; return }
    $newPath = if ($userPath) { "$userPath;$BinDirPath" } else { $BinDirPath }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Ok "Added $BinDirPath to your user PATH (open a new terminal to pick it up)"
  } else {
    Warn "$BinDirPath is not on your PATH."
    Say "  Add it now:   `$env:PATH = '$BinDirPath;' + `$env:PATH"
    Say '  Or re-run the installer with -ModifyPath to make it permanent'
  }
  $env:PATH = "$BinDirPath;$env:PATH"
}

function New-Workspace {
  if (-not $WorkspacePath) { return }
  Step "Creating a workspace in $WorkspacePath"
  if ($DryRun) { Say "   would run: sdods init $WorkspacePath"; return }
  $initArgs = @('init', $WorkspacePath, '--no-browsers')
  if ($PmName -eq 'pnpm') { $initArgs += @('--pm', 'pnpm') }
  elseif ($SourceUsed -eq 'git' -and $PmName -eq 'bun') { $initArgs += '--link' }
  try { Invoke-Step (Get-SdodsCmd) $initArgs }
  catch { Warn "sdods init did not finish; run it yourself: sdods init $WorkspacePath" }
}

function Register-Mcp {
  if (-not $McpClients) { return }
  foreach ($client in @('claude', 'codex')) {
    if ($McpClients -ne 'all' -and $McpClients -ne $client) { continue }
    if (Have $client) {
      Step "Registering the SDODS MCP server with $client"
      if ($DryRun) { Say "   would run: sdods mcp install $client"; continue }
      try { Invoke-Step (Get-SdodsCmd) @('mcp', 'install', $client) }
      catch { Warn "MCP registration for $client failed; run: sdods mcp install $client" }
    } else {
      Warn "$client CLI not found; skipping. Later: sdods mcp install $client"
    }
  }
}

function Remove-SDODS {
  Say ''
  Say 'This removes:'
  Say "  $SdodsHome"
  Say "  $BinDirPath\sdods.cmd"
  Say ''
  # Running in CI implies -Yes for installing, but never for deleting: consent to a
  # destructive action has to be explicit.
  if (-not $YesExplicit) { $script:AssumeYes = $false }
  if (-not (Confirm-Action 'Remove SDODS?')) { Say 'Cancelled.'; exit 0 }
  if ($DryRun) { Say "   would remove $SdodsHome and the shim"; exit 0 }
  foreach ($shim in @('sdods.cmd', 'sdods.ps1')) {
    $p = Join-Path $BinDirPath $shim
    if (Test-Path $p) { Remove-Item -Force $p; Ok "Removed $p" }
  }
  if ($SdodsHome -eq $env:USERPROFILE -or $SdodsHome -eq 'C:\' -or -not $SdodsHome) {
    Die 1 "Refusing to remove $SdodsHome — that is not an SDODS install root."
  }
  if (Test-Path $SdodsHome) { Remove-Item -Recurse -Force $SdodsHome; Ok "Removed $SdodsHome" }
  Say ''
  Say 'SDODS is uninstalled. Workspaces you created are untouched.'
  Say 'Browser engines stay in %USERPROFILE%\AppData\Local\ms-playwright.'
  exit 0
}

function Show-VersionCheck {
  Bold "SDODS installer v$InstallerVersion"
  Say "  os              windows/$($env:PROCESSOR_ARCHITECTURE.ToLower())"
  Say "  powershell      $($PSVersionTable.PSVersion)"
  Say "  node            $(Probe 'node') (need >= v$NodeMinMajor)"
  Say "  npm             $(Probe 'npm')"
  Say "  bun             $(Probe 'bun')"
  Say "  pnpm            $(Probe 'pnpm')"
  Say "  git             $(Probe 'git')"
  Say "  claude          $(Probe 'claude')"
  Say "  codex           $(Probe 'codex')"
  Say "  install source  $SourceOpt (ref $(Resolve-Ref))"
  Say "  install root    $SdodsHome"
  Say "  bin dir         $BinDirPath"
  Say "  browsers        $BrowsersOpt"
  exit 0
}

function Show-NextSteps {
  Say ''
  Bold 'SDODS is ready.'
  Say ''
  Say '  Run the demo suite (projects come from the current directory)'
  if ($WorkspacePath) {
    Say "    cd $WorkspacePath"
  } elseif ($AppDir -and (Test-Path $AppDir)) {
    Say "    cd $AppDir"
  } else {
    Say '    sdods init C:\my-tests        # scaffolds a workspace with the demo'
    Say '    cd C:\my-tests'
  }
  Say '    sdods run -p demo-shop -e staging -l api'
  Say '    sdods run -p demo-shop -e staging -l ui -b chromium -t @smoke'
  Say ''
  Say '  Start from your own app'
  Say '    sdods analyze C:\path\to\your-app --apply'
  Say '    sdods init C:\my-tests'
  Say ''
  Say '  See results'
  Say '    sdods report --last --open'
  Say '    sdods serve                        # web UI on http://127.0.0.1:4444'
  Say ''
  Say '  Use it from Claude Code or Codex'
  Say '    sdods mcp install claude           # or: codex'
  Say '    sdods agent install --for all'
  Say ''
  Say "  Check the setup     sdods doctor"
  Say "  Docs                $DocsUrl"
  Say "  Request a feature   sdods feedback --feature"
  if ($SponsorEnabled) { Say "  Sponsor SDODS       https://sdods.com/sponsor/" }
  Say ''
}

# ── main ─────────────────────────────────────────────────────────────────────────────────────
if ($Help) { Show-Usage; exit 0 }
if ($VersionCheck) { Show-VersionCheck }
if ($Uninstall) { Remove-SDODS }

Say ''
Bold "Installing SDODS (windows/$($env:PROCESSOR_ARCHITECTURE.ToLower()))"
if ($DryRun) { Warn 'Dry run: nothing will be written.' }

Test-Prerequisites
Resolve-PackageManager

# npm is the expected path: it installs a few MB of compiled packages. The git path clones the
# whole monorepo and installs every workspace's dependencies (~1.5 GB), so `auto` no longer falls
# back to it silently -- a registry outage should say so rather than hand someone a source tree.
$SourceUsed = 'npm'
if ($SourceOpt -eq 'git') {
  $SourceUsed = 'git'
} elseif (-not (Test-NpmPublished)) {
  if ($SourceOpt -eq 'npm') {
    Die 7 '@sdods/cli is not available on the npm registry.' @('Check your registry and network, or install from source with: -Source git')
  }
  Die 7 '@sdods/cli could not be found on the npm registry.' @(
    'If the registry is reachable this is usually temporary -- retry shortly.',
    'To build from source instead (clones the repo, needs ~1.5 GB): -Source git')
}

if ($SourceUsed -eq 'npm') {
  # No checkout on this path. AppDir stays empty; everything downstream must tolerate that
  # rather than treat it as a directory.
  $AppDirLegacy = $AppDir
  $AppDir = ''
  Invoke-SourceMigration
  Install-FromNpm
  Resolve-GlobalBin
  Write-NpmShim
  Install-Browsers
  Add-ToPath
} else {
  Install-FromGit (Resolve-Ref)
  Install-Browsers
  Write-Shim
  Add-ToPath
}
New-Workspace
Register-Mcp

if (-not $DryRun) {
  Say ''
  Step 'Checking the installation'
  # SDODS discovers projects from the current directory, so check from the workspace when we made
  # one -- otherwise doctor reports "projects none" on a perfectly good install.
  $doctorDir = $WorkspacePath
  if ((-not $doctorDir) -or (-not (Test-Path $doctorDir))) { $doctorDir = $AppDir }
  if ((-not $doctorDir) -or (-not (Test-Path $doctorDir))) { $doctorDir = (Get-Location).Path }
  try { Invoke-Step (Get-SdodsCmd) @('doctor') $doctorDir }
  catch { Warn 'doctor reported problems; the items above tell you what to fix.' }
}
Show-NextSteps

# Exit explicitly: probes such as `npm view` leave a non-zero $LASTEXITCODE behind, and a shell
# that checks the exit code would read a successful install as a failure.
exit 0
