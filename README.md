# MacroPrism

MacroPrism — automate, connect, publish, and monitor your local dev stack.

Electron-based GUI application to start/stop, monitor, log, and expose (via ngrok) arbitrary local processes.

Its core is generic process management. The optional `mcp-auth-proxy` integration is an auxiliary feature that adds OIDC authentication to a managed process, which also makes MacroPrism convenient for use cases such as running MCP servers.

## Features

- **Process Management**: Register arbitrary commands as managed processes, start/stop, status monitoring, error handling
- **Auto Start / Auto Restart**: Start on app launch, conditional auto-restart on abnormal exit
- **WSL Support (Windows)**: Run inside WSL with selectable distribution (`platform: "wsl"`)
- **Log Management**: Per-process daily log files for `stdout`/`stderr`, auto-clean by retention days, periodic rotation
- **ngrok Integration**: Open multiple ports at once, show/copy URLs, view/clear ngrok logs
- **HTTPS Proxy Management**: Terminate TLS locally and forward to local HTTP, per-day logs, certificates issued and auto-renewed by a built-in local CA (register the downloadable CA certificate in your OS trust store once to remove browser warnings)
- **Auth Proxy (Optional)**: Attach `mcp-auth-proxy` to a process to add OIDC authentication
- **i18n/Theme**: Japanese/English, light/dark modes

## Supported OS

- Windows 10/11
- macOS 10.15+
- Linux (Debian-based/RHEL-based)

Note: This project is not code-signed on Windows. If SmartScreen displays a warning, select "More info" → "Run anyway".

## Data Files Location

All data is stored under the `~/.mcpm` directory (`mcpm` is an internal identifier taken from the consonants of **M**a**c**ro **P**ris**m**):

- **Config File**: `~/.mcpm/config.json`
- **Log Files**: `~/.mcpm/logs/`
  - Process logs: `{server_id}_YYYYMMDD_stdout.log`, `{server_id}_YYYYMMDD_stderr.log`
  - ngrok logs: `ngrok_YYYYMMDD.log`
  - HTTPS proxy logs: `https_proxy_YYYYMMDD.log`

### File Structure

```text
~/.mcpm/
├── config.json      # Settings and process definitions
├── certs/           # Certificates for the HTTPS proxy
│   ├── ca/          # Local CA that signs all proxy certificates
│   │   ├── ca-cert.pem
│   │   └── ca-key.pem
│   └── <proxy name>/
│       ├── cert.pem
│       └── key.pem
└── logs/            # Log files
    ├── {server_id}_YYYYMMDD_stdout.log
    ├── {server_id}_YYYYMMDD_stderr.log
    ├── ngrok_YYYYMMDD.log
    └── https_proxy_YYYYMMDD.log
```

### config.json Format

Configuration file generated based on the app's default `DEFAULT_CONFIG`. Configuration files created by older versions are migrated to the new layout automatically on startup:

```json
{
  "processes": {
    "web-app": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "NODE_ENV": "production"
      },
      "displayName": "Web App",
      "platform": "host",
      "autoStart": true,
      "autoRestartOnError": true,
      "useAuthProxy": false
    },
    "batch-worker": {
      "command": "python",
      "args": ["worker.py"],
      "displayName": "Batch Worker",
      "platform": "wsl",
      "wslDistribution": "Ubuntu",
      "autoStart": false
    }
  },
  "settings": {
    "language": "ja",
    "darkMode": false,
    "logDirectory": "~/.mcpm/logs",
    "logRetentionDays": 7,
    "restartDelayMs": 5000,
    "successfulStartThresholdMs": 10000,
    "showWindowOnStartup": true,
    "ngrokAuthToken": "",
    "ngrokMetadataName": "MacroPrism",
    "ngrokPorts": "3000,4000",
    "ngrokAutoStart": false,
    "httpsProxies": {
      "my-proxy": {
        "bindMode": "local",
        "bindAddresses": [],
        "hostnames": ["localhost", "*.example.local"],
        "portMappings": [
          { "from": 8080, "to": 8443 },
          { "from": 9090, "to": 9443 }
        ],
        "autoStart": true
      }
    },
    "oidcProviderName": "Auth0",
    "oidcConfigurationUrl": "",
    "oidcClientId": "",
    "oidcClientSecret": "",
    "oidcAllowedUsers": "",
    "oidcAllowedUsersGlob": ""
  }
}
```

#### Process Configuration Fields (`processes`)

