import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types';
import { ProcessManager } from '../services/ProcessManager';
import { ConfigManager } from '../services/ConfigManager';
import { LogManager } from '../services/LogManager';
import { SystemUtils } from '../utils/SystemUtils';
import { NgrokMultiTunnelManager } from '../services/NgrokMultiTunnelManager';
import { HttpsProxyManager } from '../services/HttpsProxyManager';
import { updaterService } from '../services/UpdaterService';

export function initializeIPC(
    processManager: ProcessManager,
    configManager: ConfigManager,
    logManager: LogManager,
    ngrokManager?: NgrokMultiTunnelManager,
    httpsProxyManager?: HttpsProxyManager
) {
    // Process Management
    ipcMain.handle(IPC_CHANNELS.PROCESS_LIST, async () => {
        return await processManager.getAllProcesses();
    });

    ipcMain.handle(IPC_CHANNELS.PROCESS_CREATE, async (_, id, config) => {
        return await processManager.createProcess(id, config);
    });

    ipcMain.handle(IPC_CHANNELS.PROCESS_UPDATE, async (_, id, config) => {
        return await processManager.updateProcess(id, config);
    });

    ipcMain.handle(IPC_CHANNELS.PROCESS_DELETE, async (_, id) => {
        return await processManager.deleteProcess(id);
    });

    ipcMain.handle(IPC_CHANNELS.PROCESS_START, async (_, id) => {
        return await processManager.startProcess(id);
    });

    ipcMain.handle(IPC_CHANNELS.PROCESS_STOP, async (_, id) => {
        return await processManager.stopProcess(id);
    });

    ipcMain.handle(IPC_CHANNELS.PROCESS_STATUS, async (_, id) => {
        return await processManager.getProcessStatus(id);
    });

    // Config
    ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async () => {
        return configManager.getConfig();
    });

    ipcMain.handle(IPC_CHANNELS.CONFIG_UPDATE, async (_, config) => {
        return await configManager.updateConfig(config);
    });

    // Settings (backward compatibility)
    ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
        return configManager.getSettings();
    });

    ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_, settings) => {
        return await configManager.updateSettings(settings);
    });

    // WSL
    ipcMain.handle(IPC_CHANNELS.WSL_CHECK, async () => {
        return await SystemUtils.isWSLAvailable();
    });

    ipcMain.handle(IPC_CHANNELS.WSL_LIST_DISTRIBUTIONS, async () => {
        return await SystemUtils.getWSLDistributions();
    });

    // Logs
    ipcMain.handle(IPC_CHANNELS.LOG_READ, async (_, processId, type, lines) => {
        return await logManager.readLogs(processId, type, lines);
    });

    ipcMain.handle(IPC_CHANNELS.LOG_CLEAR, async (_, processId) => {
        return await logManager.clearLogs(processId);
    });

    // System
    ipcMain.handle(IPC_CHANNELS.SYSTEM_INFO, async () => {
        return await SystemUtils.getSystemInfo();
    });
    ipcMain.handle(IPC_CHANNELS.APP_VERSION, async () => {
        return app.getVersion();
    });

    // Ngrok
    ipcMain.handle(IPC_CHANNELS.NGROK_START, async () => {
        if (!ngrokManager) return [];
        try {
            return await ngrokManager.start();
        } catch (e: any) {
            // Surface error message to renderer
            throw new Error(e?.message || String(e));
        }
    });
    ipcMain.handle(IPC_CHANNELS.NGROK_STOP, async () => {
        if (!ngrokManager) return true;
        await ngrokManager.stop();
        return true;
    });
    ipcMain.handle(IPC_CHANNELS.NGROK_STATUS, async () => {
        if (!ngrokManager) return [];
        return ngrokManager.status();
    });
    ipcMain.handle(IPC_CHANNELS.NGROK_LOG_READ, async (_, lines?: number) => {
        if (!ngrokManager) return [];
        return await ngrokManager.readLogs(lines || 200);
    });
    ipcMain.handle(IPC_CHANNELS.NGROK_LOG_CLEAR, async () => {
        if (!ngrokManager) return;
        try {
            await ngrokManager.clearLogs();
        } catch {
            // ignore
        }
    });

    // HTTPS Proxy
    ipcMain.handle(IPC_CHANNELS.HTTPS_PROXY_LIST, async () => {
        return configManager.getHttpsProxies();
    });
    ipcMain.handle(IPC_CHANNELS.HTTPS_PROXY_STATUS, async () => {
        if (!httpsProxyManager) return [];
        return httpsProxyManager.status();
    });
    ipcMain.handle(IPC_CHANNELS.HTTPS_PROXY_CREATE, async (_e, hostname: string, cfg: any) => {
        if (!httpsProxyManager) return false;
        await httpsProxyManager.create(hostname, cfg);
        return true;
    });
    ipcMain.handle(IPC_CHANNELS.HTTPS_PROXY_UPDATE, async (_e, hostname: string, cfg: any) => {
        if (!httpsProxyManager) return false;
        await httpsProxyManager.update(hostname, cfg);
        return true;
    });
    ipcMain.handle(IPC_CHANNELS.HTTPS_PROXY_DELETE, async (_e, hostname: string) => {
        if (!httpsProxyManager) return false;
        await httpsProxyManager.delete(hostname);
        return true;
    });
    ipcMain.handle(IPC_CHANNELS.HTTPS_PROXY_START, async (_e, hostname: string) => {
        if (!httpsProxyManager) return null;
        return await httpsProxyManager.start(hostname);
    });
    ipcMain.handle(IPC_CHANNELS.HTTPS_PROXY_STOP, async (_e, hostname: string) => {
        if (!httpsProxyManager) return true;
        return await httpsProxyManager.stop(hostname);
    });
    ipcMain.handle(IPC_CHANNELS.HTTPS_PROXY_REGENERATE_CERT, async (_e, name: string) => {
        if (!httpsProxyManager) return null;
        const cfg = configManager.getHttpsProxy(name);
        return await httpsProxyManager.regenerateCertificate(name, cfg?.hostnames || [], 90);
    });
    ipcMain.handle(IPC_CHANNELS.HTTPS_PROXY_LOG_READ, async (_e, hostname: string, lines?: number) => {
        if (!httpsProxyManager) return [];
        return await httpsProxyManager.readLogs(hostname, lines || 200);
    });
    ipcMain.handle(IPC_CHANNELS.HTTPS_PROXY_LOG_CLEAR, async (_e, hostname: string) => {
        if (!httpsProxyManager) return;
        try {
            await httpsProxyManager.clearLogs(hostname);
        } catch { /* ignore */ }
    });

    // Updater
    ipcMain.handle(IPC_CHANNELS.UPDATER_GET_STATE, async () => {
        return updaterService.getState();
    });
    ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, async () => {
        await updaterService.checkForUpdates();
    });
    ipcMain.handle(IPC_CHANNELS.UPDATER_DOWNLOAD, async () => {
        await updaterService.downloadUpdate();
    });
    ipcMain.handle(IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL, async () => {
        updaterService.quitAndInstall();
    });
}
