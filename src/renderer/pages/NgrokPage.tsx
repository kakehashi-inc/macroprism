import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useStore from '../store/useStore';
import {
    Box,
    Button,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
    Stack,
    TextField,
    Alert,
    IconButton,
    ToggleButton,
} from '@mui/material';
import { ContentCopy as ContentCopyIcon, Refresh as RefreshIcon, Clear as ClearIcon } from '@mui/icons-material';

interface TunnelInfo {
    port: number;
    url?: string;
    name: string;
}

const NgrokPage: React.FC = () => {
    const { t } = useTranslation();
    const showToast = useStore(s => s.showToast);
    const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const [lines, setLines] = useState<number>(100);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<boolean>(false);
    const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
    const logContainerRef = useRef<HTMLDivElement | null>(null);

    const handleCopy = (text: string) => {
        if (!text) return;
        try {
            navigator.clipboard.writeText(text);
        } catch {
            //
        }
        showToast(t('common.copied'));
    };

    const refresh = async () => {
        try {
            const status = await window.electronAPI.ngrokAPI.status();
            setTunnels(Array.isArray(status) ? status : []);
        } catch (e: any) {
            setError(e?.message || String(e));
            setTunnels([]);
        }
        try {
            const latest = await window.electronAPI.ngrokAPI.readLogs(lines);
            setLogs(Array.isArray(latest) ? latest : []);
        } catch (e: any) {
            setError(e?.message || String(e));
            setLogs([]);
        }
    };

    // Scroll to bottom when logs change
    useEffect(() => {
        const el = logContainerRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        refresh();
        let timer: NodeJS.Timeout | null = null;
        if (autoRefresh) {
            timer = setInterval(refresh, 2000);
        }
        return () => {
            if (timer) clearInterval(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lines, autoRefresh]);

    const handleStart = async () => {
        setBusy(true);
        setError(null);
        try {
            await window.electronAPI.ngrokAPI.start();
            await refresh();
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setBusy(false);
        }
    };

    const handleStop = async () => {
        setBusy(true);
        setError(null);
        try {
            await window.electronAPI.ngrokAPI.stop();
            await refresh();
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Stack direction='row' sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant='h4'>{t('ngrok.title')}</Typography>
                <Stack direction='row' spacing={1}>
                    <Button variant='contained' onClick={handleStart} disabled={busy || tunnels.length > 0}>
                        {t('common.start')}
                    </Button>
                    <Button variant='outlined' onClick={handleStop} disabled={busy || tunnels.length === 0}>
                        {t('common.stop')}
                    </Button>
                </Stack>
            </Stack>

            {error && (
                <Alert severity='error' sx={{ mb: 2 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            <Paper sx={{ p: 2, mb: 3, flexShrink: 0 }}>
                <Stack direction='row' sx={{ mb: 1, justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant='h6'>{t('common.status')}</Typography>
                    <Typography variant='body2' color='text.secondary'>
                        {tunnels.length > 0 ? t('common.running') : t('common.stopped')}
                    </Typography>
                </Stack>
                <TableContainer>
                    <Table size='small'>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ width: '8ch', whiteSpace: 'nowrap' }}>{t('ngrok.ports')}</TableCell>
                                <TableCell>{t('ngrok.url')}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {tunnels.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={2}>{t('ngrok.noTunnels')}</TableCell>
                                </TableRow>
                            ) : (
                                tunnels.map(t => {
                                    const urlText = typeof t.url === 'string' ? t.url : '';
                                    return (
                                        <TableRow key={t.port}>
                                            <TableCell sx={{ width: '8ch', whiteSpace: 'nowrap' }}>{t.port}</TableCell>
                                            <TableCell>
                                                {urlText ? (
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <IconButton size='small' onClick={() => handleCopy(urlText)}>
                                                            <ContentCopyIcon fontSize='inherit' />
                                                        </IconButton>
                                                        <Typography
                                                            variant='body2'
                                                            sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                                                        >
                                                            {urlText}
                                                        </Typography>
                                                    </Box>
                                                ) : (
                                                    '-'
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            <Paper sx={{ p: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <Stack direction='row' spacing={1} sx={{ mb: 1, flexShrink: 0, alignItems: 'center' }}>
                    <Typography variant='h6' sx={{ mr: 1 }}>
                        {t('common.logs')}
                    </Typography>
                    <TextField
                        size='small'
                        type='number'
                        label={t('common.lines')}
                        value={lines}
                        onChange={e => setLines(Math.max(10, parseInt(e.target.value) || 100))}
                        sx={{ width: 140 }}
                    />
                    <ToggleButton
                        value='auto'
                        selected={autoRefresh}
                        onChange={() => setAutoRefresh(v => !v)}
                        size='small'
                    >
                        {t('common.autoRefresh')}
                    </ToggleButton>
                    <Box sx={{ flexGrow: 1 }} />
                    <IconButton onClick={refresh} title={t('common.refresh')} disabled={busy}>
                        <RefreshIcon />
                    </IconButton>
                    <IconButton
                        onClick={() => {
                            try {
                                navigator.clipboard.writeText(logs.join('\n'));
                            } catch { /* ignore */ }
                            showToast(t('common.copied'));
                        }}
                        title={t('common.copy')}
                    >
                        <ContentCopyIcon />
                    </IconButton>
                    <IconButton
                        color='error'
                        onClick={async () => {
                            await window.electronAPI.ngrokAPI.clearLogs();
                            await refresh();
                        }}
                        title={t('common.clear')}
                    >
                        <ClearIcon />
                    </IconButton>
                </Stack>
                <Box
                    sx={{
                        bgcolor: theme => theme.palette.grey[900],
                        color: theme => theme.palette.common.white,
                        fontFamily: 'monospace',
                        p: 1,
                        borderRadius: 1,
                        flex: 1,
                        minHeight: 0,
                        overflow: 'auto',
                        whiteSpace: 'pre',
                    }}
                    ref={logContainerRef}
                >
                    {logs.join('\n')}
                </Box>
            </Paper>
        </Box>
    );
};

export default NgrokPage;