- **command**: Executable command
- **args**: Argument array
- **env**: Environment variables
- **displayName**: Display name
- **platform**: Execution environment ("host" | "wsl")
- **wslDistribution**: WSL distribution name (when using WSL)
- **autoStart**: Auto-start on app launch
- **autoRestartOnError**: Auto-restart on abnormal exit (conditional)
- **useAuthProxy**: Wrap execution with mcp-auth-proxy
- **authProxyListenPort** / **authProxyExternalUrl**: Required fields when using Auth Proxy

#### HTTPS Proxy Configuration Fields (`httpsProxies`)

Each entry is keyed by a **proxy name** (an arbitrary identifier).

- **bindMode**: How listen addresses are chosen. `"local"` (default) listens on `127.0.0.1` and `::1`; `"all"` listens on `0.0.0.0` (all IPv4) and `::` (all IPv6); `"custom"` listens on the addresses in `bindAddresses`.
- **bindAddresses**: Addresses used when `bindMode` is `"custom"` (e.g. `127.0.0.1`, `::1`, `0.0.0.0`). Any number of entries; at least one is required.
- **hostnames**: Hostnames served by this proxy. Used as the certificate SAN and to decide which `http://` URLs are upgraded to HTTPS on redirects and in page content. Wildcards such as `*.example.local` are supported (added to the certificate as a wildcard SAN).
- **portMappings**: One or more port mappings. Each `{ "from": <http port>, "to": <https port> }` starts an HTTPS listener on `to` (on every bind address) that forwards to `http://127.0.0.1:<from>`.
- **autoStart**: Start this proxy automatically on app launch.

Settings created by older versions (a single `forwardPort`/`listenPort` keyed by hostname) are migrated to this format automatically on startup. Entries without `bindMode` are migrated to `"local"`, or to `"custom"` when they already carry a non-default `bindAddresses` list.

## Developer Reference

### Requirements

- Node.js 22.x or higher
- yarn 4
- Git

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd <repository-name>

# Install dependencies
yarn install

# Start development
yarn dev
```

DevTools in development:

- DevTools open in detached mode automatically
- Toggle with F12 or Ctrl+Shift+I (Cmd+Option+I on macOS)

### Build/Distribute

- Windows: `yarn dist:win`
- macOS: `yarn dist:mac`
- Linux: `yarn dist:linux`

In development the app uses BrowserRouter with `<http://localhost:3001>`, and in production it uses HashRouter to load `dist/renderer/index.html`.

### Direct Release to GitHub (for Auto-Update)

These commands directly upload the build artifacts and `latest*.yml` (auto-update metadata) to the GitHub repository configured in `publish:` of `electron-builder.yml`. Because of the `releaseType: draft` setting, each command **aggregates into the same draft release for that version** on GitHub. Once all platforms are in place, press "Publish release" in the GitHub UI to deliver it to users.

- Windows: `yarn release:win`
- macOS: `yarn release:mac`
- Linux: `yarn release:linux`

Before running, set a GitHub Personal Access Token (`public_repo` scope) in the `GH_TOKEN` environment variable.

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
```

When building each platform on multiple machines, make sure the `version` in `package.json` matches across all machines, then run the corresponding `release:*` command on each machine in turn.

### macOS Prerequisite: Signing & Notarization Environment Variables

To build a signed and notarized macOS distribution, set the following environment variables before running `yarn dist:mac`:

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

### Windows Prerequisite: Developer Mode

When building or running unsigned local releases on Windows, enable Developer Mode:

1. Open Settings → Privacy & security → For developers
2. Turn on "Developer Mode"
3. Reboot the OS

### Project Structure (excerpt)

```text
src/
├── main/                  # Electron main: IPC and managers
│   ├── index.ts           # App boot / window / service init
│   ├── ipc/               # IPC handlers
│   ├── services/          # Various services
│   └── utils/             # Various utilities
├── preload/               # Safe bridge APIs to renderer
├── renderer/              # React + MUI UI
├── shared/                # Types and constants (defaults/paths)
└── public/                # Icons, etc.
```

### Tech Stack

- **Electron**
- **React (MUI v7)**
- **TypeScript**
- **Zustand**
- **i18next**
- **Vite**

### Create Windows Icon

```exec
magick public/icon.png -define icon:auto-resize=256,128,96,64,48,32,24,16 public/icon.ico
```

### About WSL (Windows)

- On startup, the app detects WSL availability and retrieves the distribution list, default, and running states using `wsl.exe -l -q/-v`

### Notes

- ngrok may fail to start when hitting the concurrent session limit. Disconnect unnecessary sessions from CLI/Desktop or the Agents section in the dashboard.
- Closing with "×" minimizes the app to the tray instead of quitting. Use "Quit" from the tray menu to exit.
