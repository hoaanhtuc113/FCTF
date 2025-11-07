import { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';

/**
 * Custom hook to get theme-aware colors
 * Simplified version using Tailwind color values
 */
export const useColors = () => {
  const { theme } = useTheme();

  return useMemo(() => ({
    // Current theme
    theme,
    
    // Primary colors (orange - main accent)
    primary: {
      orange: {
        50: '#fff7ed',
        100: '#ffedd5',
        200: '#fed7aa',
        300: '#fdba74',
        400: '#fb923c',
        500: '#f97316',
        600: '#ea580c',
        700: '#c2410c',
        800: '#9a3412',
        900: '#7c2d12',
      },
      green: {
        50: '#f0fdf4',
        100: '#dcfce7',
        200: '#bbf7d0',
        300: '#86efac',
        400: '#4ade80',
        500: '#22c55e',
        600: '#16a34a',
        700: '#15803d',
        800: '#166534',
        900: '#14532d',
      },
    },
    
    // Background colors
    bg: {
      primary: theme === 'dark' ? '#0a0a0a' : '#ffffff',
      secondary: theme === 'dark' ? '#1f2937' : '#f9fafb',
      tertiary: theme === 'dark' ? '#374151' : '#f3f4f6',
    },
    
    // Text colors
    text: {
      primary: theme === 'dark' ? '#f9fafb' : '#111827',
      secondary: theme === 'dark' ? '#d1d5db' : '#4b5563',
      tertiary: theme === 'dark' ? '#9ca3af' : '#6b7280',
      disabled: theme === 'dark' ? '#6b7280' : '#9ca3af',
    },
    
    // Border colors
    border: {
      primary: theme === 'dark' ? '#374151' : '#e5e7eb',
      secondary: theme === 'dark' ? '#4b5563' : '#d1d5db',
      focus: theme === 'dark' ? '#fb923c' : '#f97316',
    },
    
    // Status colors
    status: {
      success: '#22c55e',
      error: '#ef4444',
      warning: theme === 'dark' ? '#fbbf24' : '#f59e0b',
      info: theme === 'dark' ? '#fb923c' : '#f97316',
      locked: theme === 'dark' ? '#fbbf24' : '#f59e0b',
    },
    
    // Status backgrounds
    statusBg: {
      success: theme === 'dark' ? 'rgba(34, 197, 94, 0.2)' : '#dcfce7',
      error: theme === 'dark' ? 'rgba(239, 68, 68, 0.2)' : '#fee2e2',
      warning: theme === 'dark' ? 'rgba(251, 191, 36, 0.2)' : '#fef3c7',
      info: theme === 'dark' ? 'rgba(251, 146, 60, 0.2)' : '#ffedd5',
      locked: theme === 'dark' ? 'rgba(251, 191, 36, 0.2)' : '#fef3c7',
    },
    
    // Status borders
    statusBorder: {
      success: theme === 'dark' ? 'rgba(34, 197, 94, 0.3)' : '#86efac',
      error: theme === 'dark' ? 'rgba(239, 68, 68, 0.3)' : '#fca5a5',
      warning: theme === 'dark' ? 'rgba(251, 191, 36, 0.3)' : '#fde68a',
      info: theme === 'dark' ? 'rgba(251, 146, 60, 0.3)' : '#fed7aa',
      locked: theme === 'dark' ? 'rgba(251, 191, 36, 0.3)' : '#fde68a',
    },
  }), [theme]);
};

export default useColors;
