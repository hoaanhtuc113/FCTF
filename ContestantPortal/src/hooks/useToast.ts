import { useCallback, useMemo } from 'react';
import { useSnackbar } from 'notistack';

export function useToast() {
  const { enqueueSnackbar } = useSnackbar();

  const success = useCallback((message: string) => {
    enqueueSnackbar(message, { variant: 'success' });
  }, [enqueueSnackbar]);

  const error = useCallback((message: string) => {
    enqueueSnackbar(message, { variant: 'error' });
  }, [enqueueSnackbar]);

  const warning = useCallback((message: string) => {
    enqueueSnackbar(message, { variant: 'warning' });
  }, [enqueueSnackbar]);

  const info = useCallback((message: string) => {
    enqueueSnackbar(message, { variant: 'info' });
  }, [enqueueSnackbar]);

  const toast = useMemo(() => ({
    success,
    error,
    warning,
    info,
  }), [success, error, warning, info]);

  return toast;
}