import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProcessConfig, ProcessStatus } from '../../shared/types';
import { PROCESS_CHECK_INTERVAL, getAppDataPath } from '../../shared/constants';
import { LogManager } from './LogManager';
import { ConfigManager } from './ConfigManager';
import { BrowserWindow } from 'electron';
import { SystemUtils } from '../utils/SystemUtils';

export class ProcessManager {
    private runningProcesses: Map<string, ChildProcess>;
    private processStatuses: Map<string, ProcessStatus>;
    private logManager: LogManager;
    private configManager: ConfigManager;
    private monitoringInterval: NodeJS.Timeout | null = null;
    private restartTimers: Map<string, NodeJS.Timeout>;
    private stoppingProcesses: Set<string>;

    constructor(logManager: LogManager, configManager: ConfigManager) {
        this.runningProcesses = new Map();
        this.processStatuses = new Map();
        this.logManager = logManager;
        this.configManager = configManager;
        this.restartTimers = new Map();
        this.stoppingProcesses = new Set();
    }

    async initialize(): Promise<void> {
        await this.initializeStatuses();
        await this.autoStartProcesses();
    }

    private async initializeStatuses(): Promise<void> {
        const processes = this.configManager.getProcesses();

        for (const id of Object.keys(processes)) {
            this.processStatuses.set(id, {
                id,
                status: 'stopped',
                lastChecked: new Date().toISOString(),
            });
        }
    }

    private async autoStartProcesses(): Promise<void> {
        const processes = this.configManager.getProcesses();

        for (const [id, config] of Object.entries(processes)) {
            if (config.autoStart) {
                await this.startProcess(id);
            }
        }
    }

    async getAllProcesses(): Promise<Array<{ id: string; config: ProcessConfig }>> {
        const processes = this.configManager.getProcesses();
        return Object.entries(processes).map(([id, config]) => ({ id, config }));
    }

    async createProcess(id: string, config: ProcessConfig): Promise<void> {
        await this.configManager.addProcess(id, config);
        this.processStatuses.set(id, {
            id,
            status: 'stopped',
            lastChecked: new Date().toISOString(),
        });
    }

    async updateProcess(id: string, config: Partial<ProcessConfig>): Promise<void> {
        await this.configManager.updateProcess(id, config);
    }

    async deleteProcess(id: string): Promise<boolean> {
        // Stop the process if running
        await this.stopProcess(id);

        // Remove from config
        await this.configManager.deleteProcess(id);

        // Remove status
        this.processStatuses.delete(id);

        // Clear logs
        await this.logManager.clearLogs(id);

        return true;
    }

