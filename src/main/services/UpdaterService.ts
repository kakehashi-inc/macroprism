import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC_CHANNELS } from '../../shared/types';
import type { UpdateState } from '../../shared/types';

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
// electron-builder injects PORTABLE_EXECUTABLE_FILE only when the app is launched from the portable exe.
// In that case the auto-updater must be skipped to avoid pulling the NSIS installer via latest.yml.
const isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE;

class UpdaterService {
    private state: UpdateState = { status: 'idle' };
    private autoInstallOnDownloaded = false;
    // True only while a user-initiated download is in flight. autoUpdater.on('error') is a single
    // global handler that receives both startup/background check failures (offline etc.) and download
    // failures. This flag lets us surface an error to the UI only for the user-initiated download case;
    // background failures fall back to idle silently.
    private downloadRequested = false;
    private startupCheckScheduled = false;
    private initialized = false;
    // Set once the user (or the auto-install-on-download path) commits to installing. The app
    // 'before-quit' handler reads this to skip its hard app.exit(0) and instead hand termination
    // and relaunch to the native updater, so the process is not killed mid-install on macOS.
    private installing = false;

    initialize(): void {
        if (isDev || isPortable) return;
        if (this.initialized) return;
        this.initialized = true;

        autoUpdater.autoDownload = false;
        // Keep this true so electron-updater stages the update into the native Squirrel.Mac
        // updater right after the download finishes (MacUpdater.updateDownloaded triggers the
        // native checkForUpdates only when this flag is set). If it were false, staging would be
        // deferred to quitAndInstall time and run asynchronously, racing the app's quit sequence
        // on macOS so the new version never gets installed.
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.logger = console;

        autoUpdater.on('checking-for-update', () => {
            this.state = { status: 'checking' };
        });

        autoUpdater.on('update-available', info => {
            this.state = { status: 'available', version: info?.version };
            this.broadcast();
        });

        autoUpdater.on('update-not-available', () => {
            this.state = { status: 'not-available' };
        });

        autoUpdater.on('download-progress', progress => {
            const percent = typeof progress?.percent === 'number' ? progress.percent : 0;
            this.state = { ...this.state, status: 'downloading', progress: percent };
            this.broadcast();
        });

        autoUpdater.on('update-downloaded', info => {
            this.downloadRequested = false;
            this.state = { status: 'downloaded', version: info?.version };
            this.broadcast();
            if (this.autoInstallOnDownloaded) {
                setTimeout(() => this.quitAndInstall(), 1500);
            }
        });

        autoUpdater.on('error', err => {
            console.error('[updater] error:', err);
            this.autoInstallOnDownloaded = false;
            if (this.downloadRequested) {
                // The failure happened during a user-initiated download. Surface it so the UI can
                // offer retry/close instead of silently going back to idle.
                this.downloadRequested = false;
                this.state = { status: 'error', error: this.toMessage(err) };
            } else {
                // Startup/background check failure (e.g. offline). Return to idle quietly.
                this.state = { status: 'idle' };
            }
            this.broadcast();
        });
    }

    getState(): UpdateState {
        return this.state;
    }

    async checkForUpdates(): Promise<void> {
        if (isDev || isPortable) return;
        try {
            await autoUpdater.checkForUpdates();
        } catch (err) {
            console.error('[updater] checkForUpdates failed:', err);
        }
    }

    async downloadUpdate(): Promise<void> {
        if (isDev || isPortable) return;
        this.autoInstallOnDownloaded = true;
        this.downloadRequested = true;
        // Provide immediate feedback: move to the downloading state right away so the UI shows a
        // progress bar even before the first 'download-progress' event (or if the download fails fast).
        this.state = { status: 'downloading', progress: 0, version: this.state.version };
        this.broadcast();
        try {
            await autoUpdater.downloadUpdate();
        } catch (err) {
            this.autoInstallOnDownloaded = false;
            // The 'error' event usually fires too and is guarded by downloadRequested. If it did not
            // (downloadRequested still true), deliver the error from here so feedback is guaranteed.
            if (this.downloadRequested) {
                this.downloadRequested = false;
                this.state = { status: 'error', error: this.toMessage(err) };
                this.broadcast();
            }
            console.error('[updater] downloadUpdate failed:', err);
        }
    }

    private toMessage(err: unknown): string {
        if (err instanceof Error) return err.message;
        if (typeof err === 'string') return err;
        return 'Unknown error';
    }

    isInstalling(): boolean {
        return this.installing;
    }

    quitAndInstall(): void {
        if (isDev || isPortable) return;
        // Do not close windows or force-exit here. Mark that an install is pending and start the
        // normal quit; the 'before-quit' handler runs its child-process cleanup and then calls
        // finalizeInstall(), so the native updater performs the install and relaunch as the very
        // last step. Closing windows or calling app.exit() ourselves would terminate the process
        // before Squirrel.Mac finishes, which is the root cause of the "downloaded but not updated"
        // bug on macOS.
        this.installing = true;
        setImmediate(() => {
            try {
                app.quit();
            } catch (err) {
                this.installing = false;
                console.error('[updater] quitAndInstall failed to start quit:', err);
            }
        });
    }

    // Invoked from the app 'before-quit' handler, after process cleanup, when an install is
    // pending. Hands quitting and relaunching to the native updater. Because the update was
    // already staged at download time (autoInstallOnAppQuit=true), this installs synchronously
    // via squirrelDownloadedUpdate; even if staging is still in flight it completes safely now
    // that no competing app.exit() follows it.
    finalizeInstall(): void {
        if (isDev || isPortable) return;
        try {
            autoUpdater.quitAndInstall(false, true);
        } catch (err) {
            console.error('[updater] quitAndInstall failed:', err);
        }
    }

    scheduleStartupCheck(window: BrowserWindow, delayMs = 3000): void {
        if (isDev || isPortable) return;
        if (this.startupCheckScheduled) return;
        this.startupCheckScheduled = true;

        const run = () => {
            setTimeout(() => {
                this.checkForUpdates();
            }, delayMs);
        };

        if (window.webContents.isLoading()) {
            window.webContents.once('did-finish-load', run);
        } else {
            run();
        }
    }

    private broadcast(): void {
        const payload = this.state;
        for (const w of BrowserWindow.getAllWindows()) {
            try {
                if (!w.isDestroyed()) {
                    w.webContents.send(IPC_CHANNELS.UPDATER_STATE_CHANGED, payload);
                }
            } catch { /* ignore */ }
        }
    }
}

export const updaterService = new UpdaterService();
