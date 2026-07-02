import { AppConfig } from './types';
import * as path from 'path';
import * as os from 'os';

// Default Configuration
export const DEFAULT_CONFIG: AppConfig = {
    processes: {},
    settings: {
        language: 'ja',
        darkMode: false,
        logDirectory: path.join(os.homedir(), '.mcpm', 'logs'),
        logRetentionDays: 7,
        restartDelayMs: 5000,
        successfulStartThresholdMs: 10000,
        showWindowOnStartup: true,
        ngrokAuthToken: '',
        ngrokMetadataName: 'MacroPrism',
        ngrokPorts: '',
        ngrokAutoStart: false,
        // OIDC defaults for mcp-auth-proxy
        oidcProviderName: 'Auth0',
        oidcConfigurationUrl: '',
        oidcClientId: '',
        oidcClientSecret: '',
        oidcAllowedUsers: '',
        oidcAllowedUsersGlob: '',
    },
};

// App Constants
export const APP_NAME = 'MacroPrism';
export const APP_VERSION = '1.0.0';

// Process Check Interval (ms)
export const PROCESS_CHECK_INTERVAL = 5000;

// Log Rotation Interval (ms)
export const LOG_ROTATION_INTERVAL = 3600000; // 1 hour

// File Paths
export const getAppDataPath = () => {
    // All settings are stored in ~/.mcpm directory
    return path.join(os.homedir(), '.mcpm');
};

export const getConfigPath = () => {
    return path.join(getAppDataPath(), 'config.json');
};

// Certificates directory: ~/.mcpm/certs
export const getCertsPath = () => {
    return path.join(getAppDataPath(), 'certs');
};
