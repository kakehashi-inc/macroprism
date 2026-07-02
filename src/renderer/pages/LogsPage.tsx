import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Paper, Typography, ToggleButton, ToggleButtonGroup, TextField, IconButton } from '@mui/material';
import useStore from '../store/useStore';
import {
    Refresh as RefreshIcon,
    Clear as ClearIcon,
    ContentCopy as CopyIcon,
    ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';

const LogsPage: React.FC = () => {
    const { t } = useTranslation();
    const showToast = useStore(s => s.showToast);
    const { processId } = useParams();
    const navigate = useNavigate();
    const { processes } = useStore();

    const [selectedProcessId, setSelectedProcessId] = useState<string>(processId || '');
    const [logType, setLogType] = useState<'stdout' | 'stderr'>('stdout');
    const [logLines, setLogLines] = useState<string[]>([]);
    const [lineCount, setLineCount] = useState<number>(100);
    const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
    const logContainerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (processId) {
            setSelectedProcessId(processId);
        }
    }, [processId]);

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;

        if (selectedProcessId) {
            loadLogs();

            if (autoRefresh) {
                interval = setInterval(loadLogs, 2000);
            }
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [selectedProcessId, logType, lineCount, autoRefresh]);

    const loadLogs = async () => {
        if (!selectedProcessId) return;

        try {
            const logs = await window.electronAPI.logAPI.read(selectedProcessId, logType, lineCount);
            setLogLines(logs);
        } catch (error) {
            console.error('Failed to load logs:', error);
            setLogLines([]);
        }
    };

    // Scroll to bottom when logs change or target/process changes
    useEffect(() => {
        const el = logContainerRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [logLines, selectedProcessId, logType]);

    const handleClearLogs = async () => {
        if (!selectedProcessId) return;

        try {
            await window.electronAPI.logAPI.clear(selectedProcessId);
            setLogLines([]);
        } catch (error) {
            console.error('Failed to clear logs:', error);
        }
    };

    const handleCopyLogs = () => {
        const logsText = logLines.join('\n');
        try {
            navigator.clipboard.writeText(logsText);
        } catch { /* ignore */ }
        showToast(t('common.copied'));
    };

    const selectedServer = processes.find(s => s.id === selectedProcessId);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <IconButton onClick={() => navigate('/processes')} title={t('common.close')}>
                    <ArrowBackIcon />
                </IconButton>
                <Typography variant='h4' component='h1'>
                    {t('logs.title')}
                </Typography>
            </Box>

            <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
                {/* process selector removed per requirement; LogsPage opened from ProcessesPage */}

                <ToggleButtonGroup
                    value={logType}
                    exclusive
                    onChange={(_, value) => value && setLogType(value)}
                    size='small'
                >
                    <ToggleButton value='stdout'>{t('logs.stdout')}</ToggleButton>
                    <ToggleButton value='stderr'>{t('logs.stderr')}</ToggleButton>
                </ToggleButtonGroup>

                <TextField
                    label={t('common.lines')}
                    type='number'
                    value={lineCount}
                    onChange={e => setLineCount(parseInt(e.target.value) || 100)}
                    slotProps={{ htmlInput: { min: 10, max: 1000 } }}
                    sx={{ width: 120 }}
                    size='small'
                />
                <ToggleButton
                    value='auto'
                    selected={autoRefresh}
                    onChange={() => setAutoRefresh(!autoRefresh)}
                    size='small'
                >
                    {t('common.autoRefresh')}
                </ToggleButton>

                <Box sx={{ flexGrow: 1 }} />

                <IconButton onClick={loadLogs} title={t('common.refresh')}>
                    <RefreshIcon />
                </IconButton>

                <IconButton onClick={handleCopyLogs} title={t('common.copy')}>
                    <CopyIcon />
                </IconButton>

                <IconButton onClick={handleClearLogs} title={t('common.clear')} color='error'>
                    <ClearIcon />
                </IconButton>
            </Box>

            <Paper
                sx={{
                    p: 2,
                    bgcolor: 'grey.900',
                    flexGrow: 1,
                    minHeight: 0,
                    overflow: 'auto',
                }}
                ref={logContainerRef}
            >
                {selectedServer ? (
                    logLines.length > 0 ? (
                        <Box
                            component='pre'
                            sx={{
                                m: 0,
                                fontFamily: 'monospace',
                                fontSize: '0.875rem',
                                color: logType === 'stderr' ? 'error.main' : 'grey.100',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                            }}
                        >
                            {logLines.join('\n')}
                        </Box>
                    ) : (
                        <Typography variant='body2' sx={{ color: 'grey.500' }}>
                            {t('logs.noLogs')}
                        </Typography>
                    )
                ) : (
                    <Typography variant='body2' sx={{ color: 'grey.500' }}>
                        Select a process to view logs
                    </Typography>
                )}
            </Paper>
        </Box>
    );
};

export default LogsPage;
