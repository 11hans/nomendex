---
name: versioning
description: Document how to update app version numbers and release new versions. Use when bumping version, preparing a release, or understanding the versioning system.
---

# Versioning

## Single Source of Truth

All version information comes from:
```
mac-app/macos-host/Info.plist
```

Two version fields:
- **CFBundleShortVersionString**: Display version (e.g., `0.2.0-alpha.4`)
- **CFBundleVersion**: Build number (e.g., `5`) - must be incremented for every release

## How to Update Version

1. Edit `mac-app/macos-host/Info.plist`
2. Update both fields:

```xml
<key>CFBundleShortVersionString</key>
<string>0.2.0-alpha.5</string>
<key>CFBundleVersion</key>
<string>6</string>
```

**Important**: Always increment CFBundleVersion. Sparkle uses this numeric value to determine if an update is available.

## Version Format

Follow semantic versioning with optional pre-release identifiers:
- `MAJOR.MINOR.PATCH` for stable releases (e.g., `1.0.0`)
- `MAJOR.MINOR.PATCH-alpha.N` for alpha releases (e.g., `0.2.0-alpha.4`)
- `MAJOR.MINOR.PATCH-beta.N` for beta releases (e.g., `0.2.0-beta.1`)

## Release Process

1. Update version in `Info.plist` (both fields)
2. Commit the change
3. Push to main
4. Go to GitHub Actions and manually trigger the "Release macOS App" workflow
5. The workflow will:
   - Read version from Info.plist
   - Build and sign the app
   - Notarize with Apple
   - Create GitHub release with tag `v{version}`
   - Update the appcast at releases.noetect.com

## Where Version is Used

| Location | Source | Purpose |
|----------|--------|---------|
| Info.plist | Manual edit | Single source of truth |
| GitHub Release | Workflow reads Info.plist | Release tag and assets |
| Appcast XML | Workflow reads Info.plist | Sparkle update detection |
| UI Sidebar | `/api/version` endpoint | Display to user |

## API Endpoint

The sidecar serves version info at `/api/version`:
```json
{
  "version": "0.2.0-alpha.4",
  "buildNumber": "5"
}
```

This reads from Info.plist at runtime, checking multiple paths for dev vs bundled app.

## Sparkle Update Detection

Sparkle compares CFBundleVersion (build number) to determine updates:
- Current app: build `5`
- Appcast shows: build `6`
- Result: Update available

This is why CFBundleVersion must always increase, even for the same display version.
