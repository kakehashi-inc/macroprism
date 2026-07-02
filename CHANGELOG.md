# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Renamed the application from "MCP Server Manager" to "MacroPrism", reflecting that it has grown into a general-purpose tool to run, connect, publish, and monitor local processes. UI labels now say "Process" instead of "MCP Server", and process definitions in the configuration file are stored under the `processes` key instead of `mcpServers` (existing configuration files are migrated automatically on first startup; downgrading to an older version afterwards is not supported). Data locations and the executable name are unchanged.

## [v0.3.1] - 2026-06-05

### Fixed

- Auto-update now works correctly on macOS. Previously, starting an update could do nothing with no progress or error shown, or the download would succeed but the app would still not move to the new version after quitting. (Note: this fix takes effect from the next release onward. If you are on the current version, please install the new version manually once; auto-update will work after that.)
- Starting an update now always shows feedback. A progress bar appears immediately while downloading, and if the download fails, a clear error message with **Retry** and **Close** options is shown instead of the dialog appearing to hang.
- Update checks that run quietly in the background (for example, when you are offline) no longer pop up an error. Errors are only shown for updates you started yourself.

## [v0.3.0] - 2026-05-21

### Added

- Auto-update support via `electron-updater` (GitHub provider). Notifies the user with a Snackbar when a new version is available, downloads and applies the update from the renderer.
- IPC channels for the updater (`updater:check`, `updater:download`, `updater:quit-and-install`, `updater:get-state`, `updater:state-changed`) and a preload `updater` bridge API.
- i18n keys (`updater.confirm`, `updater.update`, `updater.later`, `updater.downloading`, `updater.installing`) for ja/en.
- `scripts/zip-portable.js`: electron-builder `afterAllArtifactBuild` hook that compresses the Windows portable `.exe` into a `.zip` and removes the original `.exe`. Mitigates SmartScreen and AV warnings caused by serving an unsigned raw executable.

### Changed

- Upgrade `@mui/material` and `@mui/icons-material` from v7 to v9.
- Set `tsconfig.json` `moduleResolution` to `"bundler"` (required by MUI v9 `.d.mts`-only types) and override it to `"node"` in `tsconfig.main.json` (CommonJS main process).
- Migrate MUI v9 deprecations: move `alignItems`/`justifyContent` from `Stack` props into `sx`, replace `TextField` `InputProps` with `slotProps`, and replace legacy `Typography` `color='textSecondary'` with `color='text.secondary'`.
- `electron-builder.yml`: switch `publish.repo` to a bare repository name and set `publish.releaseType` to `draft` so per-platform release commands aggregate into the same draft release.
- `UpdaterService`: skip all auto-updater operations when running from the portable build (detected via `process.env.PORTABLE_EXECUTABLE_FILE`). Prevents the portable executable from downloading and launching the NSIS installer.
