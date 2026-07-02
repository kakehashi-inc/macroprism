import { HttpsPortMapping } from '../../shared/types';

export interface RewriterConfig {
    // 一致判定に使うホスト名群 (ワイルドカード *.example.local を含められる)
    hostnames: string[];
    // ポート転送定義 (from=http, to=https)
    portMappings: HttpsPortMapping[];
}

/**
 * バックエンド(HTTP)が返す絶対URLを、ブラウザ向けのHTTPS URLへ書き換える共通ロジック。
 *
 * ルール(Locationリダイレクト/本文置換で共通):
 * - スキーマが http のURLのみ対象(https はそのまま)。
 * - ホスト名がプロキシに宣言されたホスト名(完全一致 または *.suffix のワイルドカード一致)の場合のみ対象。
 *   → 事前に宣言したホストのみを対象とし、外部サーバーは対象外。IP解決は不要。
 * - ポートが portMappings の from もしくは to に一致する場合のみ対象(別ポートの別サービスは対象外)。
 * - ホスト名は維持し、スキーマを https、ポートを対応する to に差し替える。
 */
export class HttpsUrlRewriter {
    private hostnames: string[];
    private portMappings: HttpsPortMapping[];
    private logFn?: (message: string) => void;

    constructor(cfg: RewriterConfig, logFn?: (message: string) => void) {
        this.hostnames = (cfg.hostnames || []).map(h => h.trim().toLowerCase()).filter(Boolean);
        this.portMappings = cfg.portMappings || [];
        this.logFn = logFn;
    }

    /**
     * Location ヘッダ等の単一URLを書き換える。
     * 変更が無い(相対URL/対象外/https)場合は null を返す。
     */
    rewriteLocation(location: string): string | null {
        let url: URL;
        try {
            url = new URL(location);
        } catch {
            // 相対URL等はパース不可。ブラウザ側はHTTPSオリジンで解決するため変更不要。
            return null;
        }
        if (url.protocol !== 'http:') return null;

        if (!this.hostMatches(url.hostname)) return null;
        const port = url.port ? parseInt(url.port, 10) : null;
        const target = this.targetPortFor(port);
        if (target === null) return null;

        url.protocol = 'https:';
        url.port = target === 443 ? '' : String(target);
        const rewritten = url.toString();
        return rewritten !== location ? rewritten : null;
    }

    /**
     * HTML/JS本文中の絶対httpURLを、同一ルールで一括置換する。
     * オリジン単位で判定・置換し(パス以降は変更しない)、大きな本文でも高速。
     */
    rewriteBody(body: string): string {
        // http://host または http://[ipv6] に任意ポートが続くオリジン部を捕捉
        const re = /http:\/\/(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::(\d+))?/g;
        const matches = body.match(re);
        if (!matches) return body;

        // オリジン文字列(小文字化) -> 置換後オリジン or null(対象外)
        const decisions = new Map<string, string | null>();
        for (const raw of matches) {
            const key = raw.toLowerCase();
            if (decisions.has(key)) continue;

            const parsed = this.parseOrigin(raw);
            if (!parsed) {
                decisions.set(key, null);
                continue;
            }
            if (!this.hostMatches(parsed.host)) {
                decisions.set(key, null);
                continue;
            }
            const target = this.targetPortFor(parsed.port);
            if (target === null) {
                decisions.set(key, null);
                continue;
            }
            decisions.set(key, this.httpsOrigin(parsed.host, target));
        }

        return body.replace(re, matched => {
            const rep = decisions.get(matched.toLowerCase());
            return rep ?? matched;
        });
    }

    /** URLのホストが宣言済みホスト名(完全一致/ワイルドカード)に一致するか。 */
    private hostMatches(rawHost: string): boolean {
        const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase();
        if (!host) return false;
        for (const pattern of this.hostnames) {
            if (pattern === host) return true;
            if (pattern.startsWith('*.')) {
                const suffix = pattern.slice(1); // '.example.local'
                // ワイルドカードは1ラベルのみ (foo.example.local は可, a.b.example.local は不可)
                if (host.endsWith(suffix)) {
                    const label = host.slice(0, host.length - suffix.length);
                    if (label.length > 0 && !label.includes('.')) return true;
                }
            }
        }
        return false;
    }

    /**
     * URLのポートに対応する出力(https)ポートを返す。対象外なら null。
     * - from に一致 -> 対応する to
     * - to に一致   -> その to (スキーマのみ変更)
     * - ポート省略時は 80 とみなす
     */
    private targetPortFor(port: number | null): number | null {
        const eff = port ?? 80;
        for (const m of this.portMappings) {
            if (eff === m.from) return m.to;
        }
        for (const m of this.portMappings) {
            if (eff === m.to) return m.to;
        }
        return null;
    }

    private httpsOrigin(host: string, targetPort: number): string {
        return targetPort === 443 ? `https://${host}` : `https://${host}:${String(targetPort)}`;
    }

    /** 'http://host:port' からホスト(ブラケット付きIPv6可)とポートを取り出す。 */
    private parseOrigin(raw: string): { host: string; port: number | null } | null {
        const m = raw.match(/^http:\/\/(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::(\d+))?$/);
        if (!m) return null;
        return { host: m[1], port: m[2] ? parseInt(m[2], 10) : null };
    }

    log(message: string): void {
        this.logFn?.(message);
    }
}
