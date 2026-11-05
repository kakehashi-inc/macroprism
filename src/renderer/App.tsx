import { useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, Snackbar, Alert } from '@mui/material';
import { useTranslation } from 'react-i18next';
import useStore from './store/useStore';
import Layout from './components/Layout';
import UpdateNotification from './components/UpdateNotification';
import ProcessesPage from './pages/ProcessesPage';
import SettingsPage from './pages/SettingsPage';
import LogsPage from './pages/LogsPage';
import NgrokPage from './pages/NgrokPage';
import HttpsProxyPage from './pages/HttpsProxyPage';

function App() {
    const { i18n } = useTranslation();
    const settings = useStore(s => s.config?.settings);
    const initialize = useStore(s => s.initialize);

    useEffect(() => {
        initialize();
    }, [initialize]);

    useEffect(() => {
        if (settings) {
            i18n.changeLanguage(settings.language);
        }
    }, [settings, i18n]);

    const theme = createTheme({
        palette: {
            mode: settings?.darkMode ? 'dark' : 'light',
            primary: {
                main: '#1976d2',
            },
            secondary: {
                main: '#dc004e',
            },
        },
        typography: {
            fontFamily: [
                '-apple-system',
                'BlinkMacSystemFont',
                '"Segoe UI"',
                'Roboto',
                '"Helvetica Neue"',
                'Arial',
                'sans-serif',
            ].join(','),
            fontSize: 14, // base 14px
            // Title (page/app titles): 18px
            h1: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
            h2: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
            h3: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
            h4: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
            // Section/Dialog titles: 16px
            h5: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 },
            h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 },
            // Body/controls: 14px
            body1: { fontSize: '0.875rem' },
            subtitle1: { fontSize: '0.875rem' },
            button: { fontSize: '0.875rem', textTransform: 'none' },
            // Caption/secondary: 12px
            body2: { fontSize: '0.75rem' },
            subtitle2: { fontSize: '0.75rem' },
            caption: { fontSize: '0.75rem' },
        },
    });

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <GlobalSnackbar />
            <UpdateNotification />
            {import.meta.env.DEV ? (
                <BrowserRouter>
                    <Layout>
                        <Routes>
                            <Route path='/' element={<Navigate to='/processes' replace />} />
                            <Route path='/processes' element={<ProcessesPage />} />
                            <Route path='/settings' element={<SettingsPage />} />
                            <Route path='/logs/:processId?' element={<LogsPage />} />
                            <Route path='/ngrok' element={<NgrokPage />} />
                            <Route path='/https-proxy' element={<HttpsProxyPage />} />
                        </Routes>
                    </Layout>
                </BrowserRouter>
            ) : (
                <HashRouter>
                    <Layout>
                        <Routes>
                            <Route path='/' element={<Navigate to='/processes' replace />} />
                            <Route path='/processes' element={<ProcessesPage />} />
                            <Route path='/settings' element={<SettingsPage />} />
                            <Route path='/logs/:processId?' element={<LogsPage />} />
                            <Route path='/ngrok' element={<NgrokPage />} />
                            <Route path='/https-proxy' element={<HttpsProxyPage />} />
                        </Routes>
                    </Layout>
                </HashRouter>
            )}
        </ThemeProvider>
    );
}

export default App;

function GlobalSnackbar() {
    const snackbar = useStore(s => s.snackbar);
    const close = useStore(s => s.closeToast);
    return (
        <Snackbar
            open={!!snackbar?.open}
            autoHideDuration={2000}
            onClose={close}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
            <Alert severity='success' onClose={close} sx={{ width: '100%' }}>
                {snackbar?.message || ''}
            </Alert>
        </Snackbar>
    );
}
