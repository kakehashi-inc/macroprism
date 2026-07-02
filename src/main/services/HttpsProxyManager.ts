import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { X509Certificate } from 'crypto';
import { ConfigManager } from './ConfigManager';
import { getCertsPath } from '../../shared/constants';
import { HttpsProxies, HttpsProxyConfig, HttpsProxyStatus } from '../../shared/types';

export class HttpsProxyManager {
    private configManager: ConfigManager;
    private servers: Map<string, https.Server> = new Map();
    private proxies: Map<string, any> = new Map();
    private logStreams: Map<string, any> = new Map();

    constructor(configManager: ConfigManager) {
        this.configManager = configManager;
    }

    async initialize(): Promise<void> {
        await this.ensureCertsDirectory();
    }

    private async ensureCertsDirectory(): Promise<void> {
        const dir = getCertsPath();
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    private getHostnameDir(hostname: string): string {
        return path.join(getCertsPath(), hostname);
    }

    private getKeyPath(hostname: string): string {
        return path.join(this.getHostnameDir(hostname), 'key.pem');
    }

    private getCertPath(hostname: string): string {
        return path.join(this.getHostnameDir(hostname), 'cert.pem');
    }

    // Logs: use app log directory, single shared file per day
    private getLogDir(): string {
        return this.configManager.getLogDirectory();
    }

    private getLogFilePath(): string {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
        return path.join(this.getLogDir(), `https_proxy_${dateStr}.log`);
    }

    private async ensureLogStream(): Promise<any> {
        const fsNode = await import('fs');
        const filePath = this.getLogFilePath();
        let stream = this.logStreams.get(filePath);
        if (!stream) {
            try {
                await fs.mkdir(this.getLogDir(), { recursive: true });
            } catch { /* ignore */ }
            stream = fsNode.createWriteStream(filePath, { flags: 'a' });
            this.logStreams.set(filePath, stream);
        }
        return stream;
    }

    private async log(hostname: string, message: string): Promise<void> {
        try {
            const stream = await this.ensureLogStream();
            const now = new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            const pad3 = (n: number) => String(n).padStart(3, '0');
            const ts = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(
                now.getHours()
            )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad3(now.getMilliseconds())}`;
            stream.write(`[${ts}] [${hostname}] ${message}\n`);
        } catch { /* ignore */ }
    }

    async readLogs(_hostname: string, lines: number = 200): Promise<string[]> {
        try {
            const file = this.getLogFilePath();
            const content = await fs.readFile(file, 'utf-8');
            const arr = content.split('\n').filter(l => l.trim() !== '');
            return arr.slice(-lines);
        } catch {
            return [];
        }
    }

    async clearLogs(_hostname: string): Promise<void> {
        try {
            const file = this.getLogFilePath();
            await fs.writeFile(file, '', 'utf-8');
        } catch { /* ignore */ }
    }

    private async readFileIfExists(filePath: string): Promise<string | null> {
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return data;
        } catch {
            return null;
        }
    }

    private parseValidTo(certPem: string | null): string | undefined {
        if (!certPem) return undefined;
        try {
            const x = new X509Certificate(certPem);
            // Node returns e.g. 'Nov  5 08:44:14 2025 GMT' — convert to ISO
            const d = new Date(x.validTo);
            return d.toISOString();
        } catch {
            return undefined;
        }
    }

    private async ensureHostnameDir(hostname: string): Promise<void> {
        const dir = this.getHostnameDir(hostname);
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    async regenerateCertificate(
        hostname: string,
        days: number = 90
    ): Promise<{ certPath: string; keyPath: string; validTo?: string }> {
        await this.ensureHostnameDir(hostname);
        // Lazy-import selfsigned to avoid ESM/CJS pitfalls during load
        const mod = await import('selfsigned');
        const selfsigned: any = (mod as any).default ?? mod;

        const attrs = [{ name: 'commonName', value: hostname }];
        const pems = await selfsigned.generate(attrs, {
            days,
            keySize: 2048,
            algorithm: 'sha256',
            extensions: [
                {
                    name: 'subjectAltName',
                    altNames: [
                        { type: 2, value: hostname }, // DNS
                        { type: 7, ip: '127.0.0.1' },
                        { type: 7, ip: '::1' },
                    ],
                },
            ],
        });

        const keyPath = this.getKeyPath(hostname);
        const certPath = this.getCertPath(hostname);
        await fs.writeFile(keyPath, pems.private, 'utf-8');
        await fs.writeFile(certPath, pems.cert, 'utf-8');

        const validTo = this.parseValidTo(pems.cert);

        // If running, restart to apply new certs
        if (this.servers.has(hostname)) {
            try {
                await this.stop(hostname);
                await this.start(hostname);
            } catch {
                // ignore restart failure
            }
        }

        return { certPath, keyPath, validTo };
    }

    private async ensureCertificate(
        hostname: string
    ): Promise<{ certPath: string; keyPath: string; validTo?: string }> {
        await this.ensureHostnameDir(hostname);
        const keyPath = this.getKeyPath(hostname);
        const certPath = this.getCertPath(hostname);

        const certContent = await this.readFileIfExists(certPath);
        const keyContent = await this.readFileIfExists(keyPath);
        const validTo = this.parseValidTo(certContent);

        const now = Date.now();
        const isExpired = validTo ? new Date(validTo).getTime() <= now : true;

        if (!certContent || !keyContent || isExpired) {
            return await this.regenerateCertificate(hostname, 90);
        }

        return { certPath, keyPath, validTo };
    }

    list(): HttpsProxies {
        return this.configManager.getHttpsProxies();
    }

    status(): HttpsProxyStatus[] {
        const proxies = this.list();
        const results: HttpsProxyStatus[] = [];
        for (const [hostname, cfg] of Object.entries(proxies)) {
            const certPath = this.getCertPath(hostname);
            const keyPath = this.getKeyPath(hostname);
            const server = this.servers.get(hostname);
            let validTo: string | undefined;
            try {
                const certPem = readFileSync(certPath, 'utf-8');
                validTo = this.parseValidTo(certPem);
            } catch { /* ignore */ }
            results.push({
                hostname,
                forwardPort: cfg.forwardPort,
                listenPort: cfg.listenPort,
                running: !!server && (server.listening as any) === true,
                certPath,
                keyPath,
                validTo,
            });
        }
        return results;
    }

    async start(hostname: string): Promise<HttpsProxyStatus> {
        // If already running, stop first
        if (this.servers.has(hostname)) {
            await this.stop(hostname);
        }

        const cfg = this.configManager.getHttpsProxy(hostname);
        if (!cfg) throw new Error(`HTTPS proxy config for '${hostname}' not found`);

        const { certPath, keyPath, validTo } = await this.ensureCertificate(hostname);
        const key = await fs.readFile(keyPath);
        const cert = await fs.readFile(certPath);

        // Use express-http-proxy (actively maintained)
        const expressMod = await import('express');
        const express: any = (expressMod as any).default ?? (expressMod as any);
        const proxy = (await import('express-http-proxy')).default as any;

        const app = express();
        app.disable('x-powered-by');

        await this.log(hostname, `Proxy starting: https :${cfg.listenPort} -> http 127.0.0.1:${cfg.forwardPort}`);

        app.use(
            proxy(`http://127.0.0.1:${cfg.forwardPort}`, {
                preserveHostHdr: true,
                parseReqBody: false,
                memoizeHost: false,
                // レスポンス本文の絶対URLを書き換え（HTMLまたはJSON、圧縮はスキップ）
                userResDecorator: (proxyRes: any, proxyResData: Buffer, req: http.IncomingMessage) => {
                    const ctypeRaw = proxyRes.headers['content-type'] || '';
                    const ctype = String(ctypeRaw).toLowerCase();
                    const isHtml = ctype.startsWith('text/html');
                    const isJson = ctype.includes('json');
                    if (!isHtml && !isJson) return proxyResData;
                    const enc = String(proxyRes.headers['content-encoding'] || '').toLowerCase();
                    if (enc && (enc.includes('gzip') || enc.includes('br') || enc.includes('deflate'))) {
                        // 圧縮レスポンスは改変しない
                        return proxyResData;
                    }
                    const authority = (req.headers as any)[':authority'];
                    const hostHeader = String(authority || req.headers?.host || '').trim();
                    if (!hostHeader) return proxyResData;

                    // host と port を分離
                    let hostOnly = hostHeader;
                    const idxColon = hostHeader.lastIndexOf(':');
                    if (idxColon > -1) {
                        const candidate = hostHeader.slice(idxColon + 1);
                        if (/^\d+$/.test(candidate)) {
                            hostOnly = hostHeader.slice(0, idxColon);
                        }
                    }

                    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                    // 常に: http://hostOnly:forwardPort → https へ
                    const httpWithPort = new RegExp(
                        `http://${escapeRegExp(hostOnly)}:${String(cfg.forwardPort)}\\b`,
                        'g'
                    );
                    // http://hostOnly:listenPort → https へ（待ち受けを http で返す場合）
                    const httpWithListenPort = new RegExp(
                        `http://${escapeRegExp(hostOnly)}:${String(cfg.listenPort)}\\b`,
                        'g'
                    );

                    // 出力ターゲット（443は省略）
                    const httpsTarget =
                        cfg.listenPort === 443
                            ? `https://${hostOnly}`
                            : `https://${hostOnly}:${String(cfg.listenPort)}`;

                    let body = proxyResData.toString('utf8');
                    body = body.replace(httpWithPort, httpsTarget);
                    body = body.replace(httpWithListenPort, httpsTarget);

                    // forwardPort が 80 または listenPort が 443 の場合、ポート省略形 http://hostOnly も置換
                    if (cfg.forwardPort === 80 || cfg.listenPort === 443) {
                        const httpNoPort = new RegExp(`http://${escapeRegExp(hostOnly)}\\b`, 'g');
                        body = body.replace(httpNoPort, httpsTarget);
                    }

                    return Buffer.from(body, 'utf8');
                },
                proxyErrorHandler: async (_err: any, _res: any, next: any) => {
                    await this.log(hostname, `Proxy error (upstream) occurred.`);
                    try {
                        next();
                    } catch { /* ignore */ }
                },
            })
        );

        const server = https.createServer({ key, cert }, app);

        // Note: express-http-proxy does not handle WS upgrades; add if needed later

        await new Promise<void>((resolve, reject) => {
            server.once('error', err => reject(err));
            server.listen(cfg.listenPort, '0.0.0.0', () => resolve());
        });

        await this.log(hostname, `Proxy started on :${cfg.listenPort}`);

        this.servers.set(hostname, server);
        this.proxies.set(hostname, app);

        return {
            hostname,
            forwardPort: cfg.forwardPort,
            listenPort: cfg.listenPort,
            running: true,
            certPath,
            keyPath,
            validTo,
        };
    }

    async stop(hostname: string): Promise<boolean> {
        const server = this.servers.get(hostname);
        const proxy = this.proxies.get(hostname);
        if (!server) return true;
        await new Promise<void>(resolve => {
            try {
                server.close(() => resolve());
            } catch {
                resolve();
            }
        });
        this.servers.delete(hostname);
        if (proxy && typeof (proxy as any).close === 'function') {
            try {
                (proxy as any).close();
            } catch { /* ignore */ }
        }
        this.proxies.delete(hostname);
        await this.log(hostname, `Proxy stopped`);
        return true;
    }

    async stopAll(): Promise<void> {
        const hosts = Array.from(this.servers.keys());
        for (const h of hosts) {
            await this.stop(h);
        }
    }

    async create(hostname: string, config: HttpsProxyConfig): Promise<void> {
        await this.configManager.addHttpsProxy(hostname, config);
    }

    async update(hostname: string, config: Partial<HttpsProxyConfig>): Promise<void> {
        await this.configManager.updateHttpsProxy(hostname, config);
        // If running and port changed, restart
        if (this.servers.has(hostname)) {
            await this.stop(hostname);
            await this.start(hostname);
        }
    }

    async delete(hostname: string): Promise<void> {
        await this.stop(hostname);
        await this.configManager.deleteHttpsProxy(hostname);
    }
}
