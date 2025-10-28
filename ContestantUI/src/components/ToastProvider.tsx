import { type ReactNode } from 'react';
import { SnackbarProvider, MaterialDesignContent, useSnackbar, type SnackbarKey } from 'notistack';
import { styled } from '@mui/material/styles';
import { IconButton } from '@mui/material';
import { Close } from '@mui/icons-material';

interface ToastProviderProps {
  children: ReactNode;
}

// Minimal terminal-style toast
const StyledMaterialDesignContent = styled(MaterialDesignContent)(() => ({
  '&.notistack-MuiContent': {
    fontFamily: 'monospace',
    fontSize: '13px',
    padding: '12px 16px',
    minWidth: '280px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#000',
    color: '#fff',
    border: '1px solid',
    boxShadow: 'none',
  },
  '&.notistack-MuiContent-success': {
    borderColor: '#22d3ee',
    color: '#22d3ee',
    '&::before': {
      content: '"[✓]"',
      marginRight: '8px',
      color: '#22d3ee',
    },
  },
  '&.notistack-MuiContent-error': {
    borderColor: '#ef4444',
    color: '#ef4444',
    '&::before': {
      content: '"[✗]"',
      marginRight: '8px',
      color: '#ef4444',
    },
  },
  '&.notistack-MuiContent-warning': {
    borderColor: '#eab308',
    color: '#eab308',
    '&::before': {
      content: '"[!]"',
      marginRight: '8px',
      color: '#eab308',
    },
  },
  '&.notistack-MuiContent-info': {
    borderColor: '#71717a',
    color: '#a1a1aa',
    '&::before': {
      content: '"[i]"',
      marginRight: '8px',
      color: '#71717a',
    },
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
        color: 'currentColor',
        opacity: 0.7,
        '&:hover': {
          opacity: 1,
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
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
      autoHideDuration={3000}
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