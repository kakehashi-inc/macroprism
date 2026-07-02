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
            // Merge with defaults to ensure all fields exist
            this.config = {
                processes: loadedConfig.processes || legacyProcesses || {},
                settings: { ...DEFAULT_CONFIG.settings, ...(loadedConfig.settings || {}) },
                httpsProxies: loadedConfig.httpsProxies || {},
            } as AppConfig;
            if (hasLegacyProcesses) {
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

    // HTTPS Proxy methods
    getHttpsProxies(): HttpsProxies {
        const proxies = (this.config as any).httpsProxies || {};
        return { ...proxies };
    }

    getHttpsProxy(hostname: string): HttpsProxyConfig | null {
        const proxies = (this.config as any).httpsProxies || {};
        return proxies[hostname] || null;
    }

    async addHttpsProxy(hostname: string, proxy: HttpsProxyConfig): Promise<void> {
        const proxies: HttpsProxies = (this.config as any).httpsProxies || {};
        if (proxies[hostname]) {
            throw new Error(`HTTPS proxy for hostname '${hostname}' already exists`);
        }
        (this.config as any).httpsProxies = { ...proxies, [hostname]: proxy };
        await this.saveConfig();
    }

    async updateHttpsProxy(hostname: string, proxy: Partial<HttpsProxyConfig>): Promise<void> {
        const proxies: HttpsProxies = (this.config as any).httpsProxies || {};
        if (!proxies[hostname]) {
            throw new Error(`HTTPS proxy for hostname '${hostname}' not found`);
        }
        (this.config as any).httpsProxies = {
            ...proxies,
            [hostname]: { ...proxies[hostname], ...proxy },
        };
        await this.saveConfig();
    }

    async deleteHttpsProxy(hostname: string): Promise<void> {
        const proxies: HttpsProxies = (this.config as any).httpsProxies || {};
        if (proxies[hostname]) {
            const { [hostname]: _removed, ...rest } = proxies;
            (this.config as any).httpsProxies = rest;
            await this.saveConfig();
        }
    }
}
