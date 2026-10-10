#!/usr/bin/env bash
# Downloads Sparkle framework for macOS app updates
set -euo pipefail
cd "$(dirname "$0")/.."

SPARKLE_VERSION="2.10.0"
SPARKLE_DIR="Frameworks/Sparkle"
SPARKLE_ZIP="Sparkle-${SPARKLE_VERSION}.tar.xz"
SPARKLE_URL="https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/${SPARKLE_ZIP}"

if [[ -d "$SPARKLE_DIR/Sparkle.framework" ]]; then
    INSTALLED_VERSION=$(plutil -extract CFBundleShortVersionString raw \
        "$SPARKLE_DIR/Sparkle.framework/Versions/B/Resources/Info.plist" 2>/dev/null || true)
    if [[ "$INSTALLED_VERSION" == "$SPARKLE_VERSION" ]]; then
        echo "[sparkle] Sparkle ${SPARKLE_VERSION} already exists, skipping download"
        exit 0
    fi
    echo "[sparkle] Replacing Sparkle ${INSTALLED_VERSION:-unknown} with ${SPARKLE_VERSION}..."
    rm -rf "$SPARKLE_DIR"
fi

echo "[sparkle] Downloading Sparkle ${SPARKLE_VERSION}..."
mkdir -p "$SPARKLE_DIR"
curl -L "$SPARKLE_URL" -o "$SPARKLE_DIR/$SPARKLE_ZIP"

echo "[sparkle] Extracting..."
tar -xf "$SPARKLE_DIR/$SPARKLE_ZIP" -C "$SPARKLE_DIR"

# Clean up
rm "$SPARKLE_DIR/$SPARKLE_ZIP"

echo "[sparkle] Sparkle.framework ready at $SPARKLE_DIR/Sparkle.framework"
