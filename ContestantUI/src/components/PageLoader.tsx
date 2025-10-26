import { Box } from '@mui/material';
import { useTheme } from '../context/ThemeContext';
import { useEffect, useState } from 'react';

export function PageLoader() {
  const { theme } = useTheme();
  const [dots, setDots] = useState('');
  
  const isDark = theme === 'dark';
  const colors = {
    bg: isDark ? '#000' : '#0a0a0a',
    text: isDark ? '#22d3ee' : '#22d3ee',
    textMuted: isDark ? '#71717a' : '#a1a1aa',
  };

  // Animated dots effect
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box
      className="flex items-center justify-center min-h-screen font-mono"
      style={{ backgroundColor: colors.bg }}
    >
      <Box sx={{ textAlign: 'center' }}>
        {/* Loading Text */}
        <Box sx={{ color: colors.text, fontSize: '14px', mb: 2 }}>
          <span style={{ color: colors.textMuted }}>$</span> loading{dots}
        </Box>
        
        {/* Terminal Spinner */}
        <Box sx={{ color: colors.text, fontSize: '24px', lineHeight: 1 }}>
          <span className="animate-pulse">|</span>
        </Box>
        
        {/* Status */}
        <Box sx={{ color: colors.textMuted, fontSize: '11px', mt: 2 }}>
          [initializing...]
        </Box>
      </Box>
    </Box>
  );
}