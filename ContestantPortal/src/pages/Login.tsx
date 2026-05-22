import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../hooks/useToast';
import { Box, TextField, Button, CircularProgress, IconButton } from '@mui/material';
import { Moon, Sun, Shield } from 'lucide-react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { configService } from '../services/configService';
import { getTurnstileSiteKey } from '../services/envService';
import { AuthTurnstile } from '../components/AuthTurnstile';
import { CyberBackground } from '../components/CyberBackground';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const captchaTokenRef = useRef<string | null>(null);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const lastCaptchaErrorAtRef = useRef(0);
  const turnstileSiteKey = getTurnstileSiteKey();
  const captchaEnabled = turnstileSiteKey.length > 0;

  const resetCaptcha = useCallback(() => {
    captchaTokenRef.current = null;
    turnstileRef.current?.reset();
  }, []);

  const handleCaptchaSuccess = useCallback((token: string) => {
    captchaTokenRef.current = token;
  }, []);

  const handleCaptchaExpire = useCallback(() => {
    captchaTokenRef.current = null;
  }, []);

  const toastRef = useRef(toast);
  toastRef.current = toast;

  const handleCaptchaError = useCallback(() => {
    captchaTokenRef.current = null;

    const now = Date.now();
    if (now - lastCaptchaErrorAtRef.current > 3000) {
      lastCaptchaErrorAtRef.current = now;
      toastRef.current.error('Captcha verification failed. Please retry.');
    }
  }, []);

  const { theme, toggleTheme } = useTheme();

  const colors = {
    light: {
      pageBg: '#f6f5f3',
      panelBg: '#ffffff',
      border: '#ece7df',
      text: '#121212',
      textSecondary: '#6b7280',
      inputBg: '#fffcf8',
      inputBorder: '#e7dfd1',
      primary: '#ea7a00',
      primaryDark: '#d86600',
      tagBg: '#fff7ec',
      shadow: '0 18px 45px rgba(17, 24, 39, 0.04)',
    },
    dark: {
      pageBg: '#090d16',
      panelBg: '#111827',
      border: '#1f2937',
      text: '#f3f4f6',
      textSecondary: '#9ca3af',
      inputBg: '#1f2937',
      inputBorder: '#374151',
      primary: '#ea7a00',
      primaryDark: '#fb923c',
      tagBg: 'rgba(234, 122, 0, 0.1)',
      shadow: '0 18px 45px rgba(0, 0, 0, 0.5)',
    }
  };

  const activeColors = theme === 'dark' ? colors.dark : colors.light;

  const yieldToBrowser = useCallback(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (captchaEnabled && !captchaTokenRef.current) {
      toast.error('Please complete captcha challenge');
      return;
    }

    setLoading(true);
    await yieldToBrowser();

    try {
      await login(username, password, captchaTokenRef.current ?? undefined);
      toast.success('auth_success');
      // after authentication, go to the contests selection page
      navigate('/contests');
    } catch (err) {
      console.log(err);
      resetCaptcha();
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
    resetCaptcha();
    toast.info('form_cleared');
  };

  // fetch public config for logo
  useEffect(() => {
    (async () => {
      try {
        const cfg = await configService.getPublicConfig();
        setRegistrationEnabled(Boolean(cfg?.contestant_registration_enabled));
      } catch (err) {
        console.error('Error loading logo config:', err);
      }
    })();
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'IA-lab | Phòng thí nghiệm ATTT - khoa ATTT, FPT University Hà Nội';

    const upsertMeta = (selector: string, key: 'name' | 'property', value: string, content: string) => {
      let tag = document.head.querySelector(selector) as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(key, value);
        document.head.appendChild(tag);
      }

      tag.setAttribute('content', content);
      return tag;
    };

    const canonicalSelector = 'link[rel="canonical"]';
    let canonicalTag = document.head.querySelector(canonicalSelector) as HTMLLinkElement | null;
    if (!canonicalTag) {
      canonicalTag = document.createElement('link');
      canonicalTag.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalTag);
    }
    canonicalTag.setAttribute('href', `${window.location.origin}/login`);

    upsertMeta(
      'meta[name="description"]',
      'name',
      'description',
      'Login to FCTF (FPT Capture The Flag), a cybersecurity CTF platform for challenges, flag submission, and real-time rankings.'
    );
    upsertMeta('meta[property="og:title"]', 'property', 'og:title', 'FCTF Capture The Flag Login');
    upsertMeta(
      'meta[property="og:description"]',
      'property',
      'og:description',
      'Access the FCTF contestant portal to join Capture The Flag cybersecurity competitions.'
    );
    upsertMeta('meta[property="og:url"]', 'property', 'og:url', `${window.location.origin}/login`);
    upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', 'FCTF Capture The Flag Login');
    upsertMeta(
      'meta[name="twitter:description"]',
      'name',
      'twitter:description',
      'Login to the FCTF platform and join Capture The Flag cybersecurity challenges.'
    );

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col font-mono"
      style={{
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: activeColors.pageBg,
        color: activeColors.text,
      }}
    >
      <CyberBackground />

      <Box
        component="header"
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          p: { xs: 2, sm: 4 },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: '8px',
              bgcolor: activeColors.tagBg,
              color: activeColors.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `1px solid ${activeColors.primary}`,
            }}
          >
            <Shield size={16} />
          </Box>
          <Box sx={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.05em', fontFamily: '"JetBrains Mono", monospace' }}>
            FCTF <span style={{ color: activeColors.primary }}>//</span> PORTAL
          </Box>
        </Box>

        <IconButton
          onClick={() => { toggleTheme(); toast.success(`Switched to ${theme === 'dark' ? 'light' : 'dark'} mode`); }}
          sx={{
            color: activeColors.textSecondary,
            p: 1,
            border: `1px solid ${activeColors.border}`,
            borderRadius: '8px',
            bgcolor: theme === 'dark' ? 'rgba(31, 41, 55, 0.5)' : 'rgba(255, 255, 255, 0.75)',
            backdropFilter: 'blur(8px)',
            '&:hover': {
              borderColor: activeColors.primary,
              color: activeColors.primary,
            }
          }}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
      </Box>

      <Box sx={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, pt: { xs: 10, sm: 4 } }}>
        <Box sx={{ width: '100%', maxWidth: '960px' }}>
          <Box sx={{ maxWidth: '440px', mx: 'auto' }}>
            <Box sx={{ mb: 4, textAlign: 'center' }}>
              <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%', mb: 2 }}>
                <Box
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                    px: 2,
                    py: 0.75,
                    borderRadius: '999px',
                    border: `1px solid ${activeColors.inputBorder}`,
                    bgcolor: activeColors.tagBg,
                    color: activeColors.primary,
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    width: 'max-content',
                  }}
                >
                  IA-Lab — Faculty of Information Assurance
                </Box>
              </Box>

              <Box sx={{ fontSize: { xs: 36, sm: 46 }, fontWeight: 800, lineHeight: 1.15, mb: 1.5 }}>
                <span
                  style={{
                    background: 'linear-gradient(135deg,#f59e0b 0%,#ea580c 50%,#dc2626 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  }}
                >
                  Sân Chơi
                </span>
              </Box>
              <Box sx={{ color: activeColors.textSecondary, fontSize: 14 }}>
                Authenticate to enter the FPT Capture The Flag platform
              </Box>
            </Box>

            <Box
              sx={{
                border: `1px solid ${activeColors.border}`,
                bgcolor: theme === 'dark' ? 'rgba(17, 24, 39, 0.75)' : 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(16px)',
                p: { xs: 3, sm: 4 },
                borderRadius: '16px',
                boxShadow: activeColors.shadow,
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {/* Premium Glow Effect */}
              <div 
                className="absolute -top-24 -right-24 w-48 h-48 pointer-events-none rounded-full opacity-50" 
                style={{
                  background: 'radial-gradient(circle, rgba(234, 122, 0, 0.15) 0%, transparent 70%)',
                }}
              />
              <div 
                className="absolute -bottom-24 -left-24 w-48 h-48 pointer-events-none rounded-full opacity-50" 
                style={{
                  background: 'radial-gradient(circle, rgba(234, 122, 0, 0.1) 0%, transparent 70%)',
                }}
              />

              <Box sx={{ mb: 3, color: activeColors.primary, fontSize: 13, fontWeight: 800, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 1 }}>
                <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
                AUTHENTICATION
              </Box>

              <form onSubmit={handleSubmit} style={{ position: 'relative', zIndex: 2 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  <Box>
                    <Box sx={{ mb: 1, fontSize: 12, color: activeColors.textSecondary, fontWeight: 700 }}>
                      USERNAME //
                    </Box>
                    <TextField
                      fullWidth
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={loading}
                      placeholder="input_username"
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: 13,
                          bgcolor: activeColors.inputBg,
                          color: activeColors.text,
                          borderRadius: '8px',
                          '& fieldset': {
                            borderColor: activeColors.inputBorder,
                            transition: 'all 0.2s',
                          },
                          '&:hover fieldset': {
                            borderColor: activeColors.primary,
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: activeColors.primary,
                            borderWidth: '1px',
                            boxShadow: `0 0 0 3px ${activeColors.tagBg}`,
                          },
                        },
                        '& .MuiInputBase-input::placeholder': {
                          color: activeColors.textSecondary,
                          opacity: 0.7,
                        },
                      }}
                    />
                  </Box>

                  <Box>
                    <Box sx={{ mb: 1, color: activeColors.textSecondary, fontSize: 12, fontWeight: 700 }}>
                      PASSWORD //
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
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: 13,
                          color: activeColors.text,
                          bgcolor: activeColors.inputBg,
                          borderRadius: '8px',
                          '& fieldset': {
                            borderColor: activeColors.inputBorder,
                            transition: 'all 0.2s',
                          },
                          '&:hover fieldset': {
                            borderColor: activeColors.primary,
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: activeColors.primary,
                            borderWidth: '1px',
                            boxShadow: `0 0 0 3px ${activeColors.tagBg}`,
                          },
                          '& input::placeholder': {
                            color: activeColors.textSecondary,
                            opacity: 0.7,
                          },
                        },
                      }}
                    />
                  </Box>

                  {captchaEnabled ? (
                    <Box sx={{ mt: 1, p: 1, bgcolor: activeColors.inputBg, borderRadius: '8px', border: `1px solid ${activeColors.inputBorder}`, display: 'flex', justifyContent: 'center' }}>
                      <AuthTurnstile
                        siteKey={turnstileSiteKey}
                        action="contestant_login"
                        turnstileRef={turnstileRef}
                        onSuccess={handleCaptchaSuccess}
                        onExpire={handleCaptchaExpire}
                        onError={handleCaptchaError}
                      />
                    </Box>
                  ) : (
                    <Box sx={{ color: activeColors.textSecondary, fontSize: 11, fontStyle: 'italic' }}>
                      * captcha checking: disabled
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                    <Button
                      fullWidth
                      onClick={handleClear}
                      sx={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 13,
                        fontWeight: 700,
                        textTransform: 'none',
                        color: activeColors.textSecondary,
                        border: `1px solid ${activeColors.inputBorder}`,
                        bgcolor: theme === 'dark' ? 'rgba(255,255,255,0.05)' : '#fff',
                        py: 1.25,
                        borderRadius: '8px',
                        '&:hover': {
                          bgcolor: activeColors.tagBg,
                          borderColor: activeColors.primary,
                          color: activeColors.primary,
                        },
                      }}
                    >
                      [ CLEAR ]
                    </Button>
                    <Button
                      type="submit"
                      fullWidth
                      disabled={loading}
                      sx={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 13,
                        fontWeight: 800,
                        textTransform: 'none',
                        color: '#fff',
                        bgcolor: activeColors.primary,
                        border: `1px solid ${activeColors.primary}`,
                        py: 1.25,
                        borderRadius: '8px',
                        boxShadow: `0 4px 14px 0 rgba(234, 122, 0, 0.39)`,
                        '&:hover': {
                          bgcolor: activeColors.primaryDark,
                          borderColor: activeColors.primaryDark,
                          boxShadow: `0 6px 20px rgba(234, 122, 0, 0.23)`,
                        },
                        '&:disabled': {
                          bgcolor: theme === 'dark' ? '#374151' : '#f4f4f5',
                          color: theme === 'dark' ? '#9ca3af' : '#a1a1aa',
                          borderColor: theme === 'dark' ? '#4b5563' : '#e4e4e7',
                          boxShadow: 'none',
                        },
                      }}
                    >
                      {loading ? (
                        <CircularProgress size={20} sx={{ color: theme === 'dark' ? '#9ca3af' : '#a1a1aa' }} />
                      ) : (
                        '[ LOGIN ]'
                      )}
                    </Button>
                  </Box>
                </Box>
              </form>
            </Box>

            <Box sx={{ mt: 4, textAlign: 'center', color: activeColors.textSecondary, fontSize: 12 }}>
              <Box sx={{ mb: 1 }}>FPT_University © {new Date().getFullYear()}</Box>
              <Box>
                <span>{registrationEnabled ? 'new_team? ' : 'need_access? '}</span>
                {registrationEnabled ? (
                  <span
                    style={{ color: activeColors.primary, cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }}
                    onClick={() => navigate('/register')}
                  >
                    register_now
                  </span>
                ) : (
                  <span 
                    style={{ color: activeColors.primary, cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }} 
                    onClick={() => navigate('/contact')}
                  >
                    contact_admin
                  </span>
                )}
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box
        component="footer"
        sx={{
          mt: 'auto',
          position: 'sticky',
          bottom: 0,
          zIndex: 20,
          borderTop: `1px solid ${activeColors.border}`,
          bgcolor: theme === 'dark' ? 'rgba(17, 24, 39, 0.75)' : 'rgba(255, 255, 255, 0.75)',
          backdropFilter: 'blur(4px)',
        }}
      >
        <Box
          sx={{
            maxWidth: '1280px',
            mx: 'auto',
            px: { xs: 2, sm: 4 },
            py: 1.8,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Box sx={{ fontSize: 11, color: activeColors.textSecondary }}>
            © {new Date().getFullYear()} Phòng thí nghiệm ATTT — khoa ATTT, FPT University Hà Nội
          </Box>
          <Box sx={{ fontSize: 11, color: activeColors.textSecondary, textAlign: { xs: 'center', sm: 'right' } }}>
            Địa chỉ: Phòng D101 & D102, tòa nhà Delta, Trường Đại học FPT, Cơ sở Hà Nội.
          </Box>
        </Box>
      </Box>
    </div>
  );
}