import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  TextField,
} from '@mui/material';
import { Add, Delete } from '@mui/icons-material';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { useToast } from '../hooks/useToast';
import { authService } from '../services/authService';
import { configService } from '../services/configService';
import { getTurnstileSiteKey } from '../services/envService';
import { AuthTurnstile } from '../components/AuthTurnstile';
import type {
  RegisterContestantPayload,
  RegistrationFieldDefinition,
  RegistrationFieldValue,
  RegistrationMetadata,
} from '../models/registration.model';

interface MemberFormState {
  id: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  userFieldValues: Record<number, string | boolean>;
}

const buildFieldDefaults = (fields: RegistrationFieldDefinition[]): Record<number, string | boolean> => {
  const result: Record<number, string | boolean> = {};
  fields.forEach((field) => {
    result[field.id] = field.fieldType === 'boolean' ? false : '';
  });
  return result;
};

const createMemberState = (fields: RegistrationFieldDefinition[]): MemberFormState => ({
  id: createMemberId(),
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  userFieldValues: buildFieldDefaults(fields),
});

const createMemberId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `member-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const buildFieldPayload = (
  fields: RegistrationFieldDefinition[],
  values: Record<number, string | boolean>
): RegistrationFieldValue[] => {
  return fields.flatMap<RegistrationFieldValue>((field) => {
    const value = values[field.id];

    if (field.fieldType === 'boolean') {
      const boolValue = value === true;
      if (!boolValue && !field.required) {
        return [];
      }
      return [{ fieldId: field.id, value: boolValue }];
    }

    const textValue = typeof value === 'string' ? value.trim() : '';
    if (!textValue && !field.required) {
      return [];
    }
    return [{ fieldId: field.id, value: textValue }];
  });
};

export function Register() {
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [metadata, setMetadata] = useState<RegistrationMetadata | null>(null);

  const [teamName, setTeamName] = useState('');
  const [teamEmail, setTeamEmail] = useState('');
  const [teamPassword, setTeamPassword] = useState('');
  const [teamFieldValues, setTeamFieldValues] = useState<Record<number, string | boolean>>({});
  const [members, setMembers] = useState<MemberFormState[]>([]);
  const captchaTokenRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const lastCaptchaErrorAtRef = useRef(0);
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const turnstileSiteKey = getTurnstileSiteKey();
  const captchaEnabled = turnstileSiteKey.length > 0;

  const colors = {
    pageBg: '#f6f5f3',
    panelBg: '#ffffff',
    border: '#ece7df',
    borderLight: '#e7dfd1',
    text: '#121212',
    textSecondary: '#6b7280',
    textMuted: '#6b7280',
    inputBg: '#fffcf8',
    primary: '#ea7a00',
    primaryDark: '#d86600',
  };

  const textFieldSx = {
    '& .MuiOutlinedInput-root': {
      fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
      fontSize: 13,
      bgcolor: colors.inputBg,
      color: colors.text,
      borderRadius: '8px',
      '& fieldset': {
        borderColor: colors.borderLight,
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
  };

  const secondaryButtonSx = {
    fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
    fontSize: 13,
    textTransform: 'none',
    color: colors.textSecondary,
    border: `1px solid ${colors.borderLight}`,
    bgcolor: '#fff',
    py: 1.2,
    '&:hover': {
      bgcolor: '#fff7ec',
      borderColor: colors.primary,
      color: colors.primary,
    },
  };

  const primaryButtonSx = {
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
  };

  const yieldToBrowser = useCallback(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }, []);

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

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;

    const loadData = async () => {
      try {
        const publicConfig = await configService.getPublicConfig(true);

        if (!publicConfig) {
          toast.error('Unable to load registration configuration');
          navigate('/login', { replace: true });
          return;
        }

        if (!publicConfig.contestant_registration_enabled) {
          toast.error('Registration is currently disabled');
          navigate('/login', { replace: true });
          return;
        }

        const registrationMetadata = await authService.getRegistrationMetadata();

        const normalizedMetadata: RegistrationMetadata = {
          userFields: Array.isArray(registrationMetadata.userFields) ? registrationMetadata.userFields.filter(Boolean) : [],
          teamFields: Array.isArray(registrationMetadata.teamFields) ? registrationMetadata.teamFields.filter(Boolean) : [],
          constraints: {
            teamSizeLimit: Number(registrationMetadata.constraints?.teamSizeLimit ?? 0),
            numTeamsLimit: Number(registrationMetadata.constraints?.numTeamsLimit ?? 0),
            numUsersLimit: Number(registrationMetadata.constraints?.numUsersLimit ?? 0),
          },
        };

        setMetadata(normalizedMetadata);
        setTeamFieldValues(buildFieldDefaults(normalizedMetadata.teamFields));
        setMembers([createMemberState(normalizedMetadata.userFields)]);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unable to load registration form';
        toast.error(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [navigate, toast]);

  const updateTeamField = (fieldId: number, value: string | boolean) => {
    setTeamFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const updateMember = (memberId: string, patch: Partial<MemberFormState>) => {
    setMembers((prev) =>
      prev.map((member) => (member.id === memberId ? { ...member, ...patch } : member))
    );
  };

  const updateMemberField = (memberId: string, fieldId: number, value: string | boolean) => {
    setMembers((prev) =>
      prev.map((member) => {
        if (member.id !== memberId) {
          return member;
        }

        return {
          ...member,
          userFieldValues: {
            ...member.userFieldValues,
            [fieldId]: value,
          },
        };
      })
    );
  };

  const addMember = () => {
    if (!metadata) {
      return;
    }

    const teamSizeLimit = metadata.constraints.teamSizeLimit;
    if (teamSizeLimit > 0 && members.length >= teamSizeLimit) {
      toast.warning(`Team size is limited to ${teamSizeLimit} member(s)`);
      return;
    }

    setMembers((prev) => [...prev, createMemberState(metadata.userFields)]);
  };

  const removeMember = (memberId: string) => {
    if (members.length <= 1) {
      return;
    }

    setMembers((prev) => prev.filter((member) => member.id !== memberId));
  };

  const validateForm = (): string | null => {
    if (!metadata) {
      return 'Registration metadata is not available';
    }

    if (!teamName.trim()) {
      return 'Team name is required';
    }

    if (members.length === 0) {
      return 'At least one team member is required';
    }

    const teamSizeLimit = metadata.constraints.teamSizeLimit;
    if (teamSizeLimit > 0 && members.length > teamSizeLimit) {
      return `Team size cannot exceed ${teamSizeLimit}`;
    }

    for (const field of metadata.teamFields) {
      const value = teamFieldValues[field.id];
      if (!field.required) {
        continue;
      }

      if (field.fieldType === 'boolean' && value !== true) {
        return `Team field '${field.name}' must be accepted`;
      }

      if (field.fieldType === 'text' && (typeof value !== 'string' || !value.trim())) {
        return `Team field '${field.name}' is required`;
      }
    }

    for (const member of members) {
      if (!member.username.trim() || !member.email.trim() || !member.password || !member.confirmPassword) {
        return 'Each member must provide username, email, and password';
      }

      if (member.password !== member.confirmPassword) {
        return `Password confirmation does not match for member '${member.username || 'unknown'}'`;
      }

      for (const field of metadata.userFields) {
        const value = member.userFieldValues[field.id];
        if (!field.required) {
          continue;
        }

        if (field.fieldType === 'boolean' && value !== true) {
          return `User field '${field.name}' must be accepted for member '${member.username || 'unknown'}'`;
        }

        if (field.fieldType === 'text' && (typeof value !== 'string' || !value.trim())) {
          return `User field '${field.name}' is required for member '${member.username || 'unknown'}'`;
        }
      }
    }

    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (!metadata) {
      toast.error('Registration metadata is not available');
      return;
    }

    if (captchaEnabled && !captchaTokenRef.current) {
      toast.error('Please complete captcha challenge');
      return;
    }

    setSubmitting(true);
    await yieldToBrowser();

    const payload: RegisterContestantPayload = {
      teamName: teamName.trim(),
      captchaToken: captchaTokenRef.current ?? undefined,
      teamFields: buildFieldPayload(metadata.teamFields, teamFieldValues),
      members: members.map((member) => ({
        username: member.username.trim(),
        email: member.email.trim(),
        password: member.password,
        confirmPassword: member.confirmPassword,
        userFields: buildFieldPayload(metadata.userFields, member.userFieldValues),
      })),
    };

    const normalizedTeamEmail = teamEmail.trim();
    if (normalizedTeamEmail) {
      payload.teamEmail = normalizedTeamEmail;
    }

    const normalizedTeamPassword = teamPassword.trim();
    if (normalizedTeamPassword) {
      payload.teamPassword = normalizedTeamPassword;
    }

    try {
      await authService.registerContestant(payload);
      toast.success('Registration submitted. Please wait for admin verification.');
      navigate('/login', { replace: true });
    } catch (error) {
      resetCaptcha();
      const errorMessage = error instanceof Error ? error.message : 'Registration failed';
      toast.error(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: colors.pageBg }}
      >
        <CircularProgress sx={{ color: colors.text }} />
      </div>
    );
  }

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
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 2.5, sm: 4 } }}>
        <Box sx={{ width: '100%', maxWidth: '960px' }}>
          <Box sx={{ maxWidth: '960px', mx: 'auto' }}>
            <Box sx={{ mb: 3, textAlign: 'center' }}>
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2,
                  py: 0.75,
                  borderRadius: '999px',
                  border: `1px solid ${colors.borderLight}`,
                  bgcolor: '#fff7ec',
                  color: colors.primary,
                  fontSize: 13,
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
                Faculty of Information Assurance
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
                Register a contestant team for the FPT Capture The Flag platform
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
                REGISTRATION
              </Box>

              <form onSubmit={handleSubmit}>
                <Box sx={{ mb: 2.5, color: colors.text, fontSize: 14 }}>
                  <span style={{ color: colors.textMuted }}>$</span> ./register-contestant-team
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.25, mb: 2.25 }}>
                  <Box>
                    <Box sx={{ mb: 0.75, fontSize: 12, color: colors.textSecondary }}>Team Name</Box>
                    <TextField
                      fullWidth
                      required
                      value={teamName}
                      onChange={(event) => setTeamName(event.target.value)}
                      placeholder="input team name..."
                      sx={textFieldSx}
                    />
                  </Box>
                  <Box>
                    <Box sx={{ mb: 0.75, fontSize: 12, color: colors.textSecondary }}>Team Email (optional)</Box>
                    <TextField
                      fullWidth
                      value={teamEmail}
                      onChange={(event) => setTeamEmail(event.target.value)}
                      placeholder="team@example.com"
                      sx={textFieldSx}
                    />
                  </Box>
                </Box>

                <Box sx={{ mb: 2.25 }}>
                  <Box sx={{ mb: 0.75, fontSize: 12, color: colors.textSecondary }}>Team Password (optional)</Box>
                  <TextField
                    fullWidth
                    type="password"
                    value={teamPassword}
                    onChange={(event) => setTeamPassword(event.target.value)}
                    placeholder="leave blank to use captain password"
                    sx={textFieldSx}
                  />
                </Box>

                {metadata && metadata.teamFields.length > 0 && (
                  <Box sx={{ mb: 3 }}>
                    <Box sx={{ mb: 1.25, color: colors.primary, fontSize: 14, fontWeight: 700 }}>
                      TEAM CUSTOM FIELDS
                    </Box>
                    {metadata.teamFields.map((field) => (
                      <Box key={field.id} sx={{ mb: 1.5 }}>
                        {field.fieldType === 'boolean' ? (
                          <FormControlLabel
                            control={(
                              <Checkbox
                                checked={teamFieldValues[field.id] === true}
                                onChange={(event) => updateTeamField(field.id, event.target.checked)}
                                sx={{
                                  color: colors.primary,
                                  '&.Mui-checked': { color: colors.primary },
                                }}
                              />
                            )}
                            label={`${field.name}${field.required ? ' *' : ''}`}
                            sx={{
                              color: colors.textSecondary,
                              '& .MuiTypography-root': {
                                fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
                                fontSize: 12,
                              },
                            }}
                          />
                        ) : (
                          <>
                            <Box sx={{ mb: 0.75, fontSize: 12, color: colors.textSecondary }}>
                              {field.name}{field.required ? ' *' : ''}
                            </Box>
                            <TextField
                              fullWidth
                              value={typeof teamFieldValues[field.id] === 'string' ? teamFieldValues[field.id] : ''}
                              onChange={(event) => updateTeamField(field.id, event.target.value)}
                              placeholder={field.description || ''}
                              sx={textFieldSx}
                            />
                          </>
                        )}
                      </Box>
                    ))}
                  </Box>
                )}

                <Box sx={{ mb: 1.25, color: colors.primary, fontSize: 14, fontWeight: 700 }}>
                  TEAM MEMBERS
                </Box>
                {members.map((member, index) => (
                  <Box
                    key={member.id}
                    sx={{
                      border: `1px solid ${colors.borderLight}`,
                      borderRadius: '8px',
                      p: 2,
                      mb: 2,
                      bgcolor: '#fffcf8',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
                      <Box sx={{ color: colors.textSecondary, fontWeight: 700, fontSize: 12 }}>
                        MEMBER #{index + 1}{index === 0 ? ' (CAPTAIN)' : ''}
                      </Box>
                      {members.length > 1 && (
                        <IconButton
                          onClick={() => removeMember(member.id)}
                          sx={{ color: '#ef4444' }}
                          aria-label="remove-member"
                        >
                          <Delete />
                        </IconButton>
                      )}
                    </Box>

                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
                      <Box>
                        <Box sx={{ mb: 0.75, fontSize: 12, color: colors.textSecondary }}>Username</Box>
                        <TextField
                          fullWidth
                          required
                          value={member.username}
                          onChange={(event) => updateMember(member.id, { username: event.target.value })}
                          placeholder="input username..."
                          sx={textFieldSx}
                        />
                      </Box>
                      <Box>
                        <Box sx={{ mb: 0.75, fontSize: 12, color: colors.textSecondary }}>Email</Box>
                        <TextField
                          fullWidth
                          required
                          value={member.email}
                          onChange={(event) => updateMember(member.id, { email: event.target.value })}
                          placeholder="member@example.com"
                          sx={textFieldSx}
                        />
                      </Box>
                      <Box>
                        <Box sx={{ mb: 0.75, fontSize: 12, color: colors.textSecondary }}>Password</Box>
                        <TextField
                          fullWidth
                          required
                          type="password"
                          value={member.password}
                          onChange={(event) => updateMember(member.id, { password: event.target.value })}
                          placeholder="enter_password"
                          sx={textFieldSx}
                        />
                      </Box>
                      <Box>
                        <Box sx={{ mb: 0.75, fontSize: 12, color: colors.textSecondary }}>Confirm Password</Box>
                        <TextField
                          fullWidth
                          required
                          type="password"
                          value={member.confirmPassword}
                          onChange={(event) => updateMember(member.id, { confirmPassword: event.target.value })}
                          placeholder="confirm_password"
                          sx={textFieldSx}
                        />
                      </Box>
                    </Box>

                    {metadata && metadata.userFields.length > 0 && (
                      <Box>
                        {metadata.userFields.map((field) => (
                          <Box key={`${member.id}-${field.id}`} sx={{ mb: 1.5 }}>
                            {field.fieldType === 'boolean' ? (
                              <FormControlLabel
                                control={(
                                  <Checkbox
                                    checked={member.userFieldValues[field.id] === true}
                                    onChange={(event) => updateMemberField(member.id, field.id, event.target.checked)}
                                    sx={{
                                      color: colors.primary,
                                      '&.Mui-checked': { color: colors.primary },
                                    }}
                                  />
                                )}
                                label={`${field.name}${field.required ? ' *' : ''}`}
                                sx={{
                                  color: colors.textSecondary,
                                  '& .MuiTypography-root': {
                                    fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
                                    fontSize: 12,
                                  },
                                }}
                              />
                            ) : (
                              <>
                                <Box sx={{ mb: 0.75, fontSize: 12, color: colors.textSecondary }}>
                                  {field.name}{field.required ? ' *' : ''}
                                </Box>
                                <TextField
                                  fullWidth
                                  value={typeof member.userFieldValues[field.id] === 'string' ? member.userFieldValues[field.id] : ''}
                                  onChange={(event) => updateMemberField(member.id, field.id, event.target.value)}
                                  placeholder={field.description || ''}
                                  sx={textFieldSx}
                                />
                              </>
                            )}
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                ))}

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 2.5, alignItems: 'center' }}>
                  <Button type="button" onClick={() => navigate('/login')} sx={secondaryButtonSx}>
                    [BACK_TO_LOGIN]
                  </Button>
                  <Button type="button" onClick={addMember} startIcon={<Add />} sx={secondaryButtonSx}>
                    [ADD_MEMBER]
                  </Button>

                  {captchaEnabled ? (
                    <Box sx={{ ml: { xs: 0, md: 'auto' }, width: { xs: '100%', md: 350 } }}>
                      <AuthTurnstile
                        siteKey={turnstileSiteKey}
                        action="contestant_register"
                        turnstileRef={turnstileRef}
                        onSuccess={handleCaptchaSuccess}
                        onExpire={handleCaptchaExpire}
                        onError={handleCaptchaError}
                      />
                    </Box>
                  ) : (
                    <Box sx={{ ml: { xs: 0, md: 'auto' }, color: colors.textMuted, fontSize: 11, alignSelf: 'center' }}>
                      captcha: disabled
                    </Box>
                  )}

                  <Button
                    type="submit"
                    disabled={submitting}
                    sx={{
                      ...primaryButtonSx,
                      minWidth: { xs: '100%', sm: '220px' },
                    }}
                  >
                    {submitting ? <CircularProgress size={20} sx={{ color: '#a1a1aa' }} /> : '[SUBMIT_FOR_REVIEW]'}
                  </Button>
                </Box>
              </form>
            </Box>

            <Box sx={{ mt: 3, textAlign: 'center', color: colors.textSecondary, fontSize: 11 }}>
              <Box>FPT_University © {new Date().getFullYear()}</Box>
              <Box sx={{ mt: 1 }}>
                <span style={{ color: colors.textSecondary }}>already_have_account?</span>{' '}
                <span style={{ color: colors.text, cursor: 'pointer' }} onClick={() => navigate('/login')}>
                  login_now
                </span>
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
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Box sx={{ fontSize: 11, color: 'rgba(107,114,128,0.75)' }}>
            © 2026 Khoa An toàn Thông tin — FPT University Hà Nội
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: 11, color: 'rgba(107,114,128,0.55)' }}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19h8" />
              <path d="m4 17 6-6-6-6" />
            </svg>
            FUHL Portal v2.0
          </Box>
        </Box>
      </Box>
    </div>
  );
}
