import { Box, CircularProgress } from '@mui/material';

export function PageLoader() {
  return (
    <Box
      className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300"
    >
      <CircularProgress sx={{ color: '#ff6f00' }} size={60} />
    </Box>
  );
}