import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import { useTheme } from '../context/ThemeContext';
import { Box, TextField, Button, CircularProgress } from '@mui/material';
import { configService } from '../services/configService';

export function Login() {
  const { theme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  // Theme-aware colors
  const isDark = theme === 'dark';
  const colors = {
    bg: isDark ? '#000' : '#0a0a0a',
    border: isDark ? '#3f3f46' : '#52525b',
    borderLight: isDark ? '#52525b' : '#71717a',
    text: isDark ? '#fb923c' : '#f97316',
    textSecondary: isDark ? '#a1a1aa' : '#d4d4d8',
    textMuted: isDark ? '#71717a' : '#a1a1aa',
    placeholder: isDark ? '#52525b' : '#71717a',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await login(username, password);
      toast.success('auth_success');
      navigate('/dashboard');
    } catch (err) {
      console.log(err);
      // Display error message from backend 
      const errorMessage = err instanceof Error ? err.message : 'auth_failed';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setUsername('');
    setPassword('');
    toast.info('form_cleared');
  };

  // fetch public config for logo
  useEffect(() => {
    (async () => {
      try {
        const cfg = await configService.getPublicConfig();
        if (cfg && cfg.ctf_logo) {
          setLogoUrl(cfg.ctf_logo);
        }
      } catch (err) {
        console.error('Error loading logo config:', err);
      }
    })();
  }, []);

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 font-mono"
      style={{ backgroundColor: colors.bg }}
    >
      <Box sx={{ maxWidth: '500px', width: '100%' }}>
        {/* Logo or ASCII Header */}
        <Box sx={{ mb: 4, color: colors.text, textAlign: 'center' }}>
          <Box
            sx={{
              mb: 4,
              color: colors.text,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <img
              src={logoUrl || '/assets/fctf-logo.png'}
              alt="logo"
              style={{ maxWidth: '150px' }}
            />
          </Box>

          <Box sx={{ mt: 2, color: colors.textSecondary, fontSize: '13px' }}>
            FPT_CAPTURE_THE_FLAG
          </Box>
        </Box>

        {/* Login Box */}
        <Box
          sx={{
            border: `1px solid ${colors.border}`,
            bgcolor: colors.bg,
            p: 3,
          }}
        >
          {/* Terminal Header */}
          <Box sx={{ mb: 3, color: colors.text, fontSize: '14px' }}>
            <span style={{ color: colors.textMuted }}>$</span> ./authenticate
          </Box>

          <form onSubmit={handleSubmit}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {/* Username Field */}
              <Box sx={{ mb: 2 }}>
                <Box sx={{ mb: 0.5, fontSize: '13px', color: colors.textSecondary }}>
                  [username]
                </Box>
                <TextField
                  fullWidth
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  placeholder="input username..."
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      fontFamily: '"Roboto Mono", monospace',
                      fontSize: '13px',
                      bgcolor: colors.bg,
                      color: colors.text,
                      '& fieldset': {
                        borderColor: colors.borderLight,
                      },
                      '&:hover fieldset': {
                        borderColor: colors.border,
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: colors.text,
                        borderWidth: '1px',
                      },
                    },
                    '& .MuiInputBase-input::placeholder': {
                      color: colors.placeholder,
                      opacity: 1,
                    },
                  }}
                />
              </Box>

              {/* Password Field */}
              <Box>
                <Box sx={{ mb: 0.5, color: colors.textSecondary, fontSize: '12px' }}>
                  [PASSWORD]
                </Box>
                <TextField
                  fullWidth
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="enter_password"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      fontFamily: 'monospace',
                      fontSize: '14px',
                      color: colors.text,
                      bgcolor: colors.bg,
                      '& fieldset': {
                        borderColor: colors.border,
                      },
                      '&:hover fieldset': {
                        borderColor: colors.borderLight,
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: colors.text,
                        borderWidth: '1px',
                      },
                      '& input::placeholder': {
                        color: colors.placeholder,
                        opacity: 1,
                      },
                    },
                  }}
                />
              </Box>

              {/* Buttons */}
              <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                <Button
                  fullWidth
                  onClick={handleClear}
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    textTransform: 'none',
                    color: colors.textMuted,
                    border: `1px solid ${colors.border}`,
                    bgcolor: colors.bg,
                    py: 1.2,
                    '&:hover': {
                      bgcolor: isDark ? '#09090b' : '#f5f5f5',
                      borderColor: colors.borderLight,
                      color: colors.textSecondary,
                    },
                  }}
                >
                  [CLEAR]
                </Button>
                <Button
                  type="submit"
                  fullWidth
                  disabled={loading}
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    textTransform: 'none',
                    color: isDark ? '#000' : '#fff',
                    bgcolor: '#fb923c',
                    border: '1px solid #fb923c',
                    py: 1.2,
                    '&:hover': {
                      bgcolor: '#f97316',
                      borderColor: '#f97316',
                    },
                    '&:disabled': {
                      bgcolor: isDark ? '#18181b' : '#e5e5e5',
                      color: isDark ? '#3f3f46' : '#a1a1aa',
                      borderColor: isDark ? '#27272a' : '#d4d4d4',
                    },
                  }}
                >
                  {loading ? (
                    <CircularProgress size={20} sx={{ color: isDark ? '#3f3f46' : '#a1a1aa' }} />
                  ) : (
                    '[LOGIN]'
                  )}
                </Button>
              </Box>
            </Box>
          </form>

          {/* Terminal Output */}
          <Box sx={{ mt: 3, pt: 3, borderTop: `1px solid ${colors.borderLight}` }}>
            <Box sx={{ color: colors.textMuted, fontSize: '11px', lineHeight: 1.6 }}>
              <Box>status: ready</Box>
              <Box>endpoint: /auth/login</Box>
              <Box>mode: secure</Box>
            </Box>
          </Box>
        </Box>

        {/* Bottom Info */}
        <Box sx={{ mt: 3, textAlign: 'center', color: colors.placeholder, fontSize: '11px' }}>
          <Box>FPT_University © 2025</Box>
          <Box sx={{ mt: 1 }}>
            <span style={{ color: colors.textMuted }}>need_access?</span>{' '}
            <span style={{ color: '#fb923c', cursor: 'pointer' }}>contact_admin</span>
          </Box>
        </Box>
      </Box>
    </div>
  );
}