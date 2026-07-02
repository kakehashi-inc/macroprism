import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { X509Certificate, randomBytes } from 'crypto';
import * as forge from 'node-forge';
import { ConfigManager } from './ConfigManager';
import {
    HTTPS_PROXY_ALL_BIND_ADDRESSES,
    HTTPS_PROXY_LOCAL_BIND_ADDRESSES,
    getCertsPath,
} from '../../shared/constants';
import { HttpsProxies, HttpsProxyConfig, HttpsProxyStatus } from '../../shared/types';
import { HttpsUrlRewriter } from './HttpsUrlRewriter';

export class HttpsProxyManager {
    private configManager: ConfigManager;
    // プロキシ名 -> 待ち受け中のサーバー群 (portMappingごとに1つ)。
    // TLS/平文HTTPを同一ポートで振り分けるため、待ち受けは素のnetサーバーで行う。
    private servers: Map<string, net.Server[]> = new Map();
    // プロキシ名 -> 待ち受けはせずconnectionを受け取る内部サーバー群 (停止時の接続破棄用)
    private innerServers: Map<string, (https.Server | http.Server)[]> = new Map();
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

    // ---- ローカルCA (全プロキシ証明書の共通の署名元) ----

    private getCaDir(): string {
        return path.join(getCertsPath(), 'ca');
    }

    getCaCertPath(): string {
        return path.join(this.getCaDir(), 'ca-cert.pem');
    }

    private getCaKeyPath(): string {
        return path.join(this.getCaDir(), 'ca-key.pem');
    }

    private generateKeyPair(): Promise<forge.pki.rsa.KeyPair> {
        return new Promise((resolve, reject) => {
            forge.pki.rsa.generateKeyPair({ bits: 2048 }, (err, keys) =>
                err ? reject(err) : resolve(keys)
            );
        });
    }

    // X.509シリアル番号。正の値かつ先頭が0にならないよう先頭バイトを調整する。
    private randomSerialNumber(): string {
        const bytes = randomBytes(16);
        bytes[0] = (bytes[0] & 0x7f) | 0x01;
        return bytes.toString('hex');
    }

