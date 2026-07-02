// Process configuration types
export interface ProcessConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
    displayName?: string;
    platform?: 'host' | 'wsl';
    wslDistribution?: string;
    autoStart?: boolean;
    autoRestartOnError?: boolean;
    // mcp-auth-proxy integration
    useAuthProxy?: boolean;
    authProxyListenPort?: number; // required when useAuthProxy
    authProxyExternalUrl?: string; // required when useAuthProxy
}

export interface Processes {
    [key: string]: ProcessConfig;
}

export interface ProcessStatus {
    id: string;
    pid?: number;
    status: 'running' | 'stopped' | 'error';
    startedAt?: string;
    cpu?: number;
    memory?: number;
    lastChecked: string;
}

export interface WSLDistribution {
    name: string;
    version: number;
    isDefault: boolean;
    state: 'Running' | 'Stopped';
}

// Settings Types
export interface AppSettings {
    language: 'ja' | 'en';
    darkMode: boolean;
    logDirectory: string;
    logRetentionDays: number;
    restartDelayMs: number;
    successfulStartThresholdMs: number;
    showWindowOnStartup?: boolean;
    // Ngrok settings
    ngrokAuthToken?: string;
    ngrokMetadataName?: string; // metadataに渡す識別名
    ngrokPorts?: string; // カンマ区切り "3000,4000"
    ngrokAutoStart?: boolean;
    // OIDC settings for mcp-auth-proxy
    oidcProviderName?: string; // 初期値: Auth0
    oidcConfigurationUrl?: string;
    oidcClientId?: string;
    oidcClientSecret?: string;
    oidcAllowedUsers?: string; // カンマ区切り
    oidcAllowedUsersGlob?: string; // 例: *@example.com
}

// Complete Config Structure
export interface AppConfig {
    processes: Processes;
    settings: AppSettings;
    httpsProxies?: HttpsProxies;
}

// IPC Channel Names
export const IPC_CHANNELS = {
    // Process Management
    PROCESS_LIST: 'process:list',
    PROCESS_CREATE: 'process:create',
    PROCESS_UPDATE: 'process:update',
    PROCESS_DELETE: 'process:delete',
    PROCESS_START: 'process:start',
    PROCESS_STOP: 'process:stop',
    PROCESS_STATUS: 'process:status',
    PROCESS_STATUS_UPDATE: 'process:status-update',

    // Config
    CONFIG_GET: 'config:get',
    CONFIG_UPDATE: 'config:update',

    // WSL
    WSL_CHECK: 'wsl:check',
    WSL_LIST_DISTRIBUTIONS: 'wsl:list-distributions',

    // Settings (kept for backward compatibility)
    SETTINGS_GET: 'settings:get',
    SETTINGS_UPDATE: 'settings:update',

    // Logs
    LOG_READ: 'log:read',
    LOG_CLEAR: 'log:clear',

    // System
    SYSTEM_INFO: 'system:info',
    APP_VERSION: 'system:app-version',
    APP_QUIT: 'app:quit',
    APP_MINIMIZE: 'app:minimize',
    APP_MAXIMIZE: 'app:maximize',

    // Ngrok
    NGROK_START: 'ngrok:start',
    NGROK_STOP: 'ngrok:stop',
    NGROK_STATUS: 'ngrok:status',
    NGROK_LOG_READ: 'ngrok:log:read',
    NGROK_LOG_CLEAR: 'ngrok:log:clear',

    // HTTPS Proxy
    HTTPS_PROXY_LIST: 'https-proxy:list',
    HTTPS_PROXY_CREATE: 'https-proxy:create',
    HTTPS_PROXY_UPDATE: 'https-proxy:update',
    HTTPS_PROXY_DELETE: 'https-proxy:delete',
    HTTPS_PROXY_START: 'https-proxy:start',
    HTTPS_PROXY_STOP: 'https-proxy:stop',
    HTTPS_PROXY_STATUS: 'https-proxy:status',
    HTTPS_PROXY_REGENERATE_CERT: 'https-proxy:regenerate-cert',
    HTTPS_PROXY_LOG_READ: 'https-proxy:log:read',
    HTTPS_PROXY_LOG_CLEAR: 'https-proxy:log:clear',

    // Updater
    UPDATER_CHECK: 'updater:check',
    UPDATER_DOWNLOAD: 'updater:download',
    UPDATER_QUIT_AND_INSTALL: 'updater:quit-and-install',
    UPDATER_GET_STATE: 'updater:get-state',
    UPDATER_STATE_CHANGED: 'updater:state-changed',
} as const;

// Updater Types
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateState {
    status: UpdateStatus;
    version?: string;
    progress?: number;
    error?: string;
}

// System Info
export interface SystemInfo {
    platform: NodeJS.Platform;
    arch: string;
    version: string;
    wslAvailable: boolean;
    homeDirectory: string;
}

// HTTPS Proxy Types
export interface HttpsProxyConfig {
    forwardPort: number; // HTTP target port on localhost
    listenPort: number; // HTTPS listen port
    autoStart?: boolean;
}

export interface HttpsProxies {
    [hostname: string]: HttpsProxyConfig;
}

export interface HttpsProxyStatus {
    hostname: string;
    forwardPort: number;
    listenPort: number;
    running: boolean;
    certPath: string;
    keyPath: string;
    validTo?: string; // ISO string
}
