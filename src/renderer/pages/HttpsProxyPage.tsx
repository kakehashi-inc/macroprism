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
    Divider,
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

interface MappingInput {
    from: string;
    to: string;
}

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
    const [editingName, setEditingName] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [hostnames, setHostnames] = useState<string[]>(['']);
    const [mappings, setMappings] = useState<MappingInput[]>([{ from: '', to: '' }]);
    const [autoStart, setAutoStart] = useState(false);

    // Logs
    const [logLines, setLogLines] = useState<number>(100);
    const [logs, setLogs] = useState<string[]>([]);
    const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
    const logContainerRef = useRef<HTMLDivElement | null>(null);

    const selectedName = useMemo(
        () => editingName || Object.keys(httpsProxies || {})[0] || '',
        [editingName, httpsProxies]
    );

    const refreshLogs = async () => {
        try {
            if (!selectedName) return;
            const arr = await window.electronAPI.httpsProxyAPI.readLogs(selectedName, logLines);
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
    }, [selectedName, logLines, autoRefresh]);

    useEffect(() => {
        const el = logContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [logs]);

    const rows = useMemo(() => {
        const list = httpsProxies || {};
        return Object.keys(list)
            .sort()
            .map(n => {
                const cfg = list[n] || {};
                const st = (httpsProxyStatuses || []).find(s => s.name === n);
                return {
                    name: n,
                    hostnames: Array.isArray(cfg.hostnames) ? cfg.hostnames : [],
                    portMappings: Array.isArray(cfg.portMappings) ? cfg.portMappings : [],
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
        setEditingName(null);
        setName('');
        setHostnames(['']);
        setMappings([{ from: '', to: '' }]);
        setAutoStart(false);
    };

    const openAdd = () => {
        resetDialog();
        setOpen(true);
    };

    const openEdit = (row: any) => {
        setEditingName(row.name);
        setName(row.name);
        setHostnames(row.hostnames.length ? [...row.hostnames] : ['']);
        setMappings(
            row.portMappings.length
                ? row.portMappings.map((m: any) => ({ from: String(m.from ?? ''), to: String(m.to ?? '') }))
                : [{ from: '', to: '' }]
        );
        setAutoStart(!!row.autoStart);
        setOpen(true);
    };

    // Hostname list editing
    const setHostnameAt = (i: number, v: string) =>
        setHostnames(prev => prev.map((h, idx) => (idx === i ? v : h)));
    const addHostname = () => setHostnames(prev => [...prev, '']);
    const removeHostname = (i: number) =>
        setHostnames(prev => (prev.length <= 1 ? [''] : prev.filter((_, idx) => idx !== i)));

    // Mapping list editing
    const setMappingAt = (i: number, key: keyof MappingInput, v: string) =>
        setMappings(prev => prev.map((m, idx) => (idx === i ? { ...m, [key]: v } : m)));
    const addMapping = () => setMappings(prev => [...prev, { from: '', to: '' }]);
    const removeMapping = (i: number) =>
        setMappings(prev => (prev.length <= 1 ? [{ from: '', to: '' }] : prev.filter((_, idx) => idx !== i)));

    const cleanHostnames = useMemo(() => hostnames.map(h => h.trim()).filter(Boolean), [hostnames]);
    const cleanMappings = useMemo(
        () =>
            mappings
                .map(m => ({ from: parseInt(m.from, 10), to: parseInt(m.to, 10) }))
                .filter(m => Number.isFinite(m.from) && m.from > 0 && Number.isFinite(m.to) && m.to > 0),
        [mappings]
    );

    const canSave = useMemo(
        () => Boolean(name.trim()) && cleanHostnames.length > 0 && cleanMappings.length > 0,
        [name, cleanHostnames, cleanMappings]
    );

    const handleSave = async () => {
        if (!canSave) return;
        const cfg = { hostnames: cleanHostnames, portMappings: cleanMappings, autoStart };
        const newName = name.trim();
        if (editingName && editingName !== newName) {
            await deleteHttpsProxy(editingName);
            await createHttpsProxy(newName, cfg);
        } else if (editingName) {
            await updateHttpsProxy(newName, cfg);
        } else {
            await createHttpsProxy(newName, cfg);
        }
        setOpen(false);
        resetDialog();
        showToast(t('common.success'));
    };

    const statusForEditing = useMemo(
        () => (editingName ? (httpsProxyStatuses || []).find(s => s.name === editingName) : undefined),
        [httpsProxyStatuses, editingName]
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
                            <TableCell>{t('httpsProxy.name')}</TableCell>
                            <TableCell>{t('httpsProxy.hostnames')}</TableCell>
                            <TableCell>{t('httpsProxy.portMappings')}</TableCell>
                            <TableCell>{t('common.status')}</TableCell>
                            <TableCell align='center'>{t('common.autoStart')}</TableCell>
                            <TableCell align='center'>{t('common.actions')}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(row => (
                            <TableRow key={row.name} hover>
                                <TableCell>
                                    <Typography
                                        variant='body1'
                                        noWrap
                                        sx={{ maxWidth: '24ch', textOverflow: 'ellipsis', overflow: 'hidden' }}
                                        title={row.name}
                                    >
                                        {row.name}
                                    </Typography>
                                </TableCell>
                                <TableCell>
                                    <Stack direction='row' spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                                        {row.hostnames.map((h: string) => (
                                            <Chip key={h} label={h} size='small' variant='outlined' />
                                        ))}
                                    </Stack>
                                </TableCell>
                                <TableCell>
                                    <Stack direction='row' spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                                        {row.portMappings.map((m: any, idx: number) => (
                                            <Chip
                                                key={`${m.from}-${m.to}-${idx}`}
                                                label={`${m.from} → ${m.to}`}
                                                size='small'
                                            />
                                        ))}
                                    </Stack>
                                </TableCell>
                                <TableCell>{getStatusChip(row.running)}</TableCell>
                                <TableCell align='center'>
                                    <Switch
                                        checked={row.autoStart}
                                        onChange={async e => {
                                            await updateHttpsProxy(row.name, { autoStart: e.target.checked });
                                            showToast(t('common.success'));
                                        }}
                                    />
                                </TableCell>
                                <TableCell align='center'>
                                    {row.running ? (
                                        <Tooltip title={t('common.stop')}>
                                            <IconButton size='small' onClick={() => stopHttpsProxy(row.name)}>
                                                <StopIcon />
                                            </IconButton>
                                        </Tooltip>
                                    ) : (
                                        <Tooltip title={t('common.start')}>
                                            <IconButton size='small' onClick={() => startHttpsProxy(row.name)}>
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
                                        <IconButton size='small' onClick={() => deleteHttpsProxy(row.name)}>
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
                            if (!selectedName) return;
                            await window.electronAPI.httpsProxyAPI.clearLogs(selectedName);
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

            <Dialog open={open} onClose={() => setOpen(false)} maxWidth='sm' fullWidth>
                <DialogTitle>{editingName ? t('common.edit') : t('httpsProxy.add')}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label={t('httpsProxy.name')}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder='my-proxy'
                            fullWidth
                            required
                        />

                        {/* Hostnames */}
                        <Box>
                            <Stack direction='row' sx={{ alignItems: 'center', mb: 0.5 }}>
                                <Typography variant='subtitle2'>{t('httpsProxy.hostnames')}</Typography>
                                <Box sx={{ flexGrow: 1 }} />
                                <Button size='small' startIcon={<AddIcon />} onClick={addHostname}>
                                    {t('httpsProxy.addHostname')}
                                </Button>
                            </Stack>
                            <Stack spacing={1}>
                                {hostnames.map((h, i) => (
                                    <Stack key={i} direction='row' spacing={1} sx={{ alignItems: 'center' }}>
                                        <TextField
                                            size='small'
                                            value={h}
                                            onChange={e => setHostnameAt(i, e.target.value)}
                                            placeholder='localhost / *.example.local'
                                            fullWidth
                                        />
                                        <IconButton size='small' onClick={() => removeHostname(i)}>
                                            <Delete fontSize='small' />
                                        </IconButton>
                                    </Stack>
                                ))}
                            </Stack>
                            <Typography variant='caption' color='text.secondary'>
                                {t('httpsProxy.hostnamesHint')}
                            </Typography>
                        </Box>

                        <Divider />

                        {/* Port mappings */}
                        <Box>
                            <Stack direction='row' sx={{ alignItems: 'center', mb: 0.5 }}>
                                <Typography variant='subtitle2'>{t('httpsProxy.portMappings')}</Typography>
                                <Box sx={{ flexGrow: 1 }} />
                                <Button size='small' startIcon={<AddIcon />} onClick={addMapping}>
                                    {t('httpsProxy.addMapping')}
                                </Button>
                            </Stack>
                            <Stack spacing={1}>
                                {mappings.map((m, i) => (
                                    <Stack key={i} direction='row' spacing={1} sx={{ alignItems: 'center' }}>
                                        <TextField
                                            size='small'
                                            type='number'
                                            label={t('httpsProxy.httpPort')}
                                            value={m.from}
                                            onChange={e => setMappingAt(i, 'from', e.target.value)}
                                            fullWidth
                                        />
                                        <TextField
                                            size='small'
                                            type='number'
                                            label={t('httpsProxy.httpsPort')}
                                            value={m.to}
                                            onChange={e => setMappingAt(i, 'to', e.target.value)}
                                            fullWidth
                                        />
                                        <IconButton size='small' onClick={() => removeMapping(i)}>
                                            <Delete fontSize='small' />
                                        </IconButton>
                                    </Stack>
                                ))}
                            </Stack>
                        </Box>

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

                        {editingName ? (
                            <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                                <Button
                                    variant='outlined'
                                    startIcon={<RefreshIcon />}
                                    onClick={async () => {
                                        await regenerateHttpsCert(editingName);
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
