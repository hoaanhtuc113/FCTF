import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import { Box, TextField, Button, CircularProgress } from '@mui/material';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await login(username, password);
      toast.success('auth_success');
      navigate('/dashboard');
    } catch (err) {
      toast.error('auth_failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setUsername('');
    setPassword('');
    toast.info('form_cleared');
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 font-mono">
      <Box sx={{ maxWidth: '500px', width: '100%' }}>
        {/* ASCII Header */}
        <Box sx={{ mb: 4, color: '#22d3ee', textAlign: 'center' }}>
          <pre style={{ fontSize: '10px', lineHeight: '1.2', margin: 0 }}>
{`  ███████╗ ██████╗████████╗███████╗
  ██╔════╝██╔════╝╚══██╔══╝██╔════╝
  █████╗  ██║        ██║   █████╗  
  ██╔══╝  ██║        ██║   ██╔══╝  
  ██║     ╚██████╗   ██║   ██║     
  ╚═╝      ╚═════╝   ╚═╝   ╚═╝`}
          </pre>
          <Box sx={{ mt: 2, color: '#a1a1aa', fontSize: '13px' }}>
            FPT_CAPTURE_THE_FLAG
          </Box>
        </Box>

        {/* Login Box */}
        <Box
          sx={{
            border: '1px solid #3f3f46',
            bgcolor: '#000',
            p: 3,
          }}
        >
          {/* Terminal Header */}
          <Box sx={{ mb: 3, color: '#22d3ee', fontSize: '14px' }}>
            <span style={{ color: '#71717a' }}>$</span> ./authenticate
          </Box>

          <form onSubmit={handleSubmit}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {/* Username Field */}
              <Box>
                <Box sx={{ mb: 0.5, color: '#a1a1aa', fontSize: '12px' }}>
                  [USERNAME]
                </Box>
                <TextField
                  fullWidth
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  autoFocus
                  placeholder="enter_username"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      fontFamily: 'monospace',
                      fontSize: '14px',
                      color: '#22d3ee',
                      bgcolor: '#000',
                      '& fieldset': {
                        borderColor: '#3f3f46',
                      },
                      '&:hover fieldset': {
                        borderColor: '#52525b',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#22d3ee',
                        borderWidth: '1px',
                      },
                      '& input::placeholder': {
                        color: '#52525b',
                        opacity: 1,
                      },
                    },
                  }}
                />
              </Box>

              {/* Password Field */}
              <Box>
                <Box sx={{ mb: 0.5, color: '#a1a1aa', fontSize: '12px' }}>
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
                      color: '#22d3ee',
                      bgcolor: '#000',
                      '& fieldset': {
                        borderColor: '#3f3f46',
                      },
                      '&:hover fieldset': {
                        borderColor: '#52525b',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#22d3ee',
                        borderWidth: '1px',
                      },
                      '& input::placeholder': {
                        color: '#52525b',
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
                    color: '#71717a',
                    border: '1px solid #3f3f46',
                    bgcolor: '#000',
                    py: 1.2,
                    '&:hover': {
                      bgcolor: '#09090b',
                      borderColor: '#52525b',
                      color: '#a1a1aa',
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
                    color: '#000',
                    bgcolor: '#22d3ee',
                    border: '1px solid #22d3ee',
                    py: 1.2,
                    '&:hover': {
                      bgcolor: '#06b6d4',
                      borderColor: '#06b6d4',
                    },
                    '&:disabled': {
                      bgcolor: '#18181b',
                      color: '#3f3f46',
                      borderColor: '#27272a',
                    },
                  }}
                >
                  {loading ? (
                    <CircularProgress size={20} sx={{ color: '#3f3f46' }} />
                  ) : (
                    '[LOGIN]'
                  )}
                </Button>
              </Box>
            </Box>
          </form>

          {/* Terminal Output */}
          <Box sx={{ mt: 3, pt: 3, borderTop: '1px solid #27272a' }}>
            <Box sx={{ color: '#71717a', fontSize: '11px', lineHeight: 1.6 }}>
              <Box>status: ready</Box>
              <Box>endpoint: /auth/login</Box>
              <Box>mode: secure</Box>
            </Box>
          </Box>
        </Box>

        {/* Bottom Info */}
        <Box sx={{ mt: 3, textAlign: 'center', color: '#52525b', fontSize: '11px' }}>
          <Box>FPT_University © 2025</Box>
          <Box sx={{ mt: 1 }}>
            <span style={{ color: '#71717a' }}>need_access?</span>{' '}
            <span style={{ color: '#22d3ee', cursor: 'pointer' }}>contact_admin</span>
          </Box>
        </Box>
      </Box>
    </div>
  );
}