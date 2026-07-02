import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Box,
    Typography,
    Button,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    IconButton,
    Switch,
    Stack,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Tooltip,
    Chip,
    ToggleButton,
} from '@mui/material';
import {
    Add as AddIcon,
    PlayArrow as StartIcon,
    Stop as StopIcon,
    Refresh as RefreshIcon,
    Delete,
    Edit as EditIcon,
    ContentCopy as ContentCopyIcon,
    Clear as ClearIcon,
} from '@mui/icons-material';
import useStore from '../store/useStore';

const HttpsProxyPage: React.FC = () => {
    const { t } = useTranslation();
    const {
        httpsProxies,
        httpsProxyStatuses,
        loadHttpsProxies,
        createHttpsProxy,
        updateHttpsProxy,
        deleteHttpsProxy,
        startHttpsProxy,
        stopHttpsProxy,
        regenerateHttpsCert,
        showToast,
    } = useStore();

    const [open, setOpen] = useState(false);
    const [editingHost, setEditingHost] = useState<string | null>(null);
    const [hostname, setHostname] = useState('');
    const [forwardPort, setForwardPort] = useState('');
    const [listenPort, setListenPort] = useState('');
    const [autoStart, setAutoStart] = useState(false);

    // Logs
    const [logLines, setLogLines] = useState<number>(100);
    const [logs, setLogs] = useState<string[]>([]);
    const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
    const logContainerRef = useRef<HTMLDivElement | null>(null);

    const selectedHostname = useMemo(
        () => editingHost || Object.keys(httpsProxies || {})[0] || '',
        [editingHost, httpsProxies]
    );

    const refreshLogs = async () => {
        try {
            if (!selectedHostname) return;
            const arr = await window.electronAPI.httpsProxyAPI.readLogs(selectedHostname, logLines);
            setLogs(Array.isArray(arr) ? arr : []);
        } catch {
            setLogs([]);
        }
    };

    useEffect(() => {
        loadHttpsProxies();
        const id = setInterval(() => loadHttpsProxies(), 3000);
        return () => clearInterval(id);
    }, [loadHttpsProxies]);

    useEffect(() => {
        refreshLogs();
        let tId: any = null;
        if (autoRefresh) {
            tId = setInterval(refreshLogs, 2000);
        }
        return () => tId && clearInterval(tId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedHostname, logLines, autoRefresh]);

    useEffect(() => {
        const el = logContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [logs]);

    const rows = useMemo(() => {
        const list = httpsProxies || {};
        return Object.keys(list)
            .sort()
            .map(h => {
                const cfg = list[h];
                const st = (httpsProxyStatuses || []).find(s => s.hostname === h);
                return {
                    hostname: h,
                    forwardPort: cfg.forwardPort,
                    listenPort: cfg.listenPort,
                    autoStart: !!cfg.autoStart,
                    running: !!st?.running,
                };
            });
    }, [httpsProxies, httpsProxyStatuses]);

    const getStatusChip = (running: boolean) => (
        <Chip
            label={running ? t('common.running') : t('common.stopped')}
            color={running ? 'success' : 'default'}
            size='small'
        />
    );

    const resetDialog = () => {
        setEditingHost(null);
        setHostname('');
        setForwardPort('');
        setListenPort('');
        setAutoStart(false);
    };

    const openAdd = () => {
        resetDialog();
        setOpen(true);
    };

    const openEdit = (row: any) => {
        setEditingHost(row.hostname);
        setHostname(row.hostname);
        setForwardPort(String(row.forwardPort ?? ''));
        setListenPort(String(row.listenPort ?? ''));
        setAutoStart(!!row.autoStart);
        setOpen(true);
    };

    const handleSave = async () => {
        const fwd = parseInt(forwardPort, 10);
        const lst = parseInt(listenPort, 10);
        if (!hostname.trim()) return;
        if (!Number.isFinite(fwd) || fwd <= 0) return;
        if (!Number.isFinite(lst) || lst <= 0) return;
        const cfg = { forwardPort: fwd, listenPort: lst, autoStart };
        if (editingHost && editingHost !== hostname) {
            await deleteHttpsProxy(editingHost);
            await createHttpsProxy(hostname.trim(), cfg);
        } else if (editingHost) {
            await updateHttpsProxy(hostname.trim(), cfg);
        } else {
            await createHttpsProxy(hostname.trim(), cfg);
        }
        setOpen(false);
        resetDialog();
        showToast(t('common.success'));
    };

    const statusForEditing = useMemo(
        () => (editingHost ? (httpsProxyStatuses || []).find(s => s.hostname === editingHost) : undefined),
        [httpsProxyStatuses, editingHost]
    );

    const remainingDays = useMemo(() => {
        const iso = statusForEditing?.validTo;
        if (!iso) return null;
        const end = new Date(iso).getTime();
        const now = Date.now();
        const msPerDay = 24 * 60 * 60 * 1000;
        const diff = Math.ceil((end - now) / msPerDay);
        return diff < 0 ? 0 : diff;
    }, [statusForEditing]);

    const canSave = useMemo(() => {
        const fwd = parseInt(forwardPort, 10);
        const lst = parseInt(listenPort, 10);
        return Boolean(hostname.trim()) && Number.isFinite(fwd) && fwd > 0 && Number.isFinite(lst) && lst > 0;
    }, [hostname, forwardPort, listenPort]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant='h1'>{t('httpsProxy.title')}</Typography>
                <Button variant='contained' startIcon={<AddIcon />} onClick={openAdd}>
                    {t('httpsProxy.add')}
                </Button>
            </Box>

            <TableContainer component={Paper}>
                <Table size='small'>
                    <TableHead>
                        <TableRow>
                            <TableCell>{t('httpsProxy.host')}</TableCell>
                            <TableCell align='right'>{t('httpsProxy.httpPort')}</TableCell>
                            <TableCell align='right'>{t('httpsProxy.httpsPort')}</TableCell>
                            <TableCell>{t('common.status')}</TableCell>
                            <TableCell align='center'>{t('common.autoStart')}</TableCell>
                            <TableCell align='center'>{t('common.actions')}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(row => (
                            <TableRow key={row.hostname} hover>
                                <TableCell>
                                    <Typography
                                        variant='body1'
                                        noWrap
                                        sx={{
                                            maxWidth: '40ch',
                                            display: 'block',
                                            whiteSpace: 'nowrap',
                                            textOverflow: 'ellipsis',
                                            overflow: 'hidden',
                                        }}
                                        title={row.hostname}
                                    >
                                        {row.hostname}
                                    </Typography>
                                </TableCell>
                                <TableCell align='right'>{row.forwardPort}</TableCell>
                                <TableCell align='right'>{row.listenPort}</TableCell>
                                <TableCell>{getStatusChip(row.running)}</TableCell>
                                <TableCell align='center'>
                                    <Switch
                                        checked={row.autoStart}
                                        onChange={async e => {
                                            await updateHttpsProxy(row.hostname, { autoStart: e.target.checked });
                                            showToast(t('common.success'));
                                        }}
                                    />
                                </TableCell>
                                <TableCell align='center'>
                                    {row.running ? (
                                        <Tooltip title={t('common.stop')}>
                                            <IconButton size='small' onClick={() => stopHttpsProxy(row.hostname)}>
                                                <StopIcon />
                                            </IconButton>
                                        </Tooltip>
                                    ) : (
                                        <Tooltip title={t('common.start')}>
                                            <IconButton size='small' onClick={() => startHttpsProxy(row.hostname)}>
                                                <StartIcon />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    <Tooltip title={t('common.edit')}>
                                        <span>
                                            <IconButton
                                                size='small'
                                                onClick={() => openEdit(row)}
                                                disabled={row.running}
                                            >
                                                <EditIcon />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Tooltip title={t('common.delete')}>
                                        <IconButton size='small' onClick={() => deleteHttpsProxy(row.hostname)}>
                                            <Delete />
                                        </IconButton>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Logs panel */}
            <Paper sx={{ p: 2, mt: 3, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <Stack direction='row' spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
                    <Typography variant='h6' sx={{ mr: 1 }}>
                        {t('common.logs')}
                    </Typography>
                    <TextField
                        size='small'
                        type='number'
                        label={t('common.lines')}
                        value={logLines}
                        onChange={e => setLogLines(Math.max(10, parseInt(e.target.value) || 100))}
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
                    <IconButton onClick={refreshLogs} title={t('common.refresh')}>
                        <RefreshIcon />
                    </IconButton>
                    <IconButton
                        onClick={() => {
                            try {
                                navigator.clipboard.writeText(logs.join('\n'));
                                showToast(t('common.copied'));
                            } catch { /* ignore */ }
                        }}
                        title={t('common.copy')}
                    >
                        <ContentCopyIcon />
                    </IconButton>
                    <IconButton
                        color='error'
                        onClick={async () => {
                            if (!selectedHostname) return;
                            await window.electronAPI.httpsProxyAPI.clearLogs(selectedHostname);
                            await refreshLogs();
                        }}
                        title={t('common.clear')}
                    >
                        <ClearIcon />
                    </IconButton>
                </Stack>
                <Box
                    ref={logContainerRef}
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
                >
                    {logs.join('\n')}
                </Box>
            </Paper>

            <Dialog open={open} onClose={() => setOpen(false)} maxWidth='xs' fullWidth>
                <DialogTitle>{editingHost ? t('common.edit') : t('httpsProxy.add')}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label={t('httpsProxy.host')}
                            value={hostname}
                            onChange={e => setHostname(e.target.value)}
                            placeholder='example.local'
                            fullWidth
                        />
                        <TextField
                            label={t('httpsProxy.httpPort')}
                            type='number'
                            value={forwardPort}
                            onChange={e => setForwardPort(e.target.value)}
                            fullWidth
                            required
                        />
                        <TextField
                            label={t('httpsProxy.httpsPort')}
                            type='number'
                            value={listenPort}
                            onChange={e => setListenPort(e.target.value)}
                            fullWidth
                            required
                        />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Switch checked={autoStart} onChange={e => setAutoStart(e.target.checked)} />
                            <Typography>{t('common.autoStart')}</Typography>
                        </Box>
                        {statusForEditing ? (
                            <Box>
                                <Typography variant='caption' color='text.secondary'>
                                    {t('httpsProxy.certPaths')}
                                </Typography>
                                <Box sx={{ fontFamily: 'monospace', mt: 0.5 }}>
                                    <Typography variant='body2'>{statusForEditing.certPath}</Typography>
                                    <Typography variant='body2'>{statusForEditing.keyPath}</Typography>
                                </Box>
                                {statusForEditing.validTo ? (
                                    <Box sx={{ mt: 1 }}>
                                        <Typography variant='caption' color='text.secondary'>
                                            {t('httpsProxy.expiresAt')}
                                        </Typography>
                                        <Typography variant='body2'>
                                            {new Date(statusForEditing.validTo).toLocaleString()}
                                            {typeof remainingDays === 'number'
                                                ? `（${t('httpsProxy.remainingDays', { days: remainingDays })}）`
                                                : ''}
                                        </Typography>
                                    </Box>
                                ) : null}
                            </Box>
                        ) : null}
                        {editingHost ? (
                            <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                                <Button
                                    variant='outlined'
                                    startIcon={<RefreshIcon />}
                                    onClick={async () => {
                                        await regenerateHttpsCert(editingHost);
                                        showToast(t('common.success'));
                                    }}
                                >
                                    {t('httpsProxy.certRegen')}
                                </Button>
                            </Box>
                        ) : null}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
                    <Button variant='contained' onClick={handleSave} disabled={!canSave}>
                        {t('common.save')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default HttpsProxyPage;
