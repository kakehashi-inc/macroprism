# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [v0.4.1] - 2026-07-03

### Added

- HTTPS proxies now have a configurable **bind address** setting with three options: **Local only** (default — `127.0.0.1` and `::1`), **All addresses** (`0.0.0.0` and `::`, reachable from other machines), and **Custom** (any number of addresses, freely editable). The proxy list shows the selected option, or the addresses themselves for Custom. Existing proxies are switched to "Local only" automatically; if you were accessing a proxy from another machine, switch it to "All addresses". Because `localhost` is now served over IPv6 (`::1`) as well, browsers connect instantly instead of waiting for a failed IPv6 attempt on every connection — pages loaded through `https://localhost:...` feel noticeably faster.
- HTTPS proxy certificates are now issued by a built-in **local CA** ("MacroPrism Local CA") instead of being individually self-signed. Download the CA certificate with the new button on the HTTPS proxy page and register it in your OS trust store once (on Windows, double-click the downloaded `.crt` file and install it under "Trusted Root Certification Authorities"). After that, browsers accept every proxy without warnings — including proxies added later and renewed certificates — and features that require a fully trusted HTTPS connection, such as Service Workers, work as well. Registering the CA is always your own action; MacroPrism never modifies the trust store. Existing proxy certificates are replaced with CA-signed ones automatically the next time each proxy starts.
- Opening an HTTPS proxy port with a plain `http://` URL (for example `http://localhost:8443/`) now redirects the browser to the same address over `https://` instead of failing, without the request ever reaching the backend service.

### Changed

- Deleting an HTTPS proxy from the list now asks for confirmation instead of deleting immediately. The confirmation defaults to cancel.

### Fixed

- Plain-text responses from a service behind an HTTPS proxy now have their `http://` links upgraded to HTTPS, the same way HTML and JSON responses already do.
- Content served through an HTTPS proxy could arrive corrupted (garbled pages or data) when the backend compressed it with certain formats such as zstd. Such responses are now delivered unchanged (note that `http://` links inside them are not upgraded).

## [v0.4.0] - 2026-07-02

### Added

- Each HTTPS proxy is now set up under a name and can serve several hostnames and forward several ports at once. A single proxy can cover multiple services together — for example different ports on `localhost` — and respond to more than one hostname.
- HTTPS proxy hostnames can use wildcards (for example `*.example.local`), letting you prepare a certificate that covers any subdomain in advance. The certificate is kept in sync with the proxy's hostnames automatically — when you add or remove a hostname, it is regenerated to match on the next start.
- A service behind an HTTPS proxy now stays on HTTPS when it **redirects** the browser to its own `http://` address — previously only `http://` links inside the page content were upgraded, so redirects could drop the browser back to HTTP. Redirects and in-page links are now handled the same way, and only for the hostnames and ports you configured (addresses for other hosts or ports are left unchanged).

### Changed

- Existing HTTPS proxy settings are upgraded automatically on first launch, so all of the above is available without any manual reconfiguration.
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
