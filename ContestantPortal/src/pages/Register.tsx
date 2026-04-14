import { useEffect, useState } from 'react';
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
import { Turnstile } from '@marsidev/react-turnstile';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../hooks/useToast';
import { authService } from '../services/authService';
import { configService } from '../services/configService';
import { getTurnstileSiteKey } from '../services/envService';
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
  id: crypto.randomUUID(),
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  userFieldValues: buildFieldDefaults(fields),
});

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
  const { theme } = useTheme();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [metadata, setMetadata] = useState<RegistrationMetadata | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const [teamName, setTeamName] = useState('');
  const [teamEmail, setTeamEmail] = useState('');
  const [teamPassword, setTeamPassword] = useState('');
  const [teamFieldValues, setTeamFieldValues] = useState<Record<number, string | boolean>>({});
  const [members, setMembers] = useState<MemberFormState[]>([]);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaWidgetKey, setCaptchaWidgetKey] = useState(0);
  const turnstileSiteKey = getTurnstileSiteKey();
  const captchaEnabled = turnstileSiteKey.length > 0;

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

  useEffect(() => {
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

        setMetadata(registrationMetadata);
        setTeamFieldValues(buildFieldDefaults(registrationMetadata.teamFields));
        setMembers([createMemberState(registrationMetadata.userFields)]);

        if (publicConfig.ctf_logo) {
          setLogoUrl(publicConfig.ctf_logo);
        }
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

    if (captchaEnabled && !captchaToken) {
      toast.error('Please complete captcha challenge');
      return;
    }

    const payload: RegisterContestantPayload = {
      teamName: teamName.trim(),
      captchaToken: captchaToken ?? undefined,
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

    setSubmitting(true);
    try {
      await authService.registerContestant(payload);
      toast.success('Registration submitted. Please wait for admin verification.');
      navigate('/login', { replace: true });
    } catch (error) {
      setCaptchaToken(null);
      setCaptchaWidgetKey((prev) => prev + 1);
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
        style={{ backgroundColor: colors.bg }}
      >
        <CircularProgress sx={{ color: colors.text }} />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 font-mono"
      style={{ backgroundColor: colors.bg }}
    >
      <Box sx={{ width: '100%', maxWidth: '860px' }}>
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <img
              src={logoUrl || '/assets/fctf-logo.png'}
              alt="logo"
              style={{ maxWidth: '140px' }}
            />
          </Box>
          <Box sx={{ color: colors.text, fontSize: '22px', fontWeight: 700 }}>[TEAM_REGISTRATION]</Box>
          <Box sx={{ color: colors.textSecondary, fontSize: '12px' }}>
            Accounts are created with pending verification status.
          </Box>
        </Box>

        <Box
          sx={{
            border: `1px solid ${colors.border}`,
            bgcolor: colors.bg,
            p: 3,
          }}
        >
          <form onSubmit={handleSubmit}>
            <Box sx={{ mb: 3, color: colors.text, fontSize: '14px' }}>
              <span style={{ color: colors.textMuted }}>$</span> ./register-contestant-team
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
              <TextField
                fullWidth
                required
                label="Team Name"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="Enter team name"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    fontFamily: 'monospace',
                    color: colors.text,
                    '& fieldset': { borderColor: colors.border },
                    '&:hover fieldset': { borderColor: colors.borderLight },
                    '&.Mui-focused fieldset': { borderColor: colors.text },
                  },
                  '& .MuiInputLabel-root': { color: colors.textSecondary },
                }}
              />
              <TextField
                fullWidth
                label="Team Email (optional)"
                value={teamEmail}
                onChange={(event) => setTeamEmail(event.target.value)}
                placeholder="team@example.com"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    fontFamily: 'monospace',
                    color: colors.text,
                    '& fieldset': { borderColor: colors.border },
                    '&:hover fieldset': { borderColor: colors.borderLight },
                    '&.Mui-focused fieldset': { borderColor: colors.text },
                  },
                  '& .MuiInputLabel-root': { color: colors.textSecondary },
                }}
              />
            </Box>

            <Box sx={{ mb: 2 }}>
              <TextField
                fullWidth
                type="password"
                label="Team Password (optional)"
                value={teamPassword}
                onChange={(event) => setTeamPassword(event.target.value)}
                placeholder="If empty, first member password is used"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    fontFamily: 'monospace',
                    color: colors.text,
                    '& fieldset': { borderColor: colors.border },
                    '&:hover fieldset': { borderColor: colors.borderLight },
                    '&.Mui-focused fieldset': { borderColor: colors.text },
                  },
                  '& .MuiInputLabel-root': { color: colors.textSecondary },
                }}
              />
            </Box>

            {metadata && metadata.teamFields.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Box sx={{ color: colors.text, mb: 1, fontWeight: 700 }}>[TEAM_CUSTOM_FIELDS]</Box>
                {metadata.teamFields.map((field) => (
                  <Box key={field.id} sx={{ mb: 1.5 }}>
                    {field.fieldType === 'boolean' ? (
                      <FormControlLabel
                        control={(
                          <Checkbox
                            checked={teamFieldValues[field.id] === true}
                            onChange={(event) => updateTeamField(field.id, event.target.checked)}
                            sx={{ color: colors.text, '&.Mui-checked': { color: colors.text } }}
                          />
                        )}
                        label={`${field.name}${field.required ? ' *' : ''}`}
                        sx={{ color: colors.textSecondary }}
                      />
                    ) : (
                      <TextField
                        fullWidth
                        label={`${field.name}${field.required ? ' *' : ''}`}
                        value={typeof teamFieldValues[field.id] === 'string' ? teamFieldValues[field.id] : ''}
                        onChange={(event) => updateTeamField(field.id, event.target.value)}
                        placeholder={field.description || ''}
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            fontFamily: 'monospace',
                            color: colors.text,
                            '& fieldset': { borderColor: colors.border },
                            '&:hover fieldset': { borderColor: colors.borderLight },
                            '&.Mui-focused fieldset': { borderColor: colors.text },
                          },
                          '& .MuiInputLabel-root': { color: colors.textSecondary },
                        }}
                      />
                    )}
                  </Box>
                ))}
              </Box>
            )}

            <Box sx={{ color: colors.text, mb: 1, fontWeight: 700 }}>[TEAM_MEMBERS]</Box>
            {members.map((member, index) => (
              <Box
                key={member.id}
                sx={{
                  border: `1px solid ${colors.borderLight}`,
                  p: 2,
                  mb: 2,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box sx={{ color: colors.textSecondary, fontWeight: 700 }}>
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
                  <TextField
                    fullWidth
                    required
                    label="Username"
                    value={member.username}
                    onChange={(event) => updateMember(member.id, { username: event.target.value })}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        fontFamily: 'monospace',
                        color: colors.text,
                        '& fieldset': { borderColor: colors.border },
                        '&:hover fieldset': { borderColor: colors.borderLight },
                        '&.Mui-focused fieldset': { borderColor: colors.text },
                      },
                      '& .MuiInputLabel-root': { color: colors.textSecondary },
                    }}
                  />
                  <TextField
                    fullWidth
                    required
                    label="Email"
                    value={member.email}
                    onChange={(event) => updateMember(member.id, { email: event.target.value })}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        fontFamily: 'monospace',
                        color: colors.text,
                        '& fieldset': { borderColor: colors.border },
                        '&:hover fieldset': { borderColor: colors.borderLight },
                        '&.Mui-focused fieldset': { borderColor: colors.text },
                      },
                      '& .MuiInputLabel-root': { color: colors.textSecondary },
                    }}
                  />
                  <TextField
                    fullWidth
                    required
                    type="password"
                    label="Password"
                    value={member.password}
                    onChange={(event) => updateMember(member.id, { password: event.target.value })}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        fontFamily: 'monospace',
                        color: colors.text,
                        '& fieldset': { borderColor: colors.border },
                        '&:hover fieldset': { borderColor: colors.borderLight },
                        '&.Mui-focused fieldset': { borderColor: colors.text },
                      },
                      '& .MuiInputLabel-root': { color: colors.textSecondary },
                    }}
                  />
                  <TextField
                    fullWidth
                    required
                    type="password"
                    label="Confirm Password"
                    value={member.confirmPassword}
                    onChange={(event) => updateMember(member.id, { confirmPassword: event.target.value })}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        fontFamily: 'monospace',
                        color: colors.text,
                        '& fieldset': { borderColor: colors.border },
                        '&:hover fieldset': { borderColor: colors.borderLight },
                        '&.Mui-focused fieldset': { borderColor: colors.text },
                      },
                      '& .MuiInputLabel-root': { color: colors.textSecondary },
                    }}
                  />
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
                                sx={{ color: colors.text, '&.Mui-checked': { color: colors.text } }}
                              />
                            )}
                            label={`${field.name}${field.required ? ' *' : ''}`}
                            sx={{ color: colors.textSecondary }}
                          />
                        ) : (
                          <TextField
                            fullWidth
                            label={`${field.name}${field.required ? ' *' : ''}`}
                            value={typeof member.userFieldValues[field.id] === 'string' ? member.userFieldValues[field.id] : ''}
                            onChange={(event) => updateMemberField(member.id, field.id, event.target.value)}
                            placeholder={field.description || ''}
                            sx={{
                              '& .MuiOutlinedInput-root': {
                                fontFamily: 'monospace',
                                color: colors.text,
                                '& fieldset': { borderColor: colors.border },
                                '&:hover fieldset': { borderColor: colors.borderLight },
                                '&.Mui-focused fieldset': { borderColor: colors.text },
                              },
                              '& .MuiInputLabel-root': { color: colors.textSecondary },
                            }}
                          />
                        )}
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            ))}

            <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
              <Button
                type="button"
                onClick={addMember}
                startIcon={<Add />}
                sx={{
                  fontFamily: 'monospace',
                  textTransform: 'none',
                  color: colors.textSecondary,
                  border: `1px solid ${colors.borderLight}`,
                  '&:hover': { borderColor: colors.text, color: colors.text },
                }}
              >
                Add Member
              </Button>

              {captchaEnabled ? (
                <Box sx={{ ml: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
                  <Turnstile
                    key={captchaWidgetKey}
                    siteKey={turnstileSiteKey}
                    onSuccess={(token) => setCaptchaToken(token)}
                    onExpire={() => setCaptchaToken(null)}
                    onError={() => {
                      setCaptchaToken(null);
                      setCaptchaWidgetKey((prev) => prev + 1);
                      toast.error('Captcha verification failed. Please retry.');
                    }}
                    options={{
                      theme: isDark ? 'dark' : 'light',
                      action: 'contestant_register',
                    }}
                  />
                </Box>
              ) : (
                <Box sx={{ ml: 'auto', color: colors.textMuted, fontSize: '11px', alignSelf: 'center' }}>
                  captcha: disabled
                </Box>
              )}

              <Button
                type="submit"
                disabled={submitting}
                sx={{
                  fontFamily: 'monospace',
                  textTransform: 'none',
                  color: isDark ? '#000' : '#fff',
                  bgcolor: '#fb923c',
                  border: '1px solid #fb923c',
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
                {submitting ? <CircularProgress size={20} sx={{ color: isDark ? '#3f3f46' : '#a1a1aa' }} /> : '[SUBMIT_FOR_REVIEW]'}
              </Button>
            </Box>
          </form>
        </Box>
      </Box>
    </div>
  );
}
