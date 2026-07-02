import { contextBridge, ipcRenderer } from 'electron';

const IPC_CHANNELS = {
    PROCESS_LIST: 'process:list',
    PROCESS_CREATE: 'process:create',
    PROCESS_UPDATE: 'process:update',
    PROCESS_DELETE: 'process:delete',
    PROCESS_START: 'process:start',
    PROCESS_STOP: 'process:stop',
    PROCESS_STATUS: 'process:status',
    PROCESS_STATUS_UPDATE: 'process:status-update',
    CONFIG_GET: 'config:get',
    CONFIG_UPDATE: 'config:update',
    WSL_CHECK: 'wsl:check',
    WSL_LIST_DISTRIBUTIONS: 'wsl:list-distributions',
    SETTINGS_GET: 'settings:get',
    SETTINGS_UPDATE: 'settings:update',
    LOG_READ: 'log:read',
    LOG_CLEAR: 'log:clear',
    SYSTEM_INFO: 'system:info',
    APP_VERSION: 'system:app-version',
    APP_QUIT: 'app:quit',
    APP_MINIMIZE: 'app:minimize',
    APP_MAXIMIZE: 'app:maximize',
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
    HTTPS_PROXY_EXPORT_CA_CERT: 'https-proxy:export-ca-cert',
    HTTPS_PROXY_LOG_READ: 'https-proxy:log:read',
    HTTPS_PROXY_LOG_CLEAR: 'https-proxy:log:clear',

    // Updater
    UPDATER_CHECK: 'updater:check',
    UPDATER_DOWNLOAD: 'updater:download',
    UPDATER_QUIT_AND_INSTALL: 'updater:quit-and-install',
    UPDATER_GET_STATE: 'updater:get-state',
    UPDATER_STATE_CHANGED: 'updater:state-changed',
} as const;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Process Management
    processAPI: {
        list: () => ipcRenderer.invoke(IPC_CHANNELS.PROCESS_LIST),
        create: (id: string, config: any) => ipcRenderer.invoke(IPC_CHANNELS.PROCESS_CREATE, id, config),
        update: (id: string, config: any) => ipcRenderer.invoke(IPC_CHANNELS.PROCESS_UPDATE, id, config),
        delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PROCESS_DELETE, id),
        start: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PROCESS_START, id),
        stop: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PROCESS_STOP, id),
        getStatus: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PROCESS_STATUS, id),
        onStatusUpdate: (callback: (id: string, status: any) => void) => {
            ipcRenderer.on(IPC_CHANNELS.PROCESS_STATUS_UPDATE, (_, id, status) => callback(id, status));
        },
    },

    // Config
    configAPI: {
        get: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET),
        update: (config: any) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_UPDATE, config),
    },

    // Settings (backward compatibility)
    settingsAPI: {
        get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
        update: (settings: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, settings),
    },

    // WSL
    wslAPI: {
        check: () => ipcRenderer.invoke(IPC_CHANNELS.WSL_CHECK),
        listDistributions: () => ipcRenderer.invoke(IPC_CHANNELS.WSL_LIST_DISTRIBUTIONS),
    },

    // Logs
    logAPI: {
        read: (processId: string, type: 'stdout' | 'stderr', lines?: number) =>
            ipcRenderer.invoke(IPC_CHANNELS.LOG_READ, processId, type, lines),
        clear: (processId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOG_CLEAR, processId),
    },

    // System
    systemAPI: {
        getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_INFO),
        getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION),
    },

    // Ngrok
    ngrokAPI: {
        start: () => ipcRenderer.invoke(IPC_CHANNELS.NGROK_START),
        stop: () => ipcRenderer.invoke(IPC_CHANNELS.NGROK_STOP),
        status: () => ipcRenderer.invoke(IPC_CHANNELS.NGROK_STATUS),
        readLogs: (lines?: number) => ipcRenderer.invoke(IPC_CHANNELS.NGROK_LOG_READ, lines),
        clearLogs: () => ipcRenderer.invoke(IPC_CHANNELS.NGROK_LOG_CLEAR),
    },

    // HTTPS Proxy
    httpsProxyAPI: {
        list: () => ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_LIST),
        status: () => ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_STATUS),
        create: (hostname: string, cfg: any) => ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_CREATE, hostname, cfg),
        update: (hostname: string, cfg: any) => ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_UPDATE, hostname, cfg),
        remove: (hostname: string) => ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_DELETE, hostname),
        start: (hostname: string) => ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_START, hostname),
        stop: (hostname: string) => ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_STOP, hostname),
        regenerateCert: (hostname: string) => ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_REGENERATE_CERT, hostname),
        exportCaCert: () => ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_EXPORT_CA_CERT),
        readLogs: (hostname: string, lines?: number) =>
            ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_LOG_READ, hostname, lines),
        clearLogs: (hostname: string) => ipcRenderer.invoke(IPC_CHANNELS.HTTPS_PROXY_LOG_CLEAR, hostname),
    },

    // Window controls
    windowAPI: {
        minimize: () => ipcRenderer.send(IPC_CHANNELS.APP_MINIMIZE),
        maximize: () => ipcRenderer.send(IPC_CHANNELS.APP_MAXIMIZE),
        close: (force?: boolean) => ipcRenderer.send(IPC_CHANNELS.APP_QUIT, !!force),
    },

    // Updater
    updater: {
        getState: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_GET_STATE),
        check: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK),
        download: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_DOWNLOAD),
        quitAndInstall: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL),
        onStateChanged: (callback: (state: any) => void) => {
            const listener = (_: unknown, state: any) => callback(state);
            ipcRenderer.on(IPC_CHANNELS.UPDATER_STATE_CHANGED, listener);
            return () => {
                ipcRenderer.removeListener(IPC_CHANNELS.UPDATER_STATE_CHANGED, listener);
            };
        },
    },
});

