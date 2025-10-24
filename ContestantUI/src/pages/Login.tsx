import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import {
  Box,
  TextField,
  Button,
  CircularProgress,
  Paper,
  InputAdornment,
  IconButton,
  Container,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  AccountCircle,
  LockOutlined,
} from '@mui/icons-material';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await login(username, password);
      toast.success('Login successful!');
      navigate('/dashboard');
    } catch (err) {
      toast.error('Wrong username or password. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setUsername('');
    setPassword('');
    toast.info('Form cleared');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-gray-100 to-gray-200 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle Decorative Elements */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-orange-100/30 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-orange-50/40 rounded-full blur-3xl" />

      <Container maxWidth="sm">
        <Box className="relative z-10">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="flex flex-col items-center gap-3 mb-3">
              {/* FPT University Logo */}
              <div className="w-20 h-20 rounded-2xl bg-white shadow-lg flex items-center justify-center p-3 border border-gray-100">
                <svg viewBox="0 0 100 100" width="100%" height="100%">
                  <defs>
                    <linearGradient id="orangeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style={{ stopColor: '#ff6f00', stopOpacity: 1 }} />
                      <stop offset="100%" style={{ stopColor: '#f57c00', stopOpacity: 1 }} />
                    </linearGradient>
                  </defs>
                  <text
                    x="50"
                    y="65"
                    fontSize="48"
                    fontWeight="bold"
                    fill="url(#orangeGrad)"
                    textAnchor="middle"
                    fontFamily="Arial, sans-serif"
                  >
                    FPT
                  </text>
                </svg>
              </div>

              {/* Contest Title */}
              <div>
                <h1 className="text-4xl font-bold text-gray-800 tracking-wide mb-1">
                  FCTF
                </h1>
                <p className="text-gray-600 font-medium">
                  FPT Capture The Flag
                </p>
              </div>
            </div>
            <p className="text-gray-500 text-sm">
              Sign in to continue
            </p>
          </div>

          {/* Login Card */}
          <Paper
            elevation={0}
            className="rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-xl"
          >
            <div className="p-8">
              <form onSubmit={handleSubmit}>
                <div className="flex flex-col gap-5">
                  <TextField
                    fullWidth
                    id="username"
                    label="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                    autoFocus
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <AccountCircle className="text-gray-400" />
                        </InputAdornment>
                      ),
                    }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: '12px',
                        backgroundColor: '#f9fafb',
                        '& fieldset': {
                          borderColor: '#e5e7eb',
                        },
                        '&:hover fieldset': {
                          borderColor: '#ff6f00',
                        },
                        '&.Mui-focused': {
                          backgroundColor: 'white',
                          '& fieldset': {
                            borderColor: '#ff6f00',
                            borderWidth: '2px',
                          },
                        },
                      },
                      '& .MuiInputLabel-root': {
                        color: '#6b7280',
                        '&.Mui-focused': {
                          color: '#ff6f00',
                        },
                      },
                    }}
                  />

                  <TextField
                    fullWidth
                    id="password"
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockOutlined className="text-gray-400" />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowPassword(!showPassword)}
                            edge="end"
                            className="text-gray-400 hover:text-gray-600"
                          >
                            {showPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: '12px',
                        backgroundColor: '#f9fafb',
                        '& fieldset': {
                          borderColor: '#e5e7eb',
                        },
                        '&:hover fieldset': {
                          borderColor: '#ff6f00',
                        },
                        '&.Mui-focused': {
                          backgroundColor: 'white',
                          '& fieldset': {
                            borderColor: '#ff6f00',
                            borderWidth: '2px',
                          },
                        },
                      },
                      '& .MuiInputLabel-root': {
                        color: '#6b7280',
                        '&.Mui-focused': {
                          color: '#ff6f00',
                        },
                      },
                    }}
                  />

                  <div className="flex gap-3 mt-2">
                    <Button
                      fullWidth
                      variant="outlined"
                      onClick={handleClear}
                      sx={{
                        borderRadius: '12px',
                        textTransform: 'none',
                        fontSize: '15px',
                        fontWeight: 500,
                        py: 1.5,
                        color: '#6b7280',
                        borderColor: '#e5e7eb',
                        '&:hover': {
                          borderColor: '#d1d5db',
                          bgcolor: '#f9fafb',
                        },
                      }}
                    >
                      Clear
                    </Button>
                    <Button
                      type="submit"
                      fullWidth
                      variant="contained"
                      disabled={loading}
                      sx={{
                        borderRadius: '12px',
                        textTransform: 'none',
                        fontSize: '15px',
                        fontWeight: 600,
                        py: 1.5,
                        background: 'linear-gradient(135deg, #ff6f00 0%, #f57c00 100%)',
                        boxShadow: '0 4px 14px 0 rgba(255, 111, 0, 0.25)',
                        '&:hover': {
                          background: 'linear-gradient(135deg, #f57c00 0%, #ef6c00 100%)',
                          boxShadow: '0 6px 20px 0 rgba(255, 111, 0, 0.35)',
                        },
                        '&:disabled': {
                          bgcolor: '#e5e7eb',
                          color: '#9ca3af',
                          boxShadow: 'none',
                        },
                      }}
                    >
                      {loading ? (
                        <CircularProgress size={24} sx={{ color: 'white' }} />
                      ) : (
                        'Sign in'
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-8 py-4 border-t border-gray-100 flex justify-between items-center">
              <p className="text-xs text-gray-500">FPT University</p>
              <div className="flex gap-4">
                <a href="#" className="text-xs text-gray-500 hover:text-orange-600 transition-colors">
                  Help
                </a>
                <a href="#" className="text-xs text-gray-500 hover:text-orange-600 transition-colors">
                  Privacy
                </a>
                <a href="#" className="text-xs text-gray-500 hover:text-orange-600 transition-colors">
                  Terms
                </a>
              </div>
            </div>
          </Paper>

          {/* Bottom Links */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Don't have an account?{' '}
              <a href="#" className="text-gray-800 font-semibold hover:text-orange-600 transition-colors">
                Contact admin
              </a>
            </p>
          </div>
        </Box>
      </Container>
    </div>
  );
}