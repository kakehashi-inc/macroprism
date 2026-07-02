import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ open, title, message, onConfirm, onCancel }) => {
    const { t } = useTranslation();

    return (
        <Dialog open={open} onClose={onCancel}>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <DialogContentText>{message}</DialogContentText>
            </DialogContent>
            <DialogActions>
                {/* 破壊的操作のため「いいえ」(キャンセル) を既定フォーカスにする */}
                <Button onClick={onCancel} autoFocus>
                    {t('common.cancel')}
                </Button>
                <Button onClick={onConfirm} color='error' variant='contained'>
                    {t('common.delete')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ConfirmDialog;
