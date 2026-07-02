import { ConfigManager } from './ConfigManager';
import { createWriteStream, WriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { APP_NAME } from '../../shared/constants';

type NgrokSession = any;
type NgrokListener = any;

export interface NgrokTunnelInfo {
    port: number;
    url?: string;
    name: string;
}

export class NgrokMultiTunnelManager {
    private configManager: ConfigManager;
    private session: NgrokSession | null = null;
    private listeners: Map<number, NgrokListener> = new Map();
    private tunnelInfos: Map<number, NgrokTunnelInfo> = new Map();
    private connections: Map<number, any> = new Map();
    private ngrokModule: any | null = null;
    private logStream: WriteStream | null = null;

    constructor(configManager: ConfigManager) {
        this.configManager = configManager;
    }

    private getLogFilePath(): string {
        const logDir = this.configManager.getLogDirectory();
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
        return path.join(logDir, `ngrok_${dateStr}.log`);
    }

    private async ensureLogStream(): Promise<void> {
        if (!this.logStream) {
            this.logStream = createWriteStream(this.getLogFilePath(), { flags: 'a' });
        }
    }

    private async log(message: string): Promise<void> {
        await this.ensureLogStream();
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const pad3 = (n: number) => String(n).padStart(3, '0');
        const ts = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(
            now.getMinutes()
        )}:${pad(now.getSeconds())}.${pad3(now.getMilliseconds())}`;
        this.logStream!.write(`[${ts}] ${message}\n`);
    }

    async start(): Promise<NgrokTunnelInfo[]> {
        const settings = this.configManager.getSettings();
        const authToken = settings.ngrokAuthToken?.trim();
        const metadata = (settings.ngrokMetadataName || APP_NAME).trim();
        const portsStr = settings.ngrokPorts?.trim() || '';
        const ports = portsStr
            .split(',')
            .map(p => parseInt(p.trim(), 10))
            .filter(p => Number.isFinite(p) && p > 0);

        if (!authToken) {
            await this.log('Ngrok auth token is not set.');
            throw new Error('NGROK_AUTHTOKEN is empty');
        }
        if (ports.length === 0) {
            await this.log('No ports specified for ngrok.');
            throw new Error('No ngrok ports configured');
        }

        // Close previous session only if already running
        const isRunning = this.listeners.size > 0 || this.session !== null || this.tunnelInfos.size > 0;
        if (isRunning) {
            await this.stop();
        }

        try {
            await this.log(`Ngrok start requested. Ports: ${ports.join(', ') || '-'}`);
            // Dynamic import to support ESM package in CJS
            const ngrokMod = await import('@ngrok/ngrok');
            const ngrok: any = (ngrokMod as any).default ?? ngrokMod;
            this.ngrokModule = ngrok;
            // Prefer widely compatible API first
            for (const port of ports) {
                const urlObj = await ngrok.connect({ addr: port, authtoken: authToken, metadata, proto: 'http' });
                // Extract URL string defensively across SDK shapes
                let url = '';
                try {
                    if (typeof urlObj === 'string') {
                        url = urlObj;
                    } else if (urlObj && typeof urlObj.url === 'function') {
                        const v = urlObj.url();
                        url = typeof v === 'string' ? v : String(v ?? '');
                    } else if (urlObj && typeof urlObj.url === 'string') {
                        url = urlObj.url;
                    } else if (urlObj && typeof urlObj.toString === 'function') {
                        const v = urlObj.toString();
                        url = typeof v === 'string' ? v : String(v ?? '');
                    }
                } catch { /* ignore */ }

                const info: NgrokTunnelInfo = { port, url, name: `port-${port}` };
                this.tunnelInfos.set(port, info);
                this.connections.set(port, urlObj);
                await this.log(`Tunnel started: ${port} -> ${url || '[no url]'}`);
            }
            await this.log(`Ngrok start completed. Active tunnels: ${this.tunnelInfos.size}`);

            // Optionally try new Session API if specifically enabled in the future
            // (kept commented out to avoid incompatibility issues)
            // if (ngrok.SessionBuilder && process.env.NGROK_USE_SESSION_API === '1') { ... }
        } catch (e: any) {
            const msg = e?.message || String(e);
            await this.log(`Ngrok start failed: ${msg}`);
            // ensure cleanup on failure
            try {
                await this.stop();
            } catch {
                // ignore
            }
            if (e?.errorCode === 'ERR_NGROK_108') {
                throw new Error(
                    'ngrokの同時セッション数の上限に達しています。他のngrokエージェントを停止してください（ngrok CLI/デスクトップ、またはダッシュボードのAgentsでDisconnect）。'
                );
            }
            throw e;
        }

        return Array.from(this.tunnelInfos.values());
    }

    async stop(): Promise<void> {
        try {
            await this.log(`Ngrok stop requested.`);
            // Close per-port connection objects from connect()
            if (this.connections.size > 0) {
                for (const [port, conn] of this.connections.entries()) {
                    try {
                        if (conn && typeof conn.close === 'function') {
                            await conn.close();
                        } else if (this.ngrokModule && typeof this.ngrokModule.disconnect === 'function') {
                            // Try to derive URL string for disconnect
                            let url = '';
                            try {
                                if (conn && typeof conn === 'string') url = conn;
                                else if (conn && typeof conn.url === 'function') url = conn.url();
                                else if (conn && typeof conn.url === 'string') url = conn.url;
                                else if (conn && typeof conn.toString === 'function') url = conn.toString();
                            } catch { /* ignore */ }
                            if (url) {
                                await this.ngrokModule.disconnect(url);
                            }
                        }
                    } catch (e) {
                        await this.log(
                            `Warn: failed to close connection for port ${port}: ${
                                e instanceof Error ? e.message : String(e)
                            }`
                        );
                    }
                }
                this.connections.clear();
            }
            if (this.listeners.size > 0) {
                for (const listener of this.listeners.values()) {
                    try {
                        if (listener.close) await listener.close();
                    } catch {
                        //
                    }
                }
                this.listeners.clear();
            }
            if (this.session) {
                try {
                    if (this.session.close) await this.session.close();
                } catch {
                    //
                }
                this.session = null;
            }
            this.tunnelInfos.clear();
            await this.log('Ngrok stopped. All tunnels closed.');
        } finally {
            if (this.logStream) {
                this.logStream.end();
                this.logStream = null;
            }
        }
    }

    status(): NgrokTunnelInfo[] {
        return Array.from(this.tunnelInfos.values());
    }

    async readLogs(lines: number = 200): Promise<string[]> {
        try {
            const file = this.getLogFilePath();
            const content = await fs.readFile(file, 'utf-8');
            const arr = content.split('\n').filter(l => l.trim() !== '');
            return arr.slice(-lines);
        } catch {
            return [];
        }
    }

    async clearLogs(): Promise<void> {
        try {
            const file = this.getLogFilePath();
            await fs.writeFile(file, '', 'utf-8');
        } catch {
            // ignore
        }
    }
}
