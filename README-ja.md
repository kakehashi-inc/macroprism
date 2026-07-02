# MacroPrism

MacroPrism（マクロプリズム） — ローカル環境の自動化ハブ。動かし、繋ぎ、公開し、見守る。

任意のローカルプロセスの起動・停止・監視・ログ取得・公開(ngrok)を行うElectronベースのGUIアプリケーション。

本体は汎用のプロセス管理機能です。`mcp-auth-proxy` 連携はプロセスに関連付けてOIDC認証を付与できる付属機能で、これによりMCPサーバーの運用といった用途にも利用できます。

## 機能

- **プロセス管理**: 任意のコマンドをプロセスとして登録し、起動/停止、状態監視、エラーハンドリングを実施
- **自動起動/自動再起動**: アプリ起動時の自動起動、異常終了時の条件付き自動再起動
- **WSL対応 (Windows)**: `platform: "wsl"` 指定でWSL内実行、ディストリ選択に対応
- **ログ管理**: プロセスごとに `stdout`/`stderr` を日別ファイルへ記録、保持日数で自動削除、定期ローテーション
- **ngrok連携**: 複数ポートを同時にトンネリング、URL表示・コピー、ログ閲覧/クリア
- **HTTPSプロキシ管理**: ローカルでTLS終端しローカルHTTPへ転送、日次ログ、内蔵ローカルCAによる証明書の発行・自動更新（ダウンロードしたCA証明書をOSの信頼ストアへ一度登録すればブラウザ警告が消えます）
- **Auth Proxy連携 (任意)**: プロセスに `mcp-auth-proxy` を関連付けてOIDC認証を付与可能
- **多言語対応/テーマ**: 日本語/英語、ライト/ダーク

## 対応OS

- Windows 10/11
- macOS 10.15+
- Linux (Debian系/RHEL系)

注記: 本プロジェクトは Windows ではコード署名を行っていません。SmartScreen が警告を表示する場合は「詳細情報」→「実行」を選択してください。

## データファイルの保存場所

すべてのデータは `~/.mcpm` ディレクトリに保存されます（`mcpm` は MacroPrism の子音 **M**a**c**ro **P**ris**m** に由来する内部識別子です）：

- **設定ファイル**: `~/.mcpm/config.json`
- **ログファイル**: `~/.mcpm/logs/`
  - プロセスログ: `{server_id}_YYYYMMDD_stdout.log`, `{server_id}_YYYYMMDD_stderr.log`
  - ngrokログ: `ngrok_YYYYMMDD.log`
  - HTTPSプロキシログ: `https_proxy_YYYYMMDD.log`

### ファイル構造

```text
~/.mcpm/
├── config.json      # 設定とプロセス定義
├── certs/           # HTTPSプロキシ用の証明書
│   ├── ca/          # 全プロキシ証明書の署名元となるローカルCA
│   │   ├── ca-cert.pem
│   │   └── ca-key.pem
│   └── <プロキシ名>/
│       ├── cert.pem
│       └── key.pem
└── logs/            # ログファイル
    ├── {server_id}_YYYYMMDD_stdout.log
    ├── {server_id}_YYYYMMDD_stderr.log
    ├── ngrok_YYYYMMDD.log
    └── https_proxy_YYYYMMDD.log
```

### config.json の形式

アプリ既定の `DEFAULT_CONFIG` を基に生成される設定ファイル。旧バージョンで作成された設定ファイルは、起動時に新しいレイアウトへ自動移行されます：

```json
{
  "processes": {
    "web-app": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "NODE_ENV": "production"
      },
      "displayName": "Web App",
      "platform": "host",
      "autoStart": true,
      "autoRestartOnError": true,
      "useAuthProxy": false
    },
    "batch-worker": {
      "command": "python",
      "args": ["worker.py"],
      "displayName": "Batch Worker",
      "platform": "wsl",
      "wslDistribution": "Ubuntu",
      "autoStart": false
    }
  },
  "settings": {
    "language": "ja",
    "darkMode": false,
    "logDirectory": "~/.mcpm/logs",
    "logRetentionDays": 7,
    "restartDelayMs": 5000,
    "successfulStartThresholdMs": 10000,
    "showWindowOnStartup": true,
    "ngrokAuthToken": "",
    "ngrokMetadataName": "MacroPrism",
    "ngrokPorts": "3000,4000",
    "ngrokAutoStart": false,
    "httpsProxies": {
      "my-proxy": {
        "bindMode": "local",
        "bindAddresses": [],
        "hostnames": ["localhost", "*.example.local"],
        "portMappings": [
          { "from": 8080, "to": 8443 },
          { "from": 9090, "to": 9443 }
        ],
        "autoStart": true
      }
    },
    "oidcProviderName": "Auth0",
    "oidcConfigurationUrl": "",
    "oidcClientId": "",
    "oidcClientSecret": "",
    "oidcAllowedUsers": "",
    "oidcAllowedUsersGlob": ""
  }
}
```

#### プロセス設定項目（`processes`）