// Type declarations for TypeScript
declare global {
    interface Window {
        electronAPI: {
            processAPI: {
                list: () => Promise<any[]>;
                create: (id: string, config: any) => Promise<any>;
                update: (id: string, config: any) => Promise<any>;
                delete: (id: string) => Promise<boolean>;
                start: (id: string) => Promise<boolean>;
                stop: (id: string) => Promise<boolean>;
                getStatus: (id: string) => Promise<any>;
                onStatusUpdate: (callback: (id: string, status: any) => void) => void;
            };
            configAPI: {
                get: () => Promise<any>;
                update: (config: any) => Promise<any>;
            };
            settingsAPI: {
                get: () => Promise<any>;
                update: (settings: any) => Promise<any>;
            };
            wslAPI: {
                check: () => Promise<boolean>;
                listDistributions: () => Promise<any[]>;
            };
            logAPI: {
                read: (processId: string, type: 'stdout' | 'stderr', lines?: number) => Promise<string[]>;
                clear: (processId: string) => Promise<void>;
            };
            systemAPI: {
                getInfo: () => Promise<any>;
                getAppVersion: () => Promise<string>;
            };
            ngrokAPI: {
                start: () => Promise<any[]>;
                stop: () => Promise<boolean>;
                status: () => Promise<any[]>;
                readLogs: (lines?: number) => Promise<string[]>;
                clearLogs: () => Promise<void>;
            };
            httpsProxyAPI: {
                list: () => Promise<any>;
                status: () => Promise<any[]>;
                create: (hostname: string, cfg: any) => Promise<boolean>;
                update: (hostname: string, cfg: any) => Promise<boolean>;
                remove: (hostname: string) => Promise<boolean>;
                start: (hostname: string) => Promise<any>;
                stop: (hostname: string) => Promise<boolean>;
                regenerateCert: (hostname: string) => Promise<any>;
                exportCaCert: () => Promise<any>;
                readLogs: (hostname: string, lines?: number) => Promise<string[]>;
                clearLogs: (hostname: string) => Promise<void>;
            };
            windowAPI: {
                minimize: () => void;
                maximize: () => void;
                close: (force?: boolean) => void;
            };
            updater: {
                getState: () => Promise<UpdateStateBridge>;
                check: () => Promise<void>;
                download: () => Promise<void>;
                quitAndInstall: () => Promise<void>;
                onStateChanged: (callback: (state: UpdateStateBridge) => void) => () => void;
            };
        };
    }
}

type UpdateStatusBridge = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

interface UpdateStateBridge {
    status: UpdateStatusBridge;
    version?: string;
    progress?: number;
    error?: string;
}
