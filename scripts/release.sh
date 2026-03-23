#!/bin/bash
set -e

# Bottega release script — builds, signs, notarizes, and publishes to GitHub Releases.
# Usage: ./scripts/release.sh [patch|minor|major]
#
# Prerequisites:
#   - Developer ID Application certificate in local Keychain
#   - GH_TOKEN env var or gh CLI authenticated
#   - APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID env vars for notarization

BUMP="${1:-patch}"

# Verify signing identity exists
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "Error: No Developer ID Application certificate found in Keychain"
  exit 1
fi

# Verify GitHub token
if [ -z "$GH_TOKEN" ]; then
  GH_TOKEN=$(gh auth token 2>/dev/null || true)
  if [ -z "$GH_TOKEN" ]; then
    echo "Error: Set GH_TOKEN or authenticate with gh CLI"
    exit 1
  fi
  export GH_TOKEN
fi

# Bump version and create tag
VERSION=$(npm version "$BUMP")
echo "Releasing $VERSION"

# Build
npm run build

# Package, sign, and publish to GitHub Releases
npx electron-builder --mac --publish always

# Push commit and tag
git push --follow-tags

echo ""
echo "Release $VERSION published to GitHub!"
echo "https://github.com/g3nx89/bottega/releases"
