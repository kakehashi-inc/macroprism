import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Button,
    FormControl,
    FormControlLabel,
    InputLabel,
    Select,
    MenuItem,
    Switch,
    Box,
    Alert,
} from '@mui/material';
import useStore from '../store/useStore';
import { ProcessConfig } from '../../shared/types';

interface ProcessDialogProps {
    open: boolean;
    onClose: () => void;
    server: { id: string; config: ProcessConfig } | null;
}

const ProcessDialog: React.FC<ProcessDialogProps> = ({ open, onClose, server }) => {
    const { t } = useTranslation();
    const { wslAvailable, wslDistributions, processes, addProcess, updateProcess } = useStore();

    const [formData, setFormData] = useState({
        id: '',
        displayName: '',
        command: '',
        args: '',
        env: '',
        platform: 'host' as 'host' | 'wsl',
        wslDistribution: '',
        autoStart: false,
        autoRestartOnError: false,
        useAuthProxy: false,
        authProxyListenPort: '',
        authProxyExternalUrl: '',
    });

    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        if (server) {
            setFormData({
                id: server.id,
                displayName: server.config.displayName || '',
                command: server.config.command,
                args: server.config.args.join('\n'),
                env: Object.entries(server.config.env || {})
                    .map(([key, value]) => `${key}:${value}`)
                    .join('\n'),
                platform: server.config.platform || 'host',
                wslDistribution: server.config.wslDistribution || '',
                autoStart: server.config.autoStart || false,
                autoRestartOnError: server.config.autoRestartOnError || false,
                useAuthProxy: !!server.config.useAuthProxy,
                authProxyListenPort: server.config.authProxyListenPort?.toString() || '',
                authProxyExternalUrl: server.config.authProxyExternalUrl || '',
            });
        } else {
            setFormData({
                id: '',
                displayName: '',
                command: '',
                args: '',
                env: '',
                platform: 'host',
                wslDistribution: wslDistributions[0]?.name || '',
                autoStart: false,
                autoRestartOnError: false,
                useAuthProxy: false,
                authProxyListenPort: '',
                authProxyExternalUrl: '',
            });
        }
        setError(null);
    }, [open, server, wslDistributions]);

    const handleSubmit = async () => {
        const args = formData.args
            .replace(/\r/g, '')
            .split('\n')
            .map(arg => arg.trim())
            .filter(arg => arg.length > 0);

        const env: Record<string, string> = {};
        formData.env.split('\n').forEach(line => {
            const [key, value] = line.split(':');
            if (key && value) {
                env[key.trim()] = value.trim();
            }
        });

        const serverConfig: ProcessConfig = {
            command: formData.command,
            args,
            env: Object.keys(env).length > 0 ? env : undefined,
            displayName: formData.displayName || undefined,
            platform: formData.platform,
            wslDistribution: formData.platform === 'wsl' ? formData.wslDistribution : undefined,
            autoStart: formData.autoStart,
            autoRestartOnError: formData.autoRestartOnError,
            useAuthProxy: formData.useAuthProxy || undefined,
            authProxyListenPort: formData.authProxyListenPort
                ? Math.max(1, parseInt(formData.authProxyListenPort))
                : undefined,
            authProxyExternalUrl: formData.authProxyExternalUrl || undefined,
        };

        try {
            if (serverConfig.useAuthProxy) {
                if (!serverConfig.authProxyListenPort || !serverConfig.authProxyExternalUrl) {
                    setError(t('process.dialog.authProxyMissingFields'));
                    return;
                }
            }
            if (server) {
                // Update existing server
                await updateProcess(server.id, serverConfig);
            } else {
                // Check if ID already exists
                if (processes.some(s => s.id === formData.id)) {
                    setError(t('process.dialog.idExists'));
                    return;
                }
                // Create new server
                await addProcess(formData.id, serverConfig);
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
            <DialogTitle>{server ? t('process.dialog.editTitle') : t('process.dialog.addTitle')}</DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                    {error && (
                        <Alert severity='error' onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}

                    <TextField
                        label={t('process.fields.name') + ' (ID)'}
                        value={formData.id}
                        onChange={e => setFormData({ ...formData, id: e.target.value })}
                        fullWidth
                        required
                        disabled={!!server}
                        helperText={!server && 'Unique identifier for the process (e.g., "web-app")'}
                    />

                    <TextField
                        label={t('process.fields.displayName')}
                        value={formData.displayName}
                        onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                        fullWidth
                        helperText={t('process.dialog.displayNameTip')}
                    />

                    <TextField
                        label={t('process.fields.command')}
                        value={formData.command}
                        onChange={e => setFormData({ ...formData, command: e.target.value })}
                        fullWidth
                        required
                        helperText='e.g., "npx", "node", "python"'
                    />

                    <TextField
                        label={t('process.fields.args')}
                        value={formData.args}
                        onChange={e => setFormData({ ...formData, args: e.target.value })}
                        multiline
                        rows={3}
                        fullWidth
                        helperText={t('process.dialog.argsTip')}
                    />

                    <TextField
                        label={t('process.fields.env')}
                        value={formData.env}
                        onChange={e => setFormData({ ...formData, env: e.target.value })}
                        multiline
                        rows={3}
                        fullWidth
                        helperText={t('process.dialog.envTip')}
                    />

                    <FormControl fullWidth>
                        <InputLabel>{t('process.fields.platform')}</InputLabel>
                        <Select
                            value={formData.platform}
                            onChange={e => setFormData({ ...formData, platform: e.target.value as 'host' | 'wsl' })}
                            label={t('process.fields.platform')}
                        >
                            <MenuItem value='host'>{t('process.platform.host')}</MenuItem>
                            {wslAvailable && <MenuItem value='wsl'>WSL</MenuItem>}
                        </Select>
                    </FormControl>

                    {formData.platform === 'wsl' && wslDistributions.length > 0 && (
                        <FormControl fullWidth>
                            <InputLabel>{t('process.fields.wslDistribution')}</InputLabel>
                            <Select
                                value={formData.wslDistribution}
                                onChange={e => setFormData({ ...formData, wslDistribution: e.target.value })}
                                label={t('process.fields.wslDistribution')}
                            >
                                {wslDistributions.map(dist => (
                                    <MenuItem key={dist.name} value={dist.name}>
                                        {dist.name} {dist.isDefault && '(Default)'}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}

                    <FormControlLabel
                        control={
                            <Switch
                                checked={formData.autoStart}
                                onChange={e => setFormData({ ...formData, autoStart: e.target.checked })}
                            />
                        }
                        label={t('process.fields.autoStart')}
                    />

                    <FormControlLabel
                        control={
                            <Switch
                                checked={formData.autoRestartOnError}
                                onChange={e => setFormData({ ...formData, autoRestartOnError: e.target.checked })}
                            />
                        }
                        label={t('process.fields.autoRestartOnError')}
                    />

                    <Box sx={{ mt: 1, p: 1, border: theme => `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={formData.useAuthProxy}
                                    onChange={e => setFormData({ ...formData, useAuthProxy: e.target.checked })}
                                />
                            }
                            label={t('process.fields.useAuthProxy')}
                        />
                        <Alert severity='info' sx={{ my: 1 }}>
                            {t('process.dialog.authProxyNote')}
                        </Alert>

                        <TextField
                            label={t('process.fields.authProxyListenPort')}
                            type='number'
                            value={formData.authProxyListenPort}
                            onChange={e => setFormData({ ...formData, authProxyListenPort: e.target.value })}
                            fullWidth
                            disabled={!formData.useAuthProxy}
                        />
                        <TextField
                            label={t('process.fields.authProxyExternalUrl')}
                            value={formData.authProxyExternalUrl}
                            onChange={e => setFormData({ ...formData, authProxyExternalUrl: e.target.value })}
                            fullWidth
                            disabled={!formData.useAuthProxy}
                        />
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('common.cancel')}</Button>
                <Button onClick={handleSubmit} variant='contained' disabled={!formData.id || !formData.command}>
                    {t('common.save')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ProcessDialog;
