import { type ReactNode } from 'react';
import { SnackbarProvider, MaterialDesignContent, useSnackbar, type SnackbarKey } from 'notistack';
import { styled } from '@mui/material/styles';
import { IconButton } from '@mui/material';
import { Close } from '@mui/icons-material';

interface ToastProviderProps {
  children: ReactNode;
}

// Styled toast content with modern design
const StyledMaterialDesignContent = styled(MaterialDesignContent)(({ theme }) => ({
  '&.notistack-MuiContent': {
    borderRadius: '12px',
    fontWeight: 600,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
    fontSize: '14px',
    padding: '14px 18px',
    minWidth: '320px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  '&.notistack-MuiContent-success': {
    backgroundColor: '#10b981',
    color: '#ffffff',
    boxShadow: '0 8px 24px rgba(16, 185, 129, 0.4)',
  },
  '&.notistack-MuiContent-error': {
    backgroundColor: '#ef4444',
    color: '#ffffff',
    boxShadow: '0 8px 24px rgba(239, 68, 68, 0.4)',
  },
  '&.notistack-MuiContent-warning': {
    backgroundColor: '#f59e0b',
    color: '#ffffff',
    boxShadow: '0 8px 24px rgba(245, 158, 11, 0.4)',
  },
  '&.notistack-MuiContent-info': {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    boxShadow: '0 8px 24px rgba(59, 130, 246, 0.4)',
  },
}));

// Close button component
function CloseButton({ snackbarKey }: { snackbarKey: SnackbarKey }) {
  const { closeSnackbar } = useSnackbar();

  return (
    <IconButton
      size="small"
      onClick={() => closeSnackbar(snackbarKey)}
      sx={{
        color: 'rgba(255, 255, 255, 0.9)',
        '&:hover': {
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
        },
        padding: '4px',
      }}
    >
      <Close fontSize="small" />
    </IconButton>
  );
}

export function ToastProvider({ children }: ToastProviderProps) {
  return (
    <SnackbarProvider
      maxSnack={3}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      autoHideDuration={4000}
      Components={{
        success: StyledMaterialDesignContent,
        error: StyledMaterialDesignContent,
        warning: StyledMaterialDesignContent,
        info: StyledMaterialDesignContent,
      }}
      action={(snackbarKey) => <CloseButton snackbarKey={snackbarKey} />}
      dense
      preventDuplicate
    >
      {children}
    </SnackbarProvider>
  );
}