    async startProcess(id: string): Promise<boolean> {
        const config = this.configManager.getProcess(id);
        if (!config) {
            return false;
        }

        // Check if already running
        if (this.runningProcesses.has(id)) {
            return true;
        }

        // Prepare variables to log in case of startup error
        let runCommand: string | null = null;
        let runArgs: string[] = [];
        let runEnv: Record<string, string> | undefined = undefined;
        let commandLogged = false;

        try {
            // Clear any pending restart timer before starting
            const pendingTimer = this.restartTimers.get(id);
            if (pendingTimer) {
                clearTimeout(pendingTimer);
                this.restartTimers.delete(id);
            }
            // Guard: WSL指定だがWSLが利用不可
            if ((config.platform || 'host') === 'wsl') {
                const wslAvailable = await SystemUtils.isWSLAvailable();
                if (!wslAvailable) {
                    await this.logManager.createLogStream(id);
                    await this.logManager.writeLog(id, 'stderr', 'WSL is not available on this system.');
                    this.updateProcessStatus(id, { status: 'error', pid: undefined, startedAt: undefined });
                    return false;
                }
                if (!config.wslDistribution) {
                    await this.logManager.createLogStream(id);
                    await this.logManager.writeLog(id, 'stderr', 'WSL distribution is not specified.');
                    this.updateProcessStatus(id, { status: 'error', pid: undefined, startedAt: undefined });
                    return false;
                }
            }

            // Build command: if useAuthProxy, wrap command via mcp-auth-proxy with OIDC flags
            runCommand = config.command;
            runArgs = [...(config.args || [])];
            runEnv = config.env;

            const settings = this.configManager.getSettings();

            const shouldUseAuthProxy = !!config.useAuthProxy;
            if (shouldUseAuthProxy) {
                const authProxyBin = SystemUtils.detectAuthProxyBinaryPath(undefined);

                const oidcProviderName = settings.oidcProviderName || 'Auth0';
                const oidcConfigurationUrl = settings.oidcConfigurationUrl || '';
                const oidcClientId = settings.oidcClientId || '';
                const oidcClientSecret = settings.oidcClientSecret || '';
                const allowedUsers = (settings.oidcAllowedUsers || '').trim();
                const allowedUsersGlob = (settings.oidcAllowedUsersGlob || '').trim();

                // Validate minimal requirements
                if (!config.authProxyListenPort || !config.authProxyExternalUrl) {
                    await this.logManager.createLogStream(id);
                    await this.logManager.writeLog(
                        id,
                        'stderr',
                        'mcp-auth-proxy requires listen port and external URL when enabled.'
                    );
                    this.updateProcessStatus(id, { status: 'error', pid: undefined, startedAt: undefined });
                    return false;
                }
                if (!oidcConfigurationUrl || !oidcClientId || !oidcClientSecret) {
                    await this.logManager.createLogStream(id);
                    await this.logManager.writeLog(
                        id,
                        'stderr',
                        'mcp-auth-proxy requires OIDC configuration URL, client ID, and client secret.'
                    );
                    this.updateProcessStatus(id, { status: 'error', pid: undefined, startedAt: undefined });
                    return false;
                }
                if (!allowedUsers && !allowedUsersGlob) {
                    await this.logManager.createLogStream(id);
                    await this.logManager.writeLog(
                        id,
                        'stderr',
                        'mcp-auth-proxy requires either allowed users or allowed users glob.'
                    );
                    this.updateProcessStatus(id, { status: 'error', pid: undefined, startedAt: undefined });
                    return false;
                }

                // Decide data-path and ensure directory
                const isWSLPlatform = (config.platform || 'host') === 'wsl';
                let dataPathForProxy = '';
                if (isWSLPlatform) {
                    // Use WSL home
                    dataPathForProxy = `~/mcp-auth-proxy/${id}`;
                } else {
                    // Host app data
                    const baseDir = getAppDataPath();
                    const dataDir = path.join(baseDir, 'mcp-auth-proxy', id);
                    try {
                        await fs.mkdir(dataDir, { recursive: true });
                    } catch {
                        // ignore
                    }
                    dataPathForProxy = dataDir;
                }

                const proxyArgs: string[] = [
                    '--external-url',
                    String(config.authProxyExternalUrl),
                    '--no-auto-tls',
                    '--listen',
                    `:${config.authProxyListenPort}`,
                    '--data-path',
                    dataPathForProxy,
                    '--oidc-provider-name',
                    String(oidcProviderName),
                    '--oidc-configuration-url',
                    String(oidcConfigurationUrl),
                    '--oidc-client-id',
                    String(oidcClientId),
                    '--oidc-client-secret',
                    String(oidcClientSecret),
                ];
                if (allowedUsers) {
                    proxyArgs.push('--oidc-allowed-users', allowedUsers);
                }
                if (allowedUsersGlob) {
                    proxyArgs.push('--oidc-allowed-users-glob', allowedUsersGlob);
                }

                // Append separator then original command and args
                // Many CLIs require "--" to separate proxy flags and the subcommand
                proxyArgs.push('--');
                proxyArgs.push(config.command);
                proxyArgs.push(...runArgs);

                // For WSL, ensure directory exists inside WSL before launching
                runCommand = isWSLPlatform ? `mkdir -p ${dataPathForProxy} && ${authProxyBin}` : authProxyBin;
                runArgs = proxyArgs;
            }

            const childProcess: ChildProcess = SystemUtils.spawnCommand(runCommand, runArgs, {
                platform: config.platform || 'host',
                wslDistribution: config.wslDistribution,
                env: runEnv,
                windowsHide: true,
            });

            // Set up log streams
            await this.logManager.createLogStream(id);

            childProcess.stdout?.on('data', async data => {
                await this.logManager.writeLog(id, 'stdout', data.toString());
            });

            childProcess.stderr?.on('data', async data => {
                const text = data.toString();
                const looksLikeError = (s: string): boolean => {
                    const lower = s.trim().toLowerCase();
                    if (lower.length === 0) return false;
                    // Heuristics: common error indicators at line start or well-known phrases
                    return (
                        /^error[\s:]/.test(lower) ||
                        /^panic[\s:]/.test(lower) ||
                        /^usage[\s:]/.test(lower) ||
                        lower.includes('unknown shorthand flag') ||
                        lower.includes('traceback') ||
                        lower.includes('unhandledpromiserejection')
                    );
                };

                if (!this.stoppingProcesses.has(id) && !commandLogged && looksLikeError(text)) {
                    try {
                        await this.logManager.createLogStream(id);
                        const cmdline = SystemUtils.buildDisplayCommandLine(runCommand, runArgs || []);
                        const envStr = SystemUtils.buildDisplayEnvString(runEnv);
                        await this.logManager.writeLog(id, 'stderr', `Command (error): ${cmdline}`);
                        await this.logManager.writeLog(id, 'stderr', `Env: ${envStr}`);
                        commandLogged = true;
                    } catch { /* ignore */ }
                }

                await this.logManager.writeLog(id, 'stderr', text);
            });

            childProcess.on('error', async err => {
                if (this.stoppingProcesses.has(id)) {
                    // Ignore errors emitted while force-stopping
                    return;
                }
                const prevStartedAt = this.processStatuses.get(id)?.startedAt ?? null;
                try {
                    if (!commandLogged) {
                        await this.logManager.createLogStream(id);
                        const cmdline = SystemUtils.buildDisplayCommandLine(runCommand, runArgs || []);
                        const envStr = SystemUtils.buildDisplayEnvString(runEnv);
                        await this.logManager.writeLog(id, 'stderr', `Command (failed): ${cmdline}`);
                        await this.logManager.writeLog(id, 'stderr', `Env: ${envStr}`);
                        commandLogged = true;
                    }
                } catch { /* ignore */ }
                await this.logManager.writeLog(
                    id,
                    'stderr',
                    `Process error: ${err instanceof Error ? err.message : String(err)}`
                );
                await this.logManager.closeLogStream(id);
                this.runningProcesses.delete(id);
                this.updateProcessStatus(id, {
                    status: 'error',
                    pid: undefined,
                    startedAt: undefined,
                });
                await this.handleProcessTermination('error', id, null, prevStartedAt);
            });

            childProcess.on('exit', async code => {
                const prevStartedAt = this.processStatuses.get(id)?.startedAt ?? null;
                const stoppedByUser = this.stoppingProcesses.has(id);
                if (!stoppedByUser && code && code !== 0 && !commandLogged) {
                    try {
                        await this.logManager.createLogStream(id);
                        const cmdline = SystemUtils.buildDisplayCommandLine(runCommand, runArgs || []);
                        const envStr = SystemUtils.buildDisplayEnvString(runEnv);
                        await this.logManager.writeLog(id, 'stderr', `Command (exit ${code}): ${cmdline}`);
                        await this.logManager.writeLog(id, 'stderr', `Env: ${envStr}`);
                        commandLogged = true;
                    } catch { /* ignore */ }
                }
                this.runningProcesses.delete(id);
                await this.logManager.closeLogStream(id);

                this.updateProcessStatus(id, {
                    status: stoppedByUser ? 'stopped' : code === 0 ? 'stopped' : 'error',
                    pid: undefined,
                    startedAt: undefined,
                });
                if (!stoppedByUser) {
                    await this.handleProcessTermination('exit', id, code, prevStartedAt);
                } else {
                    // If user stopped, do not auto-restart and clear flag here
                    this.stoppingProcesses.delete(id);
                }
            });

            this.runningProcesses.set(id, childProcess);

            this.updateProcessStatus(id, {
                status: 'running',
                pid: childProcess.pid,
                startedAt: new Date().toISOString(),
            });

            return true;
        } catch (error) {
            const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            console.error(`Failed to start process ${id}:`, error);
            try {
                await this.logManager.createLogStream(id);
                // Log command and env first
                const cmdline = SystemUtils.buildDisplayCommandLine(runCommand, runArgs || []);
                const envStr = SystemUtils.buildDisplayEnvString(runEnv);
                await this.logManager.writeLog(id, 'stderr', `Command: ${cmdline}`);
                await this.logManager.writeLog(id, 'stderr', `Env: ${envStr}`);
                await this.logManager.writeLog(id, 'stderr', `Failed to start process: ${message}`);
            } catch { /* ignore */ }
            this.updateProcessStatus(id, {
                status: 'error',
            });
            return false;
        }
    }