- **command**: 実行コマンド
- **args**: 引数配列
- **env**: 環境変数
- **displayName**: 表示名
- **platform**: 実行環境 ("host" | "wsl")
- **wslDistribution**: WSLディストリ名（WSL時）
- **autoStart**: アプリ起動時の自動実行
- **autoRestartOnError**: 異常終了時の自動再起動(条件付き)
- **useAuthProxy**: mcp-auth-proxyでラップ実行
- **authProxyListenPort** / **authProxyExternalUrl**: Auth Proxy利用時の必須項目

#### HTTPSプロキシ設定項目（`httpsProxies`）

各エントリは**プロキシ名**（任意の識別子）をキーにします。

- **bindMode**: 待ち受けアドレスの指定方式。`"local"`（既定）は `127.0.0.1` と `::1`、`"all"` は `0.0.0.0`（IPv4全アドレス）と `::`（IPv6全アドレス）、`"custom"` は `bindAddresses` に列挙したアドレスで待ち受けます。
- **bindAddresses**: `bindMode` が `"custom"` のときに使うアドレス群（例: `127.0.0.1`、`::1`、`0.0.0.0`）。個数制限なし、1件以上必須。
- **hostnames**: このプロキシが扱うホスト名。証明書のSANと、リダイレクト・ページ内の `http://` URL をHTTPSへ書き換える際の判定に使います。`*.example.local` のようなワイルドカードが使えます（証明書にもワイルドカードSANとして登録）。
- **portMappings**: ポート転送定義（複数可）。各 `{ "from": <httpポート>, "to": <httpsポート> }` が、各バインドアドレスの `to` でHTTPS待ち受けを開始し `http://127.0.0.1:<from>` へ転送します。
- **autoStart**: アプリ起動時にこのプロキシを自動起動します。

旧バージョンで作成された設定（ホスト名キーの `forwardPort`/`listenPort` 形式）は起動時に自動で新形式へ移行されます。`bindMode` が無い設定は `"local"` として（既定値以外の `bindAddresses` を既に持つ場合は `"custom"` として）引き継がれます。

## 開発者向けリファレンス

### 必要要件

- Node.js 22.x以上
- yarn 4
- Git

### インストール

```bash
# リポジトリのクローン
git clone <repository-url>
cd <repository-name>

# 依存関係のインストール
yarn install

# 開発起動
yarn dev
```

開発時のDevTools:

- DevTools はデタッチ表示で自動的に開きます
- F12 または Ctrl+Shift+I（macOSは Cmd+Option+I）でトグル可能

### ビルド/配布

- Windows: `yarn dist:win`
- macOS: `yarn dist:mac`
- Linux: `yarn dist:linux`

開発時は BrowserRouter で `<http://localhost:3001>` を、配布ビルドでは HashRouter で `dist/renderer/index.html` を読み込みます。

### GitHub への直接リリース (自動アップデート用)

`electron-builder.yml` の `publish:` に設定した GitHub リポジトリに、ビルド成果物と `latest*.yml` (自動アップデート用メタデータ) を直接アップロードするコマンドです。`releaseType: draft` 設定のため、各コマンドは GitHub 上の **同一バージョンのドラフトリリースに集約** されます。全プラットフォーム揃ってから GitHub UI で「Publish release」を押すとユーザーへ配信されます。

- Windows: `yarn release:win`
- macOS: `yarn release:mac`
- Linux: `yarn release:linux`

実行前に GitHub Personal Access Token (`public_repo` スコープ) を環境変数 `GH_TOKEN` に設定してください。

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
```

複数台で各プラットフォームをビルドする場合は、`package.json` の `version` を全マシンで一致させた上で、各マシンで該当する `release:*` を順に実行してください。

### macOS 事前準備: 署名・公証用の環境変数

macOS 向けに署名・公証付きビルドを行う場合は、`yarn dist:mac` の実行前に以下の環境変数を設定してください。

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

### Windows 事前準備: 開発者モード

Windows で署名なしのローカルビルド/配布物を実行・テストする場合は、OSの開発者モードを有効にしてください。

1. 設定 → プライバシーとセキュリティ → 開発者向け
2. 「開発者モード」をオンにする
3. OSを再起動

### プロジェクト構造 (抜粋)

```text
src/
├── main/                  # Electron メイン: IPC/各種マネージャ
│   ├── index.ts           # 起動・ウィンドウ生成・サービス初期化
│   ├── ipc/               # IPCハンドラ
│   ├── services/          # 各種サービス
│   └── utils/             # 各種ユーティリティ
├── preload/               # renderer へ安全にAPIをブリッジ
├── renderer/              # React + MUI UI
├── shared/                # 型定義・定数(Default設定/保存パス)
└── public/                # アイコン等
```

### 使用技術

- **Electron**
- **React (MUI v7)**
- **TypeScript**
- **Zustand**
- **i18next**
- **Vite**

### Windows用アイコンの作成

```exec
magick public/icon.png -define icon:auto-resize=256,128,96,64,48,32,24,16 public/icon.ico
```

### WSL について（Windows）

- 起動時にWSLの有無を検出し、`wsl.exe -l -q/-v` を用いてディストリ一覧/既定/稼働状態を取得します

### 補足

- ngrokの同時セッション上限に達すると起動に失敗します。CLI/デスクトップ、またはダッシュボードの Agents で不要なセッションを切断してください。
- 「×」で閉じるとアプリは終了せずトレイへ格納されます。終了はトレイメニューの「終了」から行ってください。
