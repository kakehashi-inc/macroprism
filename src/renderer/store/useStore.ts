import { create } from 'zustand';
import {
    ProcessConfig,
    ProcessStatus,
    AppSettings,
    WSLDistribution,
    AppConfig,
    HttpsProxyStatus,
} from '../../shared/types';

interface ProcessWithId {
    id: string;
    config: ProcessConfig;
}

interface AppState {
    // Config
    config: AppConfig | null;

    // Processes
    processes: ProcessWithId[];
    processStatuses: Map<string, ProcessStatus>;
    selectedServerId: string | null;

    // WSL
    wslAvailable: boolean;
    wslDistributions: WSLDistribution[];

    // UI State
    loading: boolean;
    error: string | null;
    snackbar: { open: boolean; message: string } | null;

    // HTTPS Proxies
    httpsProxies: Record<string, any>;
    httpsProxyStatuses: HttpsProxyStatus[];

    // Actions
    setConfig: (config: AppConfig) => void;
    setProcesses: (processes: ProcessWithId[]) => void;
    addProcess: (id: string, config: ProcessConfig) => void;
    updateProcess: (id: string, config: ProcessConfig) => void;
    removeProcess: (id: string) => void;
    setProcessStatus: (id: string, status: ProcessStatus) => void;
    setSelectedServerId: (id: string | null) => void;

    setSettings: (settings: AppSettings) => void;
    updateSettings: (settings: Partial<AppSettings>) => Promise<void>;

    setWSLAvailable: (available: boolean) => void;
    setWSLDistributions: (distributions: WSLDistribution[]) => void;

    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    showToast: (message: string) => void;
    closeToast: () => void;

    // Initialize
    initialize: () => Promise<void>;

    // HTTPS Proxies actions
    loadHttpsProxies: () => Promise<void>;
    createHttpsProxy: (hostname: string, cfg: any) => Promise<void>;
    updateHttpsProxy: (hostname: string, cfg: any) => Promise<void>;
    deleteHttpsProxy: (hostname: string) => Promise<void>;
    startHttpsProxy: (hostname: string) => Promise<void>;
    stopHttpsProxy: (hostname: string) => Promise<void>;
    regenerateHttpsCert: (hostname: string) => Promise<void>;
}

const useStore = create<AppState>((set, get) => ({
    // Initial state
    config: null,
    processes: [],
    processStatuses: new Map(),
    selectedServerId: null,
    wslAvailable: false,
    wslDistributions: [],
    loading: false,
    error: null,
    snackbar: null,
    httpsProxies: {},
    httpsProxyStatuses: [],

    // Config actions
    setConfig: config => {
        const processes = Object.entries(config.processes).map(([id, serverConfig]) => ({
            id,
            config: serverConfig,
        }));
        set({ config, processes });
    },

    // Server actions
    setProcesses: processes => set({ processes }),

    addProcess: async (id, config) => {
        if (!window.electronAPI?.processAPI) return;
        await window.electronAPI.processAPI.create(id, config);
        const newConfig = await window.electronAPI.configAPI.get();
        get().setConfig(newConfig);
    },

    updateProcess: async (id, config) => {
        if (!window.electronAPI?.processAPI) return;
        await window.electronAPI.processAPI.update(id, config);
        const newConfig = await window.electronAPI.configAPI.get();
        get().setConfig(newConfig);
    },

    removeProcess: async id => {
        if (!window.electronAPI?.processAPI) return;
        await window.electronAPI.processAPI.delete(id);
        const newConfig = await window.electronAPI.configAPI.get();
        get().setConfig(newConfig);
        set(state => ({
            selectedServerId: state.selectedServerId === id ? null : state.selectedServerId,
        }));
    },

    setProcessStatus: (id, status) =>
        set(state => {
            const newStatuses = new Map(state.processStatuses);
            newStatuses.set(id, status);
            return { processStatuses: newStatuses };
        }),

    setSelectedServerId: id => set({ selectedServerId: id }),

    // Settings actions
    setSettings: settings =>
        set(state => ({
            config: state.config ? { ...state.config, settings } : null,
        })),

    updateSettings: async newSettings => {
        if (!window.electronAPI?.settingsAPI) return;
        const settings = await window.electronAPI.settingsAPI.update(newSettings);
        set(state => ({
            config: state.config ? { ...state.config, settings } : null,
        }));
    },

    // WSL actions
    setWSLAvailable: available => set({ wslAvailable: available }),
    setWSLDistributions: distributions => set({ wslDistributions: distributions }),

    // UI actions
    setLoading: loading => set({ loading }),
    setError: error => set({ error }),
    showToast: message => set({ snackbar: { open: true, message } }),
    closeToast: () => set({ snackbar: null }),

    // Initialize
    initialize: async () => {
        try {
            set({ loading: true, error: null });

            if (!window.electronAPI) {
                throw new Error('preload failed: window.electronAPI is undefined');
            }

            // Load config
            const config = await window.electronAPI.configAPI.get();
            get().setConfig(config);

            // Load process statuses
            const processes = await window.electronAPI.processAPI.list();
            const statusMap = new Map<string, ProcessStatus>();

            for (const process of processes) {
                const status = await window.electronAPI.processAPI.getStatus(process.id);
                if (status) {
                    statusMap.set(process.id, status);
                }
            }
            set({ processStatuses: statusMap });

            // Check WSL
            const wslAvailable = await window.electronAPI.wslAPI.check();
            set({ wslAvailable });

            if (wslAvailable) {
                const distributions = await window.electronAPI.wslAPI.listDistributions();
                set({ wslDistributions: distributions });
            }

            // Set up status update listener
            window.electronAPI.processAPI.onStatusUpdate((id, status) => {
                get().setProcessStatus(id, status);
            });

            // Load https proxies
            await get().loadHttpsProxies();

            set({ loading: false });
        } catch (error) {
            console.error('Failed to initialize:', error);
            set({
                loading: false,
                error: error instanceof Error ? error.message : 'Failed to initialize',
            });
        }
    },

    // HTTPS Proxies actions
    loadHttpsProxies: async () => {
        if (!window.electronAPI?.httpsProxyAPI) return;
        const list = await window.electronAPI.httpsProxyAPI.list();
        const statuses = await window.electronAPI.httpsProxyAPI.status();
        set({ httpsProxies: list || {}, httpsProxyStatuses: statuses || [] });
    },
    createHttpsProxy: async (hostname, cfg) => {
        await window.electronAPI.httpsProxyAPI.create(hostname, cfg);
        await get().loadHttpsProxies();
    },
    updateHttpsProxy: async (hostname, cfg) => {
        await window.electronAPI.httpsProxyAPI.update(hostname, cfg);
        await get().loadHttpsProxies();
    },
    deleteHttpsProxy: async hostname => {
        await window.electronAPI.httpsProxyAPI.remove(hostname);
        await get().loadHttpsProxies();
    },
    startHttpsProxy: async hostname => {
        await window.electronAPI.httpsProxyAPI.start(hostname);
        await get().loadHttpsProxies();
    },
    stopHttpsProxy: async hostname => {
        await window.electronAPI.httpsProxyAPI.stop(hostname);
        await get().loadHttpsProxies();
    },
    regenerateHttpsCert: async hostname => {
        await window.electronAPI.httpsProxyAPI.regenerateCert(hostname);
        await get().loadHttpsProxies();
    },
}));

export default useStore;
