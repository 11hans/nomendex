#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="Nomendex"
APP_DIR="bundle/${APP_NAME}.app"

echo "[pkg] assembling ${APP_DIR}..."
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/public" "$APP_DIR/Contents/Resources/sidecar" "$APP_DIR/Contents/Frameworks"

# Copy host binary and plists/resources
cp -f macos-host/Info.plist "$APP_DIR/Contents/Info.plist"
cp -fR macos-host/Resources/. "$APP_DIR/Contents/Resources/" || true
cp -f build/host/${APP_NAME} "$APP_DIR/Contents/MacOS/${APP_NAME}"

# Copy Sparkle.framework for auto-updates
if [ -d "Frameworks/Sparkle/Sparkle.framework" ]; then
  echo "[pkg] copying Sparkle.framework..."
  cp -R "Frameworks/Sparkle/Sparkle.framework" "$APP_DIR/Contents/Frameworks/"
else
  echo "[pkg] Warning: Sparkle.framework not found. Run ./scripts/download_sparkle.sh"
fi

# No need to copy UI files - using direct HTML imports in sidecar binary
echo "[pkg] Using direct HTML imports (no separate UI build needed)"

# Copy sidecar binary (compiled) if present, else fallback to script
if [ -f build/sidecar/sidecar ]; then
  cp -f build/sidecar/sidecar "$APP_DIR/Contents/Resources/sidecar/sidecar"
  chmod +x "$APP_DIR/Contents/Resources/sidecar/sidecar"

else
  echo "[pkg] Warning: compiled sidecar missing. Falling back to server.ts"
  mkdir -p "$APP_DIR/Contents/Resources/sidecar"
  cp -f sidecar/server.ts "$APP_DIR/Contents/Resources/sidecar/server.ts"
fi

# Bundle the pinned native Claude CLI from the Agent SDK's platform package. The
# compiled sidecar cannot require.resolve node_modules, so SidecarLauncher points
# CLAUDE_CLI_PATH here. See bun-sidecar/src/lib/claude-cli.ts for why the global
# CLI must not be used. The binary ships signed (Anthropic Developer ID, hardened
# runtime), so it is copied as-is and never re-signed.
CLI_SRC="../bun-sidecar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"
CLI_DEST="$APP_DIR/Contents/Resources/claude-cli"
if [ -f "$CLI_SRC" ]; then
  echo "[pkg] bundling Claude CLI from Agent SDK..."
  mkdir -p "$CLI_DEST"
  cp -f "$CLI_SRC" "$CLI_DEST/claude"
  chmod +x "$CLI_DEST/claude"
else
  echo "[pkg] Warning: Agent SDK native CLI not found; packaged app will fall back to the global claude CLI"
fi

# Bundle the bun runtime — GUI apps get a minimal PATH without bun/node, and
# user-defined stdio MCP servers may launch via bun. SidecarLauncher prepends
# Resources/bin to PATH.
BUN_BIN="$(command -v bun || true)"
if [ -n "$BUN_BIN" ]; then
  mkdir -p "$APP_DIR/Contents/Resources/bin"
  cp -f "$BUN_BIN" "$APP_DIR/Contents/Resources/bin/bun"
  chmod +x "$APP_DIR/Contents/Resources/bin/bun"
else
  echo "[pkg] Warning: bun not on PATH; sidecar will use its BUN_BE_BUN fallback for direct CLI spawns"
fi

# `bun build --compile` leaves an invalid linker signature on the sidecar, and
# `--deep` below does not re-sign binaries under Resources/. macOS then SIGKILLs
# the sidecar at launch (Code Signature Invalid) → white screen. Sign it explicitly.
if [ -f "$APP_DIR/Contents/Resources/sidecar/sidecar" ]; then
  codesign --force --sign - "$APP_DIR/Contents/Resources/sidecar/sidecar"
fi

# Codesign ad-hoc with entitlements (required for EventKit calendar access)
codesign --force --deep --sign - --entitlements macos-host/entitlements.plist "$APP_DIR"

echo "[pkg] done: $APP_DIR"