    /**
     * ローカルCAを読み込む。無い、または残り有効期間が30日未満なら生成し直す (有効期間10年)。
     * OSの信頼ストアへの登録はユーザー自身が行う (アプリはCA証明書のダウンロード提供のみ)。
     */
    private async ensureCa(): Promise<{ certPem: string; keyPem: string }> {
        const certPem = await this.readFileIfExists(this.getCaCertPath());
        const keyPem = await this.readFileIfExists(this.getCaKeyPath());
        if (certPem && keyPem) {
            const validTo = this.parseValidTo(certPem);
            const margin = 30 * 24 * 60 * 60 * 1000;
            if (validTo && new Date(validTo).getTime() > Date.now() + margin) {
                return { certPem, keyPem };
            }
        }

        await fs.mkdir(this.getCaDir(), { recursive: true });
        const keys = await this.generateKeyPair();
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = this.randomSerialNumber();
        cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const notAfter = new Date();
        notAfter.setFullYear(notAfter.getFullYear() + 10);
        cert.validity.notAfter = notAfter;
        const attrs = [
            { name: 'commonName', value: 'MacroPrism Local CA' },
            { name: 'organizationName', value: 'MacroPrism' },
        ];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.setExtensions([
            { name: 'basicConstraints', cA: true, critical: true },
            { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
            { name: 'subjectKeyIdentifier' },
        ]);
        cert.sign(keys.privateKey, forge.md.sha256.create());

        const newCertPem = forge.pki.certificateToPem(cert);
        const newKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
        // 秘密鍵は所有者のみアクセス可にする (Windowsではmode指定は効かないがACLで保護される)
        await fs.writeFile(this.getCaKeyPath(), newKeyPem, { encoding: 'utf-8', mode: 0o600 });
        await fs.writeFile(this.getCaCertPath(), newCertPem, 'utf-8');
        return { certPem: newCertPem, keyPem: newKeyPem };
    }

    // CA証明書を指定先へコピーする (ユーザーがOSの信頼ストアへ登録する用途)。
    async exportCaCertificate(destPath: string): Promise<void> {
        await this.ensureCa();
        await fs.copyFile(this.getCaCertPath(), destPath);
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
        // ローカルCAで署名したサーバー証明書を発行する。
        const ca = await this.ensureCa();
        const caCert = forge.pki.certificateFromPem(ca.certPem);
        const caKey = forge.pki.privateKeyFromPem(ca.keyPem);

        const names = (hostnames || []).map(h => h.trim()).filter(Boolean);
        const commonName = names[0] || name;
        // 全ホスト名をDNS SANに、ループバックIPも付与する。
        const altNames: any[] = names.map(h => ({ type: 2, value: h })); // DNS
        altNames.push({ type: 7, ip: '127.0.0.1' });
        altNames.push({ type: 7, ip: '::1' });

        const keys = await this.generateKeyPair();
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = this.randomSerialNumber();
        cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
        cert.validity.notAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        cert.setSubject([{ name: 'commonName', value: commonName }]);
        cert.setIssuer(caCert.subject.attributes);
        cert.setExtensions([
            { name: 'basicConstraints', cA: false },
            { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
            { name: 'extKeyUsage', serverAuth: true },
            { name: 'subjectAltName', altNames },
            { name: 'subjectKeyIdentifier' },
        ]);
        cert.sign(caKey, forge.md.sha256.create());
        const certPem = forge.pki.certificateToPem(cert);

        const keyPath = this.getKeyPath(name);
        const certPath = this.getCertPath(name);
        await fs.writeFile(keyPath, forge.pki.privateKeyToPem(keys.privateKey), 'utf-8');
        await fs.writeFile(certPath, certPem, 'utf-8');

        const validTo = this.parseValidTo(certPem);

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
        const { certPem: caCertPem } = await this.ensureCa();
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

        // 現在のCAで署名された証明書か(旧方式の自己署名や、CA再生成前の証明書は再発行する)。
        let issuedByCa = false;
        if (certContent) {
            try {
                issuedByCa = new X509Certificate(certContent).verify(
                    new X509Certificate(caCertPem).publicKey
                );
            } catch {
                issuedByCa = false;
            }
        }

        if (!certContent || !keyContent || isExpired || !hostnamesMatch || !issuedByCa) {
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
        // バインドアドレスをモードから解決する (重複は除去)。未設定の古いデータは local 扱い。
        const bindMode = cfg.bindMode || 'local';
        const rawAddresses =
            bindMode === 'local'
                ? HTTPS_PROXY_LOCAL_BIND_ADDRESSES
                : bindMode === 'all'
                  ? HTTPS_PROXY_ALL_BIND_ADDRESSES
                  : cfg.bindAddresses || [];
        const bindAddresses = Array.from(
            new Set(rawAddresses.map(a => a.trim()).filter(Boolean))
        );
        if (bindAddresses.length === 0)
            throw new Error(`HTTPS proxy '${name}' has no bind addresses`);

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

        const servers: net.Server[] = [];
        const innerServers: (https.Server | http.Server)[] = [];
        try {
            for (const mapping of mappings) {
                const app = express();
                app.disable('x-powered-by');

                await this.log(
                    name,
                    `Proxy starting: https [${bindAddresses.join(', ')}]:${mapping.to} -> http 127.0.0.1:${mapping.from}`
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
                        // レスポンス本文の絶対URLを書き換え（HTML/JSON/プレーンテキスト、gzip/無圧縮以外はスキップ）
                        userResDecorator: (proxyRes: any, proxyResData: Buffer) => {
                            const ctypeRaw = proxyRes.headers['content-type'] || '';
                            const ctype = String(ctypeRaw).toLowerCase();
                            const isHtml = ctype.startsWith('text/html');
                            const isJson = ctype.includes('json');
                            const isText = ctype.startsWith('text/plain');
                            if (!isHtml && !isJson && !isText) return proxyResData;
                            // gzip は express-http-proxy が自動で展開/再圧縮するため処理可能。
                            // それ以外の圧縮(br/deflate/zstd等)は展開されないままここに届くため、
                            // 文字列として置換すると本文が壊れる。ホワイトリスト方式で素通しする。
                            const enc = String(proxyRes.headers['content-encoding'] || '').toLowerCase();
                            if (enc && enc !== 'gzip' && enc !== 'identity') {
                                void this.log(
                                    name,
                                    `Body rewrite skipped (unsupported content-encoding: ${enc})`
                                );
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

                // TLS終端するHTTPSサーバー (待ち受けはしない。netサーバーからconnectionを受け取る)
                const tlsServer = https.createServer({ key, cert }, app);
                // 平文HTTPで来た場合に同一URLのhttpsへリダイレクトするサーバー (同じく待ち受けなし)
                const redirectServer = http.createServer((req, res) => {
                    const host = req.headers.host || `localhost:${String(mapping.to)}`;
                    const location = `https://${host}${req.url || '/'}`;
                    res.writeHead(301, { Location: location, Connection: 'close' });
                    res.end();
                    void this.log(name, `HTTP on HTTPS port redirected: ${location}`);
                });
                innerServers.push(tlsServer, redirectServer);

                // 先頭1バイトで TLS(0x16=handshake) か平文HTTP かを判別して振り分ける。
                // バインドアドレスごとに待ち受けサーバーを立てる (TLS/リダイレクトサーバーは共有)。
                for (const bindAddress of bindAddresses) {
                    const server = net.createServer(socket => {
                        // データが来ないまま放置されるソケットの保険 (振り分け後は各サーバーが管理)
                        socket.setTimeout(10000, () => socket.destroy());
                        socket.once('data', chunk => {
                            socket.setTimeout(0);
                            socket.pause();
                            socket.unshift(chunk);
                            const isTls = chunk.length > 0 && chunk[0] === 0x16;
                            (isTls ? tlsServer : redirectServer).emit('connection', socket);
                            process.nextTick(() => socket.resume());
                        });
                        socket.on('error', () => { /* ignore */ });
                    });
                    await new Promise<void>((resolve, reject) => {
                        server.once('error', err => reject(err));
                        // '::' はIPv6専用でバインドする (既定のデュアルスタックだとIPv4も掴み、
                        // 同一ポートの 0.0.0.0 と衝突するため。IPv4側は 0.0.0.0 が担う)
                        server.listen(
                            { port: mapping.to, host: bindAddress, ipv6Only: bindAddress === '::' },
                            () => resolve()
                        );
                    });
                    await this.log(name, `Proxy started on ${bindAddress}:${mapping.to}`);
                    servers.push(server);
                }
            }
        } catch (err) {
            // いずれかの待ち受けに失敗したら、起動済みのものを閉じてから投げ直す。
            for (const s of [...servers, ...innerServers]) {
                try {
                    s.close();
                } catch { /* ignore */ }
            }
            throw err;
        }

        this.servers.set(name, servers);
        this.innerServers.set(name, innerServers);

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
        // 内部サーバー(TLS/リダイレクト)のキープアライブ接続を破棄してから待ち受けを閉じる。
        const inner = this.innerServers.get(name) || [];
        for (const s of inner) {
            try {
                (s as any).closeAllConnections?.();
                s.close(() => { /* not listening; ignore result */ });
            } catch { /* ignore */ }
        }
        this.innerServers.delete(name);
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
