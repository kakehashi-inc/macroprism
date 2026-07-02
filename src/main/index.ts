import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { initializeIPC } from './ipc';
import { ProcessManager } from './services/ProcessManager';
import { ConfigManager } from './services/ConfigManager';
import { LogManager } from './services/LogManager';
import { NgrokMultiTunnelManager } from './services/NgrokMultiTunnelManager';
import { HttpsProxyManager } from './services/HttpsProxyManager';
import { updaterService } from './services/UpdaterService';
import { SystemUtils } from './utils/SystemUtils';
import { APP_NAME } from '../shared/constants';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let processManager: ProcessManager;
let configManager: ConfigManager;
let logManager: LogManager;
let ngrokManager: NgrokMultiTunnelManager;
let httpsProxyManager: HttpsProxyManager;

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const isMac = process.platform === 'darwin';

// Fix PATH on macOS for GUI apps
if (isMac) {
    SystemUtils.fixPath();
}

// Enforce single instance
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
    process.exit(0);
} else {
    app.on('second-instance', (_event, _argv, _workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            if (!mainWindow.isVisible()) {
                mainWindow.show();
            }
            mainWindow.focus();
        }
    });
}

function resolveIconPath(): string | undefined {
    const pngPath = path.join(__dirname, '../../public/icon.png');
    if (fs.existsSync(pngPath)) return pngPath;

    const svgPath = path.join(__dirname, '../../public/icon.ico');
    if (fs.existsSync(svgPath)) return svgPath;

    return undefined;
}

function resolveTrayIconPath(): string | undefined {
    const trayPath = path.join(__dirname, '../../public/tray-icon.png');
    if (fs.existsSync(trayPath)) return trayPath;
    return resolveIconPath();
}

function showMainWindow() {
    if (!mainWindow) {
        createWindow();
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
        mainWindow.show();
    }
    mainWindow.focus();
}

function createTray() {
    const iconPath = isMac ? resolveTrayIconPath() : resolveIconPath();
    if (!iconPath) {
        tray = null;
        return;
    }

    if (isMac) {
        let trayImage = nativeImage.createFromPath(iconPath);
        if (trayImage.isEmpty()) {
            trayImage = nativeImage.createFromPath(resolveIconPath() ?? '');
        }
        if (trayImage.isEmpty()) {
            tray = null;
            return;
        }
        trayImage = trayImage.resize({ width: 18, height: 18 });
        trayImage.setTemplateImage(true);
        tray = new Tray(trayImage);
    } else {
        tray = new Tray(iconPath);
    }

    const language = configManager?.getSettings().language || 'ja';
    const labels = language === 'ja' ? { open: '開く', quit: '終了' } : { open: 'Open', quit: 'Quit' };
    const menu = Menu.buildFromTemplate([
        {
            label: labels.open,
            click: () => showMainWindow(),
        },
        { type: 'separator' },
        {
            label: labels.quit,
            click: () => app.quit(),
        },
    ]);
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(menu);
    tray.on('right-click', () => {
        tray?.popUpContextMenu();
    });
    tray.on('double-click', () => {
        showMainWindow();
    });
}

function createWindow() {
    const settings = configManager.getSettings();
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        show: settings.showWindowOnStartup !== false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, '../preload/index.js'),
        },
        frame: false,
        titleBarStyle: isMac ? 'hiddenInset' : 'default',
        trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
        titleBarOverlay: isMac
            ? {
                  color: '#00000000',
                  symbolColor: '#ffffff',
                  height: 64,
              }
            : undefined,
        icon: resolveIconPath(),
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:3001');
        // Ensure DevTools are visible in development
        try {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        } catch { /* ignore */ }
        // Keyboard shortcuts to toggle DevTools without menu
        mainWindow.webContents.on('before-input-event', (event, input) => {
            const isToggleCombo =
                (input.key?.toLowerCase?.() === 'i' && (input.control || input.meta) && input.shift) ||
                input.key === 'F12';
            if (isToggleCombo) {
                event.preventDefault();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.toggleDevTools();
                }
            }
        });
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    mainWindow.on('close', e => {
        // Hide to tray instead of quitting when user closes the window
        if (!isQuitting) {
            e.preventDefault();
            if (tray) {
                mainWindow?.hide();
            } else {
                // If tray isn't available, minimize instead of closing
                mainWindow?.minimize();
            }
            return;
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Custom title bar handlers
    ipcMain.on('app:minimize', () => {
        mainWindow?.minimize();
    });

    ipcMain.on('app:maximize', () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.restore();
        } else {
            mainWindow?.maximize();
        }
    });

    ipcMain.on('app:quit', (_e, forceQuit?: boolean) => {
        // Custom title bar close button should hide to tray
        if (!isQuitting && !forceQuit) {
            if (tray) {
                mainWindow?.hide();
            } else {
                mainWindow?.minimize();
            }
            return;
        }
        app.quit();
    });
}

async function initializeServices() {
    // Initialize managers
    configManager = new ConfigManager();
    await configManager.initialize();

    logManager = new LogManager(configManager);
    await logManager.initialize();

    processManager = new ProcessManager(logManager, configManager);
    await processManager.initialize();

    // Ngrok manager (independent from process manager)
    ngrokManager = new NgrokMultiTunnelManager(configManager);
    // HTTPS proxy manager
    httpsProxyManager = new HttpsProxyManager(configManager);
    await httpsProxyManager.initialize();

    // Initialize IPC handlers
    initializeIPC(processManager, configManager, logManager, ngrokManager, httpsProxyManager);

    // Optional auto-start ngrok based on settings
    try {
        const settings = configManager.getSettings();
        if (settings.ngrokAutoStart) {
            await ngrokManager.start();
        }
    } catch (e) {
        // Ignore failures at startup; user can start from UI
    }

    // Start process monitoring
    processManager.startMonitoring();

    // Start log rotation
    logManager.startRotation();

    // Auto-start HTTPS proxies with autoStart=true
    try {
        const proxies = configManager.getHttpsProxies();
        for (const [name, cfg] of Object.entries(proxies)) {
            if (cfg?.autoStart) {
                try {
                    await httpsProxyManager.start(name);
                } catch (e) {
                    // ignore startup failures; user can manage from UI
                }
            }
        }
    } catch {
        // ignore
    }
}

app.whenReady().then(async () => {
    await initializeServices();
    updaterService.initialize();
    createTray();
    createWindow();
    if (mainWindow) {
        updaterService.scheduleStartupCheck(mainWindow);
    }

    app.on('activate', () => {
        showMainWindow();
    });
});

let isQuitting = false;
app.on('before-quit', async e => {
    if (isQuitting) return;
    e.preventDefault();
    // Mark quitting up front so the window 'close' handler stops hiding to tray and the native
    // updater's own quit (during an install) passes straight through this handler.
    isQuitting = true;
    try {
        // Ensure all child processes are stopped before exiting
        // Treat as user-initiated stop to suppress error/command logs and restarts
        await processManager.stopAll();
    } catch (err) {
        // No-op; proceed to exit regardless
    } finally {
        processManager.stopMonitoring();
        logManager.stopRotation();
        try {
            tray?.destroy();
        } catch { /* ignore */ }
        if (updaterService.isInstalling()) {
            // An update install is pending: let the native updater quit and relaunch with the new
            // version. A hard app.exit(0) here would kill the process before Squirrel.Mac finishes
            // installing, leaving the app on the old version (the macOS auto-update bug).
            updaterService.finalizeInstall();
        } else {
            app.exit(0);
        }
    }
});

// Handle protocol for deep linking (optional)
app.setAsDefaultProtocolClient('macroprism');
