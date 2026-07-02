import * as fs from 'fs/promises';
import * as path from 'path';
import {
    AppConfig,
    AppSettings,
    ProcessConfig,
    Processes,
    HttpsProxies,
    HttpsProxyConfig,
} from '../../shared/types';
import { DEFAULT_CONFIG, getConfigPath } from '../../shared/constants';

export class ConfigManager {
    private config: AppConfig;
    private configPath: string;

    constructor() {
        this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        // Ensure optional sections exist
        (this.config as any).httpsProxies = (this.config as any).httpsProxies || {};
        this.configPath = getConfigPath();
    }

    async initialize(): Promise<void> {
        await this.ensureConfigDirectory();
        await this.loadConfig();
    }

    private async ensureConfigDirectory(): Promise<void> {
        const dir = path.dirname(this.configPath);
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    private async loadConfig(): Promise<void> {
        try {
            const data = await fs.readFile(this.configPath, 'utf-8');
            const loadedConfig = JSON.parse(data);
            // The legacy layout stored process definitions under "mcpServers"
            const legacyProcesses = loadedConfig.mcpServers;
            const hasLegacyProcesses = !loadedConfig.processes && legacyProcesses;
            // HTTPSプロキシ設定を新レイアウト(プロキシ名/複数ホスト名/複数ポート転送)へ移行
            const { proxies: migratedProxies, changed: httpsChanged } = migrateHttpsProxies(
                loadedConfig.httpsProxies
            );
            // Merge with defaults to ensure all fields exist
            this.config = {
                processes: loadedConfig.processes || legacyProcesses || {},
                settings: { ...DEFAULT_CONFIG.settings, ...(loadedConfig.settings || {}) },
                httpsProxies: migratedProxies,
            } as AppConfig;
            if (hasLegacyProcesses || httpsChanged) {
                // Persist immediately so the file switches to the new layout
                await this.saveConfig();
            }
        } catch (error) {
            // If file doesn't exist or is invalid, use defaults
            this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            (this.config as any).httpsProxies = (this.config as any).httpsProxies || {};
            await this.saveConfig();
        }
    }

    private async saveConfig(): Promise<void> {
        await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    }

    // Full config methods
    getConfig(): AppConfig {
        return JSON.parse(JSON.stringify(this.config));
    }

    async updateConfig(newConfig: Partial<AppConfig>): Promise<AppConfig> {
        this.config = {
            ...this.config,
            ...newConfig,
        };
        await this.saveConfig();
        return this.getConfig();
    }

    // Settings methods
    getSettings(): AppSettings {
        return { ...this.config.settings };
    }

    async updateSettings(newSettings: Partial<AppSettings>): Promise<AppSettings> {
        this.config.settings = { ...this.config.settings, ...newSettings };
        await this.saveConfig();
        return this.getSettings();
    }

    // Process methods
    getProcesses(): Processes {
        return { ...this.config.processes };
    }

    getProcess(id: string): ProcessConfig | null {
        return this.config.processes[id] || null;
    }

    async addProcess(id: string, processConfig: ProcessConfig): Promise<void> {
        if (this.config.processes[id]) {
            throw new Error(`Process with id '${id}' already exists`);
        }
        this.config.processes[id] = processConfig;
        await this.saveConfig();
    }

    async updateProcess(id: string, processConfig: Partial<ProcessConfig>): Promise<void> {
        if (!this.config.processes[id]) {
            throw new Error(`Process with id '${id}' not found`);
        }
        this.config.processes[id] = {
            ...this.config.processes[id],
            ...processConfig,
        };
        await this.saveConfig();
    }

    async deleteProcess(id: string): Promise<void> {
        delete this.config.processes[id];
        await this.saveConfig();
    }

    async renameProcess(oldId: string, newId: string): Promise<void> {
        if (!this.config.processes[oldId]) {
            throw new Error(`Process with id '${oldId}' not found`);
        }
        if (this.config.processes[newId]) {
            throw new Error(`Process with id '${newId}' already exists`);
        }

        this.config.processes[newId] = this.config.processes[oldId];
        delete this.config.processes[oldId];
        await this.saveConfig();
    }

    // Utility methods
    getLogDirectory(): string {
        return this.config.settings.logDirectory;
    }

    // HTTPS Proxy methods (key = proxy name)
    getHttpsProxies(): HttpsProxies {
        const proxies = (this.config as any).httpsProxies || {};
        return { ...proxies };
    }

    getHttpsProxy(name: string): HttpsProxyConfig | null {
        const proxies = (this.config as any).httpsProxies || {};
        return proxies[name] || null;
    }

    async addHttpsProxy(name: string, proxy: HttpsProxyConfig): Promise<void> {
        const proxies: HttpsProxies = (this.config as any).httpsProxies || {};
        if (proxies[name]) {
            throw new Error(`HTTPS proxy '${name}' already exists`);
        }
        (this.config as any).httpsProxies = { ...proxies, [name]: proxy };
        await this.saveConfig();
    }

    async updateHttpsProxy(name: string, proxy: Partial<HttpsProxyConfig>): Promise<void> {
        const proxies: HttpsProxies = (this.config as any).httpsProxies || {};
        if (!proxies[name]) {
            throw new Error(`HTTPS proxy '${name}' not found`);
        }
        (this.config as any).httpsProxies = {
            ...proxies,
            [name]: { ...proxies[name], ...proxy },
        };
        await this.saveConfig();
    }

    async deleteHttpsProxy(name: string): Promise<void> {
        const proxies: HttpsProxies = (this.config as any).httpsProxies || {};
        if (proxies[name]) {
            const { [name]: _removed, ...rest } = proxies;
            (this.config as any).httpsProxies = rest;
            await this.saveConfig();
        }
    }
}

/**
 * 旧レイアウトのHTTPSプロキシ設定を新レイアウトへ移行する。
 * 旧: { [hostname]: { forwardPort, listenPort, autoStart } }
 * 新: { [name]:     { hostnames:[hostname], portMappings:[{from,to}], autoStart } }
 * キー(旧hostname)はそのままプロキシ名として引き継ぐ。既に新形式のものは変更しない。
 * 戻り値の changed が true の場合、呼び出し側で保存する。
 */
export function migrateHttpsProxies(raw: any): { proxies: HttpsProxies; changed: boolean } {
    const src = raw || {};
    const out: HttpsProxies = {};
    let changed = false;
    for (const [key, value] of Object.entries<any>(src)) {
        if (value && Array.isArray(value.portMappings)) {
            // 既に新形式
            out[key] = {
                hostnames: Array.isArray(value.hostnames) ? value.hostnames : [],
                portMappings: value.portMappings,
                autoStart: !!value.autoStart,
            };
            continue;
        }
        // 旧形式 -> 新形式
        const from = Number(value?.forwardPort);
        const to = Number(value?.listenPort);
        out[key] = {
            hostnames: [key],
            portMappings:
                Number.isFinite(from) && Number.isFinite(to) ? [{ from, to }] : [],
            autoStart: !!value?.autoStart,
        };
        changed = true;
    }
    return { proxies: out, changed };
}
