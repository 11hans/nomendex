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

# Bundle the pinned Claude CLI from the Agent SDK. The compiled sidecar cannot
# require.resolve node_modules, so SidecarLauncher points CLAUDE_CLI_PATH here.
# See bun-sidecar/src/lib/claude-cli.ts for why the global CLI must not be used.
SDK_DIR="../bun-sidecar/node_modules/@anthropic-ai/claude-agent-sdk"
CLI_DEST="$APP_DIR/Contents/Resources/claude-cli"
if [ -f "$SDK_DIR/cli.js" ]; then
  echo "[pkg] bundling Claude CLI from Agent SDK..."
  mkdir -p "$CLI_DEST/vendor/ripgrep"
  cp -f "$SDK_DIR/cli.js" "$SDK_DIR/package.json" "$CLI_DEST/"
  cp -f "$SDK_DIR"/*.wasm "$CLI_DEST/" 2>/dev/null || true
  cp -f "$SDK_DIR/vendor/ripgrep/COPYING" "$CLI_DEST/vendor/ripgrep/" 2>/dev/null || true
  # Only darwin ripgrep builds; linux/win32 vendor dirs would triple the size
  for rg_arch in arm64-darwin x64-darwin; do
    if [ -d "$SDK_DIR/vendor/ripgrep/$rg_arch" ]; then
      cp -R "$SDK_DIR/vendor/ripgrep/$rg_arch" "$CLI_DEST/vendor/ripgrep/"
    fi
  done
else
  echo "[pkg] Warning: Agent SDK cli.js not found; packaged app will fall back to the global claude CLI"
fi

# Bundle the bun runtime so the sidecar can spawn the JS CLI — GUI apps get a
# minimal PATH without bun/node. SidecarLauncher prepends Resources/bin to PATH.
BUN_BIN="$(command -v bun || true)"
if [ -n "$BUN_BIN" ]; then
  mkdir -p "$APP_DIR/Contents/Resources/bin"
  cp -f "$BUN_BIN" "$APP_DIR/Contents/Resources/bin/bun"
  chmod +x "$APP_DIR/Contents/Resources/bin/bun"
else
  echo "[pkg] Warning: bun not on PATH; sidecar will use its BUN_BE_BUN fallback for direct CLI spawns"
fi

# Codesign ad-hoc with entitlements (required for EventKit calendar access)
codesign --force --deep --sign - --entitlements macos-host/entitlements.plist "$APP_DIR"

echo "[pkg] done: $APP_DIR"

