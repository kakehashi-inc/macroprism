// HTTPSプロキシのURL書き換えロジック検証用スクリプト(調査用)。
// 事前に `npx tsc -p tsconfig.main.json` でビルドしてから node で実行する。
import { HttpsUrlRewriter } from '../dist/main/services/HttpsUrlRewriter.js';

let pass = 0;
let fail = 0;
function assert(name, actual, expected) {
    const ok = actual === expected;
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}\n   got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
}

// 例: localhost で 8080->8443 と 9090->9443 の複数転送、複数ホスト名(ワイルドカード含む)
const r = new HttpsUrlRewriter({
    hostnames: ['localhost', '*.example.local'],
    portMappings: [
        { from: 8080, to: 8443 },
        { from: 9090, to: 9443 },
    ],
});

// リダイレクト(Location)
assert('例1 localhost:8080 -> 8443', r.rewriteLocation('http://localhost:8080/fan/start'), 'https://localhost:8443/fan/start');
assert('別マッピング 9090 -> 9443', r.rewriteLocation('http://localhost:9090/x'), 'https://localhost:9443/x');
assert('listenポートをhttpで返す 8443', r.rewriteLocation('http://localhost:8443/x'), 'https://localhost:8443/x');
assert('ワイルドカード一致 foo.example.local', r.rewriteLocation('http://foo.example.local:8080/a'), 'https://foo.example.local:8443/a');
assert('ワイルドカード多段は不一致', r.rewriteLocation('http://a.b.example.local:8080/a'), null);
assert('宣言外ホストは対象外', r.rewriteLocation('http://example.com:8080/a'), null);
assert('別ポートは対象外', r.rewriteLocation('http://localhost:3000/a'), null);
assert('相対URLはnull', r.rewriteLocation('/fan/start'), null);
assert('httpsはそのまま', r.rewriteLocation('https://localhost:8080/a'), null);

// 443/80 の省略
const r443 = new HttpsUrlRewriter({ hostnames: ['localhost'], portMappings: [{ from: 80, to: 443 }] });
assert('443出力は省略', r443.rewriteLocation('http://localhost:80/a'), 'https://localhost/a');
assert('80省略入力 -> 443省略出力', r443.rewriteLocation('http://localhost/a'), 'https://localhost/a');

// 本文置換
const body = [
    '<a href="http://localhost:8080/fan/start">x</a>',
    'fetch("http://foo.example.local:9090/api")',
    'var ext = "http://example.com:8080/y";',
    'var other = "http://localhost:3000/z";',
].join('\n');
const out = r.rewriteBody(body);
assert('本文 localhost:8080 置換', out.includes('https://localhost:8443/fan/start'), true);
assert('本文 ワイルドカード:9090 置換', out.includes('https://foo.example.local:9443/api'), true);
assert('本文 外部は保持', out.includes('http://example.com:8080/y'), true);
assert('本文 別ポートは保持', out.includes('http://localhost:3000/z'), true);

// IPv6 (宣言されていれば対象)
const r6 = new HttpsUrlRewriter({ hostnames: ['[::1]', '::1'], portMappings: [{ from: 8080, to: 8443 }] });
assert('IPv6 [::1]:8080 -> 8443', r6.rewriteLocation('http://[::1]:8080/a'), 'https://[::1]:8443/a');

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
