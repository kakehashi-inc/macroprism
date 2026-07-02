import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as https from 'https';
import { X509Certificate } from 'crypto';
import { ConfigManager } from './ConfigManager';
import { getCertsPath } from '../../shared/constants';
import { HttpsProxies, HttpsProxyConfig, HttpsProxyStatus } from '../../shared/types';
import { HttpsUrlRewriter } from './HttpsUrlRewriter';

export class HttpsProxyManager {
    private configManager: ConfigManager;
    // プロキシ名 -> 稼働中のHTTPSサーバー群 (portMappingごとに1つ)
    private servers: Map<string, https.Server[]> = new Map();
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

    // 証明書はプロキシ名ごとのディレクトリに保存する。
    private sanitizeName(name: string): string {
        return name.replace(/[^A-Za-z0-9._-]/g, '_');
    }

    private getProxyDir(name: string): string {
        return path.join(getCertsPath(), this.sanitizeName(name));
    }

    private getKeyPath(name: string): string {
        return path.join(this.getProxyDir(name), 'key.pem');
    }

    private getCertPath(name: string): string {
        return path.join(this.getProxyDir(name), 'cert.pem');
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

    private async log(name: string, message: string): Promise<void> {
        try {
            const stream = await this.ensureLogStream();
            const now = new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            const pad3 = (n: number) => String(n).padStart(3, '0');
            const ts = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(
                now.getHours()
            )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad3(now.getMilliseconds())}`;
            stream.write(`[${ts}] [${name}] ${message}\n`);
        } catch { /* ignore */ }
    }

    async readLogs(_name: string, lines: number = 200): Promise<string[]> {
        try {
            const file = this.getLogFilePath();
            const content = await fs.readFile(file, 'utf-8');
            const arr = content.split('\n').filter(l => l.trim() !== '');
            return arr.slice(-lines);
        } catch {
            return [];
        }
    }

    async clearLogs(_name: string): Promise<void> {
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

    // 証明書に含まれるDNS SANの一覧(小文字)を返す。
    private parseCertDnsNames(certPem: string | null): string[] {
        if (!certPem) return [];
        try {
            const x = new X509Certificate(certPem);
            const san = x.subjectAltName || '';
            return san
                .split(',')
                .map(s => s.trim())
                .filter(s => s.toUpperCase().startsWith('DNS:'))
                .map(s => s.slice(4).trim().toLowerCase())
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    private async ensureProxyDir(name: string): Promise<void> {
        const dir = this.getProxyDir(name);
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    async regenerateCertificate(
        name: string,
        hostnames: string[],
        days: number = 90
    ): Promise<{ certPath: string; keyPath: string; validTo?: string }> {
        await this.ensureProxyDir(name);
        // Lazy-import selfsigned to avoid ESM/CJS pitfalls during load
        const mod = await import('selfsigned');
        const selfsigned: any = (mod as any).default ?? mod;

        const names = (hostnames || []).map(h => h.trim()).filter(Boolean);
        const commonName = names[0] || name;
        // 全ホスト名をDNS SANに、ループバックIPも付与する。
        const altNames: any[] = names.map(h => ({ type: 2, value: h })); // DNS
        altNames.push({ type: 7, ip: '127.0.0.1' });
        altNames.push({ type: 7, ip: '::1' });

        const attrs = [{ name: 'commonName', value: commonName }];
        const pems = await selfsigned.generate(attrs, {
            days,
            keySize: 2048,
            algorithm: 'sha256',
            extensions: [{ name: 'subjectAltName', altNames }],
        });

        const keyPath = this.getKeyPath(name);
        const certPath = this.getCertPath(name);
        await fs.writeFile(keyPath, pems.private, 'utf-8');
        await fs.writeFile(certPath, pems.cert, 'utf-8');

        const validTo = this.parseValidTo(pems.cert);

        // If running, restart to apply new certs
        if (this.servers.has(name)) {
            try {
                await this.stop(name);
                await this.start(name);
            } catch {
                // ignore restart failure
            }
        }

        return { certPath, keyPath, validTo };
    }

    private async ensureCertificate(
        name: string,
        hostnames: string[]
    ): Promise<{ certPath: string; keyPath: string; validTo?: string }> {
        await this.ensureProxyDir(name);
        const keyPath = this.getKeyPath(name);
        const certPath = this.getCertPath(name);

        const certContent = await this.readFileIfExists(certPath);
        const keyContent = await this.readFileIfExists(keyPath);
        const validTo = this.parseValidTo(certContent);

        const now = Date.now();
        const isExpired = validTo ? new Date(validTo).getTime() <= now : true;

        // 証明書のDNS SANが現在のホスト名集合と完全一致するか(追加・削除いずれも再生成)。
        const certNames = new Set(this.parseCertDnsNames(certContent));
        const wanted = (hostnames || []).map(h => h.trim().toLowerCase()).filter(Boolean);
        const wantedSet = new Set(wanted);
        const hostnamesMatch =
            certNames.size === wantedSet.size && wanted.every(h => certNames.has(h));

        if (!certContent || !keyContent || isExpired || !hostnamesMatch) {
            return await this.regenerateCertificate(name, hostnames, 90);
        }

        return { certPath, keyPath, validTo };
    }

    list(): HttpsProxies {
        return this.configManager.getHttpsProxies();
    }

    private isRunning(name: string): boolean {
        const servers = this.servers.get(name);
        if (!servers || servers.length === 0) return false;
        return servers.some(s => (s.listening as any) === true);
    }

    status(): HttpsProxyStatus[] {
        const proxies = this.list();
        const results: HttpsProxyStatus[] = [];
        for (const [name, cfg] of Object.entries(proxies)) {
            const certPath = this.getCertPath(name);
            const keyPath = this.getKeyPath(name);
            let validTo: string | undefined;
            try {
                const certPem = readFileSync(certPath, 'utf-8');
                validTo = this.parseValidTo(certPem);
            } catch { /* ignore */ }
            results.push({
                name,
                hostnames: cfg.hostnames || [],
                portMappings: cfg.portMappings || [],
                running: this.isRunning(name),
                certPath,
                keyPath,
                validTo,
            });
        }
        return results;
    }

    async start(name: string): Promise<HttpsProxyStatus> {
        // If already running, stop first
        if (this.servers.has(name)) {
            await this.stop(name);
        }

        const cfg = this.configManager.getHttpsProxy(name);
        if (!cfg) throw new Error(`HTTPS proxy config for '${name}' not found`);

        const hostnames = cfg.hostnames || [];
        const mappings = (cfg.portMappings || []).filter(m => m && m.from > 0 && m.to > 0);
        if (mappings.length === 0) throw new Error(`HTTPS proxy '${name}' has no port mappings`);

        const { certPath, keyPath, validTo } = await this.ensureCertificate(name, hostnames);
        const key = await fs.readFile(keyPath);
        const cert = await fs.readFile(certPath);

        // Use express-http-proxy (actively maintained)
        const expressMod = await import('express');
        const express: any = (expressMod as any).default ?? (expressMod as any);
        const proxy = (await import('express-http-proxy')).default as any;

        // URL書き換え(リダイレクト/本文)を担うリライタ。プロキシの全ホスト名/全ポートを対象にする。
        const rewriter = new HttpsUrlRewriter({ hostnames, portMappings: mappings }, msg => {
            void this.log(name, msg);
        });

        const servers: https.Server[] = [];
        try {
            for (const mapping of mappings) {
                const app = express();
                app.disable('x-powered-by');

                await this.log(
                    name,
                    `Proxy starting: https :${mapping.to} -> http 127.0.0.1:${mapping.from}`
                );

                app.use(
                    proxy(`http://127.0.0.1:${mapping.from}`, {
                        preserveHostHdr: true,
                        parseReqBody: false,
                        memoizeHost: false,
                        // リダイレクト(Locationヘッダ)の絶対URLを同一ルールで書き換え
                        userResHeaderDecorator: (headers: Record<string, any>) => {
                            const key2 =
                                'location' in headers
                                    ? 'location'
                                    : 'Location' in headers
                                      ? 'Location'
                                      : null;
                            const loc = key2 ? headers[key2] : undefined;
                            if (key2 && typeof loc === 'string' && loc) {
                                try {
                                    const rewritten = rewriter.rewriteLocation(loc);
                                    if (rewritten) {
                                        headers[key2] = rewritten;
                                        void this.log(name, `Redirect rewritten: ${loc} -> ${rewritten}`);
                                    }
                                } catch { /* ignore */ }
                            }
                            return headers;
                        },
                        // レスポンス本文の絶対URLを書き換え（HTMLまたはJSON、br/deflate圧縮はスキップ）
                        userResDecorator: (proxyRes: any, proxyResData: Buffer) => {
                            const ctypeRaw = proxyRes.headers['content-type'] || '';
                            const ctype = String(ctypeRaw).toLowerCase();
                            const isHtml = ctype.startsWith('text/html');
                            const isJson = ctype.includes('json');
                            if (!isHtml && !isJson) return proxyResData;
                            // gzip は express-http-proxy が自動で展開/再圧縮するため処理可能。br/deflate は非対応。
                            const enc = String(proxyRes.headers['content-encoding'] || '').toLowerCase();
                            if (enc.includes('br') || enc.includes('deflate')) {
                                return proxyResData;
                            }
                            const body = proxyResData.toString('utf8');
                            const out = rewriter.rewriteBody(body);
                            return Buffer.from(out, 'utf8');
                        },
                        proxyErrorHandler: async (_err: any, _res: any, next: any) => {
                            await this.log(name, `Proxy error (upstream) occurred.`);
                            try {
                                next();
                            } catch { /* ignore */ }
                        },
                    })
                );

                const server = https.createServer({ key, cert }, app);
                await new Promise<void>((resolve, reject) => {
                    server.once('error', err => reject(err));
                    server.listen(mapping.to, '0.0.0.0', () => resolve());
                });
                await this.log(name, `Proxy started on :${mapping.to}`);
                servers.push(server);
            }
        } catch (err) {
            // いずれかの待ち受けに失敗したら、起動済みのものを閉じてから投げ直す。
            for (const s of servers) {
                try {
                    s.close();
                } catch { /* ignore */ }
            }
            throw err;
        }

        this.servers.set(name, servers);

        return {
            name,
            hostnames,
            portMappings: mappings,
            running: true,
            certPath,
            keyPath,
            validTo,
        };
    }

    async stop(name: string): Promise<boolean> {
        const servers = this.servers.get(name);
        if (!servers) return true;
        for (const server of servers) {
            await new Promise<void>(resolve => {
                try {
                    server.close(() => resolve());
                } catch {
                    resolve();
                }
            });
        }
        this.servers.delete(name);
        await this.log(name, `Proxy stopped`);
        return true;
    }

    async stopAll(): Promise<void> {
        const names = Array.from(this.servers.keys());
        for (const n of names) {
            await this.stop(n);
        }
    }

    async create(name: string, config: HttpsProxyConfig): Promise<void> {
        await this.configManager.addHttpsProxy(name, config);
    }

    async update(name: string, config: Partial<HttpsProxyConfig>): Promise<void> {
        await this.configManager.updateHttpsProxy(name, config);
        // If running and settings changed, restart
        if (this.servers.has(name)) {
            await this.stop(name);
            await this.start(name);
        }
    }

    async delete(name: string): Promise<void> {
        await this.stop(name);
        await this.configManager.deleteHttpsProxy(name);
    }
}
