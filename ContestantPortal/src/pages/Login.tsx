import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import { Box, TextField, Button, CircularProgress } from '@mui/material';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { configService } from '../services/configService';
import { getTurnstileSiteKey } from '../services/envService';
import { AuthTurnstile } from '../components/AuthTurnstile';

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

  const colors = {
    pageBg: '#f6f5f3',
    panelBg: '#ffffff',
    border: '#ece7df',
    primary: '#ea7a00',
    primaryDark: '#d86600',
    text: '#121212',
    textSecondary: '#6b7280',
    inputBg: '#fffcf8',
    inputBorder: '#e7dfd1',
  };

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
      // after authentication, go directly to the challenges page
      navigate('/challenges');
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
    document.title = 'IA-lab | Phòng thí nghiệm AATT - khoa AATT, FPT University Hà Nội';

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
        backgroundColor: colors.pageBg,
        backgroundImage:
          'linear-gradient(to right, rgba(234,122,0,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(234,122,0,0.08) 1px, transparent 1px)',
        backgroundSize: '36px 36px',
      }}
    >


      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Box sx={{ width: '100%', maxWidth: '960px' }}>
          <Box sx={{ maxWidth: '460px', mx: 'auto' }}>
            <Box sx={{ mb: 3, textAlign: 'center' }}>
              <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                <Box
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                    px: 2,
                    py: 0.75,
                    borderRadius: '999px',
                    border: `1px solid ${colors.inputBorder}`,
                    bgcolor: '#fff7ec',
                    color: colors.primary,
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                    width: 'max-content',
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                  </svg>
                  IA-Lab — Faculty of Information Assurance · FPT University Hà Nội
                </Box>
              </Box>

              <Box sx={{ mt: 2, fontSize: 36, fontWeight: 700, lineHeight: 1.2 }}>
                <span
                  className="text-gradient-amber"
                  style={{
                    background: 'linear-gradient(135deg,#f59e0b 0%,#ea580c 50%,#dc2626 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    fontSize: 60,
                    fontWeight: 800,
                    color: 'transparent',
                    fontFamily: 'var(--font-mono), "JetBrains Mono", ui-monospace, monospace',
                  }}
                >
                  Sân Chơi
                </span>
              </Box>
              <Box sx={{ mt: 1, color: colors.textSecondary, fontSize: 14 }}>
                Authenticate to enter the FPT Capture The Flag platform
              </Box>
            </Box>

            <Box
              sx={{
                border: `1px solid ${colors.border}`,
                bgcolor: colors.panelBg,
                p: 3.5,
                borderRadius: '10px',
                boxShadow: '0 18px 45px rgba(17, 24, 39, 0.08)',
              }}
            >
              <Box sx={{ mb: 2.5, color: colors.primary, fontSize: 14, fontWeight: 700 }}>
                AUTHENTICATION
              </Box>

              <form onSubmit={handleSubmit}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ mb: 0.75, fontSize: 12, color: colors.textSecondary }}>
                      Username
                    </Box>
                    <TextField
                      fullWidth
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={loading}
                      placeholder="input_username"
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
                          fontSize: 13,
                          bgcolor: colors.inputBg,
                          color: colors.text,
                          borderRadius: '8px',
                          '& fieldset': {
                            borderColor: colors.inputBorder,
                          },
                          '&:hover fieldset': {
                            borderColor: colors.primary,
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: colors.primary,
                            borderWidth: '1px',
                          },
                        },
                        '& .MuiInputBase-input::placeholder': {
                          color: colors.textSecondary,
                          opacity: 1,
                        },
                      }}
                    />
                  </Box>

                  <Box>
                    <Box sx={{ mb: 0.75, color: colors.textSecondary, fontSize: 12 }}>
                      Password
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
                          fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
                          fontSize: 13,
                          color: colors.text,
                          bgcolor: colors.inputBg,
                          borderRadius: '8px',
                          '& fieldset': {
                            borderColor: colors.inputBorder,
                          },
                          '&:hover fieldset': {
                            borderColor: colors.primary,
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: colors.primary,
                            borderWidth: '1px',
                          },
                          '& input::placeholder': {
                            color: colors.textSecondary,
                            opacity: 1,
                          },
                        },
                      }}
                    />
                  </Box>

                  {captchaEnabled ? (
                    <Box>
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
                    <Box sx={{ color: colors.textSecondary, fontSize: 11 }}>
                      captcha: disabled
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                    <Button
                      fullWidth
                      onClick={handleClear}
                      sx={{
                        fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
                        fontSize: 13,
                        textTransform: 'none',
                        color: colors.textSecondary,
                        border: `1px solid ${colors.inputBorder}`,
                        bgcolor: '#fff',
                        py: 1.2,
                        '&:hover': {
                          bgcolor: '#fff7ec',
                          borderColor: colors.primary,
                          color: colors.primary,
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
                        fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
                        fontSize: 13,
                        textTransform: 'none',
                        color: '#fff',
                        bgcolor: colors.primary,
                        border: `1px solid ${colors.primary}`,
                        py: 1.2,
                        '&:hover': {
                          bgcolor: colors.primaryDark,
                          borderColor: colors.primaryDark,
                        },
                        '&:disabled': {
                          bgcolor: '#f4f4f5',
                          color: '#a1a1aa',
                          borderColor: '#e4e4e7',
                        },
                      }}
                    >
                      {loading ? (
                        <CircularProgress size={20} sx={{ color: '#a1a1aa' }} />
                      ) : (
                        '[LOGIN]'
                      )}
                    </Button>
                  </Box>
                </Box>
              </form>


            </Box>

            <Box sx={{ mt: 3, textAlign: 'center', color: colors.textSecondary, fontSize: 11 }}>
              <Box>FPT_University © {new Date().getFullYear()}</Box>
              <Box sx={{ mt: 1 }}>
                <span style={{ color: colors.textSecondary }}>
                  {registrationEnabled ? 'new_team?' : 'need_access?'}
                </span>{' '}
                {registrationEnabled ? (
                  <span
                    style={{ color: colors.text, cursor: 'pointer' }}
                    onClick={() => navigate('/register')}
                  >
                    register_now
                  </span>
                ) : (
                  <span style={{ color: colors.text, cursor: 'pointer' }} onClick={() => navigate('/contact')}>
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
          borderTop: `1px solid ${colors.border}`,
          bgcolor: 'rgba(255,255,255,0.75)',
          backdropFilter: 'blur(4px)',
        }}
      >
        <Box
          sx={{
            maxWidth: '1120px',
            mx: 'auto',
            px: { xs: 2, sm: 3, lg: 4 },
            py: 1.8,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'center', sm: 'center' },
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Box sx={{ fontSize: 11, color: 'rgba(107,114,128,0.75)' }}>
            © 2026 Phòng thí nghiệm ATTT — khoa ATTT, FPT University Hà Nội
          </Box>
          <Box sx={{ fontSize: 11, color: 'rgba(107,114,128,0.55)', textAlign: { xs: 'center', sm: 'right' } }}>
            Địa chỉ: Phòng D101 & D102, tòa nhà Delta, Trường Đại học FPT, Cơ sở Hà Nội.
          </Box>
        </Box>
      </Box>
    </div>
  );
}