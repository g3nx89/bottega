---
name: release
description: Use when releasing a new version of Bottega. Covers version bumping, CHANGELOG generation, README updates, git tagging, CI monitoring, and release publishing. Also provides pre-flight checks and repair for broken releases. Triggers include "release", "bump version", "new version", "publish release", "release check", "release status", "release fix".
---

# Bottega — Release Skill

Manage the full release lifecycle for the Bottega Electron app.

## Commands

| Command | Description |
|---------|-------------|
| `/release` | **Guided flow** — walks through the entire release process step by step |
| `/release check` | Pre-flight audit: CI status, orphan drafts, asset completeness, version coherence |
| `/release bump <major\|minor\|patch>` | Bump version, update CHANGELOG + README, commit, tag, push |
| `/release status` | Check CI workflow status for the latest tag |
| `/release publish` | Publish a draft release (verify assets first) |
| `/release fix` | Repair problems found by `check` — orphan drafts, missing assets, duplicates |

## Guided Flow (`/release` with no args)

When invoked without arguments, run the full release flow interactively:

1. **Pre-flight check** — run all checks from `/release check`
2. **Ask bump type** — prompt user for major/minor/patch (show current version and what each would produce)
3. **Generate CHANGELOG** — collect commits since last tag, classify by conventional commit type, update `CHANGELOG.md`
4. **Update README** — no version-specific content to change (badge is dynamic), but verify tool count and other stats are current
5. **Commit** — `chore: bump version to X.Y.Z` with updated package.json, CHANGELOG.md, README.md
6. **Tag + Push** — create `vX.Y.Z` tag, push branch and tag to origin
7. **Monitor CI** — poll `gh run list --workflow=release.yml` until the workflow completes
8. **Publish** — if CI created a draft, publish it; if CI published directly, verify assets are present
9. **Final verification** — confirm `latest-mac.yml` is accessible and points to correct version

## Pre-flight Checks (`/release check`)

Run ALL of these checks and report results:

```bash
# 1. Current version
node -p "require('./package.json').version"

# 2. Latest git tag
git tag --sort=-v:refname | head -1

# 3. Version coherence — package.json version should be the latest tag (or ahead for unreleased)
# Flag if package.json is BEHIND the latest tag

# 4. CI status on main
gh run list --branch=main --workflow=ci.yml --limit=1 --json status,conclusion

# 5. Uncommitted changes
git status --porcelain

# 6. All releases — check for orphan drafts (drafts with untagged-* tags)
gh api repos/g3nx89/bottega/releases --jq '.[] | select(.draft==true) | {id, tag_name, name, assets: [.assets[].name]}'

# 7. Latest published release — verify it has all 3 required assets
gh release view --json assets --jq '[.assets[].name]'
# Required: Bottega-X.Y.Z-arm64.dmg, Bottega-X.Y.Z-arm64-mac.zip, latest-mac.yml

# 8. latest-mac.yml content — verify version matches
gh release download --pattern 'latest-mac.yml' --output -
```

Report as a checklist with pass/fail per item.

## CHANGELOG Generation

Format: [Keep a Changelog](https://keepachangelog.com/)

### Commit Classification

| Prefix | Section |
|--------|---------|
| `feat:` | Added |
| `fix:` | Fixed |
| `perf:` | Changed |
| `refactor:` | Changed |
| `docs:` | (skip — don't include in CHANGELOG) |
| `chore:` | (skip) |
| `test:` | (skip) |
| `style:` | (skip) |
| `ci:` | (skip) |

### Process

1. Get commits since last tag: `git log <last-tag>..HEAD --pretty=format:"%s"`
2. Filter out `chore:`, `docs:`, `test:`, `style:`, `ci:` prefixes
3. Classify remaining commits into Added/Changed/Fixed sections
4. Move content from `## [Unreleased]` into new version section `## [X.Y.Z] - YYYY-MM-DD`
5. Add fresh empty `## [Unreleased]` section
6. Update comparison links at bottom of file

### CHANGELOG Structure

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature descriptions (from feat: commits)

### Changed
- Modification descriptions (from refactor:/perf: commits)

### Fixed
- Bug fix descriptions (from fix: commits)
```

## Version Bump (`/release bump`)

### Files to Update

1. **package.json** — `version` field
2. **CHANGELOG.md** — move Unreleased to new version, update links
3. **README.md** — verify tool count and stats match CLAUDE.md (badge is dynamic via GitHub API)

### Commit Convention

```
chore: bump version to X.Y.Z
```

### Tag and Push

```bash
git tag vX.Y.Z
git push origin main --follow-tags
```

## CI Monitoring (`/release status`)

```bash
# Find the workflow run for the latest tag
TAG=$(git tag --sort=-v:refname | head -1)
gh run list --workflow=release.yml --limit=5 --json databaseId,status,conclusion,displayTitle,createdAt

# For detailed status of a specific run
gh run view <run-id> --log | grep -i -E "(publish|release|error|fail)" | tail -20
```

Report: workflow status (queued/in_progress/completed), conclusion (success/failure), and link.

## Release Publishing (`/release publish`)

1. Check if latest tag has a draft release: `gh release view <tag> --json isDraft`
2. If draft with assets → publish: `gh api -X PATCH repos/g3nx89/bottega/releases/<id> -f draft=false`
3. If already published → verify 3 required assets are present
4. Final check: download and display `latest-mac.yml` to confirm version

## Release Repair (`/release fix`)

### Orphan Draft Detection & Fix

```bash
# Find orphan drafts (created by CI when tag already had a release)
gh api repos/g3nx89/bottega/releases --jq '.[] | select(.draft==true)'
```

Fix strategy:
1. If published release exists for same tag but is empty → delete it
2. Publish the draft (which has the assets)
3. If no published release exists → just publish the draft

### Missing Assets Fix

If a published release is missing assets but a draft exists with them:
1. Download assets from draft
2. Upload to published release with `gh release upload --clobber`
3. Delete the orphan draft

## GitHub Repository

- Owner: `g3nx89`
- Repo: `bottega`
- Release workflow: `.github/workflows/release.yml`
- Triggered by: pushing tags matching `v*`

## CI Workflow Behavior

The release workflow (after fix applied in this session):
- **If release already exists for tag**: uploads assets with `--clobber` (idempotent)
- **If no release exists**: creates a new release with `--latest` (published, not draft)
- Assets produced: `Bottega-X.Y.Z-arm64.dmg`, `Bottega-X.Y.Z-arm64-mac.zip`, `latest-mac.yml`

## Auto-Update Mechanism

- `electron-updater` checks `latest-mac.yml` from the latest GitHub release
- The ZIP (not DMG) is used for differential updates
- `latest-mac.yml` contains: version, file URL, SHA512, size, release date
- Check happens 5 seconds after app startup
- `autoDownload: false` — user must confirm via UI modal
- Error `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` is suppressed in `src/main/auto-updater.ts` — if `latest-mac.yml` is missing, update silently fails