    async stopProcess(id: string): Promise<boolean> {
        const childProcess = this.runningProcesses.get(id);
        if (!childProcess) {
            return false;
        }

        return new Promise(resolve => {
            // mark as stopping to suppress auto-restart
            this.stoppingProcesses.add(id);

            childProcess.on('exit', () => {
                this.runningProcesses.delete(id);
                this.updateProcessStatus(id, {
                    status: 'stopped',
                    pid: undefined,
                    startedAt: undefined,
                });
                // clear any scheduled restart for this id
                const pendingTimer = this.restartTimers.get(id);
                if (pendingTimer) {
                    clearTimeout(pendingTimer);
                    this.restartTimers.delete(id);
                }
                this.stoppingProcesses.delete(id);
                resolve(true);
            });

            // Try graceful shutdown first
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', childProcess.pid!.toString(), '/f', '/t']);
            } else {
                childProcess.kill('SIGTERM');

                // Force kill after 5 seconds if still running
                setTimeout(() => {
                    if (this.runningProcesses.has(id)) {
                        childProcess.kill('SIGKILL');
                    }
                }, 5000);
            }
        });
    }

    async stopAll(): Promise<void> {
        const stopPromises = Array.from(this.runningProcesses.keys()).map(id => this.stopProcess(id));
        await Promise.all(stopPromises);
    }

    private updateProcessStatus(id: string, updates: Partial<ProcessStatus>): void {
        const currentStatus = this.processStatuses.get(id) || {
            id,
            status: 'stopped',
            lastChecked: new Date().toISOString(),
        };

        this.processStatuses.set(id, {
            ...currentStatus,
            ...updates,
            lastChecked: new Date().toISOString(),
        });

        // Send update to renderer
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(window => {
            window.webContents.send('process:status-update', id, this.processStatuses.get(id));
        });
    }

    startMonitoring(): void {
        this.monitoringInterval = setInterval(() => {
            this.checkProcessStatuses();
        }, PROCESS_CHECK_INTERVAL);
    }

    stopMonitoring(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }

    private async checkProcessStatuses(): Promise<void> {
        for (const [id, childProcess] of this.runningProcesses) {
            try {
                // Check if process is still running
                if (childProcess.killed || childProcess.exitCode !== null) {
                    const prevStartedAt = this.processStatuses.get(id)?.startedAt ?? null;
                    this.runningProcesses.delete(id);
                    await this.logManager.closeLogStream(id);
                    this.updateProcessStatus(id, {
                        status: 'stopped',
                        pid: undefined,
                        startedAt: undefined,
                    });
                    await this.handleProcessTermination('exit', id, childProcess.exitCode, prevStartedAt);
                } else {
                    // Update resource usage if possible
                    this.updateProcessStatus(id, {
                        status: 'running',
                    });
                }
            } catch (error) {
                console.error(`Error checking process ${id}:`, error);
            }
        }
    }

    async getProcessStatus(id: string): Promise<ProcessStatus | null> {
        return this.processStatuses.get(id) || null;
    }

    private async handleProcessTermination(
        eventType: 'exit' | 'error',
        id: string,
        exitCode: number | null,
        previousStartedAtIso: string | null
    ): Promise<void> {
        // Do not restart if we intentionally stopped it
        if (this.stoppingProcesses.has(id)) {
            return;
        }

        const config = this.configManager.getProcess(id);
        if (!config || !config.autoRestartOnError) {
            return;
        }

        // For 'exit', only restart on non-zero exit code. For 'error', always consider abnormal.
        if (eventType === 'exit' && (exitCode === 0 || exitCode === null)) {
            return;
        }

        // Ensure it ran long enough to be considered a successful start
        const startedAt = previousStartedAtIso ? Date.parse(previousStartedAtIso) : NaN;
        const now = Date.now();
        const settings = this.configManager.getSettings();
        const threshold = settings.successfulStartThresholdMs ?? 10000;
        const ranMs = isNaN(startedAt) ? 0 : Math.max(0, now - startedAt);
        if (ranMs < threshold) {
            return;
        }

        // Schedule restart after configured delay
        const delay = settings.restartDelayMs ?? 0;
        // prevent duplicate schedules
        if (this.restartTimers.has(id)) {
            return;
        }

        await this.logManager.createLogStream(id);
        await this.logManager.writeLog(
            id,
            'stderr',
            `Process ${id} terminated (${eventType}${
                eventType === 'exit' ? ` code=${exitCode}` : ''
            }). Scheduling restart in ${delay} ms.`
        );
        const timer = setTimeout(async () => {
            this.restartTimers.delete(id);
            try {
                await this.startProcess(id);
            } catch (e) {
                // best-effort; error already handled in startProcess
            }
        }, delay);
        this.restartTimers.set(id, timer);
    }
}
