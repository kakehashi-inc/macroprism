const LINE_FEED = 0x0a;
const IDLE_FLUSH_MS = 200;
const MAX_PENDING_BYTES = 64 * 1024;

/**
 * 子プロセスの出力バイト列を行単位でテキストに変換する。
 * 同じ出力に UTF-8 とシステムのコードページが混在してもよいよう、行ごとに UTF-8 として厳密に検証し、
 * 不正な行だけを fallbackEncoding で読む。改行で終わらない出力は、出力が止まった時点で変換する。
 */
export class ProcessOutputDecoder {
    private readonly utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    private readonly fallbackDecoder: TextDecoder | null;
    private readonly onText: (text: string) => void;
    private pending: Buffer = Buffer.alloc(0);
    private idleTimer: NodeJS.Timeout | null = null;

    constructor(fallbackEncoding: string | null, onText: (text: string) => void) {
        this.fallbackDecoder = fallbackEncoding ? new TextDecoder(fallbackEncoding) : null;
        this.onText = onText;
    }

    write(chunk: Buffer): void {
        this.clearIdleTimer();
        const data = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
        const lastLineEnd = data.lastIndexOf(LINE_FEED);

        if (lastLineEnd >= 0) {
            this.pending = data.subarray(lastLineEnd + 1);
            this.emit(data.subarray(0, lastLineEnd + 1));
        } else {
            this.pending = data;
        }

        if (this.pending.length >= MAX_PENDING_BYTES) {
            this.flush();
        } else if (this.pending.length > 0) {
            this.idleTimer = setTimeout(() => this.flush(), IDLE_FLUSH_MS);
        }
    }

    /** 改行を待っている出力をすべて変換する。 */
    flush(): void {
        this.clearIdleTimer();
        if (this.pending.length === 0) {
            return;
        }
        const data = this.pending;
        this.pending = Buffer.alloc(0);
        this.emit(data);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private emit(data: Buffer): void {
        const text = this.tryDecodeUtf8(data) ?? this.decodeLineByLine(data);
        this.onText(text);
    }

    private decodeLineByLine(data: Buffer): string {
        let text = '';
        let start = 0;
        while (start < data.length) {
            const lineFeedAt = data.indexOf(LINE_FEED, start);
            const end = lineFeedAt >= 0 ? lineFeedAt + 1 : data.length;
            text += this.decodeLine(data.subarray(start, end));
            start = end;
        }
        return text;
    }

    private decodeLine(line: Buffer): string {
        const utf8Text = this.tryDecodeUtf8(line);
        if (utf8Text !== null) {
            return utf8Text;
        }
        return this.fallbackDecoder ? this.fallbackDecoder.decode(line) : line.toString('utf8');
    }

    private tryDecodeUtf8(data: Buffer): string | null {
        try {
            return this.utf8Decoder.decode(data);
        } catch {
            return null;
        }
    }
}
