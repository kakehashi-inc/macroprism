import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    IconButton,
    Chip,
    Switch,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    Add as AddIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    PlayArrow as StartIcon,
    Stop as StopIcon,
    Description as LogIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import ProcessDialog from '../components/ProcessDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import { ProcessConfig } from '../../shared/types';

interface ServerEdit {
    id: string;
    config: ProcessConfig;
}

const ProcessesPage: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { processes, processStatuses, loading, updateProcess, removeProcess } = useStore();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [selectedServer, setSelectedServer] = useState<ServerEdit | null>(null);
    const [serverToDelete, setServerToDelete] = useState<string | null>(null);

    const handleAdd = () => {
        setSelectedServer(null);
        setDialogOpen(true);
    };

    const handleEdit = (server: { id: string; config: ProcessConfig }) => {
        setSelectedServer(server);
        setDialogOpen(true);
    };

    const handleDelete = (serverId: string) => {
        setServerToDelete(serverId);
        setDeleteDialogOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (serverToDelete) {
            await removeProcess(serverToDelete);
            setDeleteDialogOpen(false);
            setServerToDelete(null);
        }
    };

    const handleStart = async (serverId: string) => {
        await window.electronAPI.processAPI.start(serverId);
    };

    const handleStop = async (serverId: string) => {
        await window.electronAPI.processAPI.stop(serverId);
    };

    const handleAutoStartToggle = async (server: { id: string; config: ProcessConfig }) => {
        await updateProcess(server.id, {
            ...server.config,
            autoStart: !server.config.autoStart,
        });
    };

    const handleViewLogs = (serverId: string) => {
        navigate(`/logs/${serverId}`);
    };

    const getStatusChip = (serverId: string) => {
        const status = processStatuses.get(serverId);
        if (!status) {
            return <Chip label={t('common.stopped')} color='default' size='small' />;
        }

        const colorMap = {
            running: 'success' as const,
            stopped: 'default' as const,
            error: 'error' as const,
        };

        const labelKey = status.status === 'error' ? 'common.error' : `common.${status.status}`;
        return <Chip label={t(labelKey)} color={colorMap[status.status]} size='small' />;
    };

    const getDisplayName = (server: { id: string; config: ProcessConfig }) => {
        if (server.config.displayName) {
            return (
                <Box>
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
                    >
                        {server.config.displayName}
                    </Typography>
                    <Typography
                        variant='caption'
                        color='text.secondary'
                        noWrap
                        sx={{
                            maxWidth: '40ch',
                            display: 'block',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                        }}
                    >
                        {server.id}
                    </Typography>
                </Box>
            );
        }
        return (
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
            >
                {server.id}
            </Typography>
        );
    };

    if (loading) {
        return (
            <Box sx={{ p: 3 }}>
                <Typography>Loading...</Typography>
            </Box>
        );
    }

    return (
        <Box>
            <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant='h4' component='h1'>
                    {t('process.title')}
                </Typography>
                <Button variant='contained' startIcon={<AddIcon />} onClick={handleAdd}>
                    {t('process.add')}
                </Button>
            </Box>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{t('process.fields.name')}</TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{t('process.fields.command')}</TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{t('process.fields.platform')}</TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>Auth proxy</TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{t('common.status')}</TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }} align='center'>
                                {t('process.fields.autoStart')}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }} align='right'>
                                {t('common.actions')}
                            </TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {processes.map(server => {
                            const status = processStatuses.get(server.id);
                            const isRunning = status?.status === 'running';

                            return (
                                <TableRow key={server.id}>
                                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{getDisplayName(server)}</TableCell>
                                    <TableCell>
                                        <Typography
                                            variant='body2'
                                            sx={{
                                                fontFamily: 'monospace',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                display: 'block',
                                                maxWidth: '60ch',
                                            }}
                                            title={`${server.config.command} ${server.config.args.join(' ')}`}
                                        >
                                            {server.config.command} {server.config.args.join(' ')}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        {server.config.platform === 'wsl'
                                            ? `WSL (${server.config.wslDistribution})`
                                            : t('process.platform.host')}
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant='body2' sx={{ fontFamily: 'monospace' }}>
                                            {server.config.useAuthProxy ? 'ON' : '-'}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>{getStatusChip(server.id)}</TableCell>
                                    <TableCell align='center'>
                                        <Switch
                                            checked={server.config.autoStart || false}
                                            onChange={() => handleAutoStartToggle(server)}
                                            size='small'
                                        />
                                    </TableCell>
                                    <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                                        <Tooltip title={isRunning ? t('common.stop') : t('common.start')}>
                                            <IconButton
                                                size='small'
                                                onClick={() =>
                                                    isRunning ? handleStop(server.id) : handleStart(server.id)
                                                }
                                            >
                                                {isRunning ? <StopIcon /> : <StartIcon />}
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={t('logs.title')}>
                                            <IconButton size='small' onClick={() => handleViewLogs(server.id)}>
                                                <LogIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={t('common.edit')}>
                                            <IconButton
                                                size='small'
                                                onClick={() => handleEdit(server)}
                                                disabled={isRunning}
                                            >
                                                <EditIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={t('common.delete')}>
                                            <IconButton
                                                size='small'
                                                onClick={() => handleDelete(server.id)}
                                                disabled={isRunning}
                                            >
                                                <DeleteIcon />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {processes.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6} align='center'>
                                    <Typography variant='body2' color='text.secondary'>
                                        No processes configured
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <ProcessDialog open={dialogOpen} onClose={() => setDialogOpen(false)} server={selectedServer} />

            <ConfirmDialog
                open={deleteDialogOpen}
                title={t('process.dialog.deleteTitle')}
                message={t('process.dialog.deleteMessage')}
                onConfirm={handleDeleteConfirm}
                onCancel={() => setDeleteDialogOpen(false)}
            />
        </Box>
    );
};

export default ProcessesPage;
