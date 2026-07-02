import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, AppBar, Toolbar, Typography, IconButton, Menu, MenuItem, Divider, ListItemIcon } from '@mui/material';
import {
    Memory as ProcessIcon,
    Settings as SettingsIcon,
    Lan as NgrokIcon,
    CompareArrows as ProxyIcon,
    Minimize as MinimizeIcon,
    CropSquare as MaximizeIcon,
    Close as CloseIcon,
    Menu as MenuIcon,
    PowerSettingsNew as PowerIcon,
} from '@mui/icons-material';

const appBarHeight = 64;

interface LayoutProps {
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const [isMac, setIsMac] = useState(false);

    const handleMinimize = () => {
        window.electronAPI.windowAPI.minimize();
    };

    const handleMaximize = () => {
        window.electronAPI.windowAPI.maximize();
    };

    const handleClose = () => {
        window.electronAPI.windowAPI.close();
    };

    const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
    const openMenu = (e: React.MouseEvent<HTMLElement>) => setMenuAnchorEl(e.currentTarget);
    const closeMenu = () => setMenuAnchorEl(null);

    const [appVersion, setAppVersion] = useState<string>('');

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const v = await window.electronAPI.systemAPI.getAppVersion();
                if (mounted) setAppVersion(v);
            } catch { /* ignore */ }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const info = await window.electronAPI.systemAPI.getInfo();
                if (mounted) {
                    setIsMac(info?.platform === 'darwin');
                }
            } catch {
                if (mounted) {
                    setIsMac(false);
                }
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    return (
        <Box sx={{ display: 'flex', height: '100vh' }}>
            <AppBar
                position='fixed'
                sx={{
                    width: '100%',
                    ml: 0,
                    WebkitAppRegion: 'drag',
                    pl: isMac ? '72px' : 0,
                    pt: isMac ? 0.5 : 0,
                }}
            >
                <Toolbar
                    sx={{
                        minHeight: appBarHeight,
                        pl: isMac ? 0 : 0,
                    }}
                >
                    <Typography
                        variant='h6'
                        noWrap
                        component='div'
                        sx={{ flexGrow: 1, display: 'flex', alignItems: 'baseline', gap: 1 }}
                    >
                        <Box component='span'>{t('app.title')}</Box>
                        {appVersion ? (
                            <Typography component='span' variant='caption' sx={{ color: 'text.secondary' }}>
                                v{appVersion}
                            </Typography>
                        ) : null}
                    </Typography>
                    <Box sx={{ WebkitAppRegion: 'no-drag', mr: 2, display: 'flex', gap: 1 }}>
                        {[
                            { path: '/processes', Icon: ProcessIcon, key: 'proc' },
                            { path: '/https-proxy', Icon: ProxyIcon, key: 'https' },
                            { path: '/ngrok', Icon: NgrokIcon, key: 'ngrok' },
                            { path: '/settings', Icon: SettingsIcon, key: 'settings' },
                        ].map(({ path, Icon, key }) => {
                            const active = location.pathname.startsWith(path);
                            return (
                                <Box
                                    key={key}
                                    sx={{
                                        position: 'relative',
                                        borderRadius: 1,
                                        bgcolor: theme => (active ? theme.palette.action.selected : 'transparent'),
                                        '&::after': {
                                            content: '""',
                                            position: 'absolute',
                                            left: 8,
                                            right: 8,
                                            bottom: -6,
                                            height: 3,
                                            borderRadius: 2,
                                            bgcolor: theme => (active ? theme.palette.primary.main : 'transparent'),
                                        },
                                    }}
                                >
                                    <IconButton
                                        size='small'
                                        color={active ? 'inherit' : 'default'}
                                        onClick={() => navigate(path)}
                                    >
                                        <Icon />
                                    </IconButton>
                                </Box>
                            );
                        })}
                    </Box>
                    <Box sx={{ WebkitAppRegion: 'no-drag', display: 'flex', alignItems: 'center' }}>
                        <IconButton size='small' edge='end' color='inherit' onClick={openMenu} sx={{ mr: 1 }}>
                            <MenuIcon />
                        </IconButton>
                        <Menu
                            anchorEl={menuAnchorEl}
                            open={Boolean(menuAnchorEl)}
                            onClose={closeMenu}
                            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                        >
                            <MenuItem
                                onClick={() => {
                                    closeMenu();
                                    navigate('/processes');
                                }}
                            >
                                <ListItemIcon>
                                    <ProcessIcon fontSize='small' />
                                </ListItemIcon>
                                {t('process.title')}
                            </MenuItem>
                            <MenuItem
                                onClick={() => {
                                    closeMenu();
                                    navigate('/https-proxy');
                                }}
                            >
                                <ListItemIcon>
                                    <ProxyIcon fontSize='small' />
                                </ListItemIcon>
                                HTTPS Proxy
                            </MenuItem>
                            <MenuItem
                                onClick={() => {
                                    closeMenu();
                                    navigate('/ngrok');
                                }}
                            >
                                <ListItemIcon>
                                    <NgrokIcon fontSize='small' />
                                </ListItemIcon>
                                {t('ngrok.title')}
                            </MenuItem>
                            <MenuItem
                                onClick={() => {
                                    closeMenu();
                                    navigate('/settings');
                                }}
                            >
                                <ListItemIcon>
                                    <SettingsIcon fontSize='small' />
                                </ListItemIcon>
                                {t('settings.title')}
                            </MenuItem>
                            <Divider />
                            <MenuItem
                                onClick={() => {
                                    closeMenu();
                                    // Quit app (same behavior as tray Quit)
                                    window.electronAPI.windowAPI.close(true);
                                }}
                            >
                                <ListItemIcon>
                                    <PowerIcon fontSize='small' />
                                </ListItemIcon>
                                {t('tray.quit')}
                            </MenuItem>
                        </Menu>
                        {!isMac && (
                            <>
                                <IconButton size='small' edge='end' color='inherit' onClick={handleMinimize}>
                                    <MinimizeIcon />
                                </IconButton>
                                <IconButton
                                    size='small'
                                    edge='end'
                                    color='inherit'
                                    onClick={handleMaximize}
                                    sx={{ mx: 1 }}
                                >
                                    <MaximizeIcon />
                                </IconButton>
                                <IconButton size='small' edge='end' color='inherit' onClick={handleClose}>
                                    <CloseIcon />
                                </IconButton>
                            </>
                        )}
                    </Box>
                </Toolbar>
            </AppBar>
            <Box
                component='main'
                sx={{
                    flexGrow: 1,
                    bgcolor: 'background.default',
                    p: 3,
                    width: '100%',
                    height: `calc(100vh - ${appBarHeight}px)`,
                    overflow: 'auto',
                    mt: `${appBarHeight}px`,
                }}
            >
                {children}
            </Box>
        </Box>
    );
};

export default Layout;
