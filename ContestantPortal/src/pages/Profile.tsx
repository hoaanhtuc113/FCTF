import { useEffect, useState } from 'react';
import { 
  Typography, 
  CircularProgress, 
  Box,
  Avatar
} from '@mui/material';
import {
  Lock,
  EmojiEvents,
  People,
  TrendingUp,
  Close,
  Visibility,
  VisibilityOff,
  CheckCircle,
  Cancel,
  Email
} from '@mui/icons-material';
import { FaTrophy } from 'react-icons/fa';
import Swal from 'sweetalert2';
import { useTheme } from '../context/ThemeContext';
import { fetchWithAuth } from '../services/api';
import { API_ENDPOINTS } from '../config/endpoints';

interface UserInfo {
  username: string;
  email: string;
  team: string;
  score?: number;
}

interface TeamPointInfo {
  place: number;
  score: number;
  challengeTotalScore: number;
  members: TeamMember[];
}

interface TeamMember {
  name: string;
  email: string;
  score: number;
}

interface TeamPerformance {
  challenge: {
    name: string;
    category: string;
  };
  type: 'correct' | 'fail';
  timestamp: string;
}

interface PasswordData {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface PasswordCriteria {
  minLength: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  specialChar: boolean;
}

export function Profile() {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [userInfo, setUserInfo] = useState<UserInfo>({
    username: '',
    email: '',
    team: '',
  });
  const [teamPointInfo, setTeamPointInfo] = useState<TeamPointInfo>({
    place: 0,
    score: 0,
    challengeTotalScore: 0,
    members: [],
  });
  const [teamPerformance, setTeamPerformance] = useState<TeamPerformance[]>([]);
  const [finishPercent, setFinishPercent] = useState(0);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordData, setPasswordData] = useState<PasswordData>({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordCriteria, setPasswordCriteria] = useState<PasswordCriteria>({
    minLength: false,
    uppercase: false,
    lowercase: false,
    number: false,
    specialChar: false,
  });
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchUserInfo(),
        fetchTeamPointInfo(),
        fetchTeamPerformance(),
      ]);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserInfo = async () => {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.USER.PROFILE, {
        method: 'GET',
      });
      const data = await response.json();
      if (data.data) {
        setUserInfo(data.data);
      }
    } catch (error) {
      console.error('Error fetching user info:', error);
    }
  };

  const fetchTeamPointInfo = async () => {
    try {
      const response = await fetchWithAuth('/team/contestant', {
        method: 'GET',
      });
      const data = await response.json();
      if (data.data) {
        setTeamPointInfo(data.data);
        const percent = (data.data.score / data.data.challengeTotalScore) * 100;
        setFinishPercent(Math.min(100, Math.max(0, percent)));
      }
    } catch (error) {
      console.error('Error fetching team points:', error);
    }
  };

  const fetchTeamPerformance = async () => {
    try {
      const response = await fetchWithAuth('/team/solves', {
        method: 'GET',
      });
      const data = await response.json();
      if (data.data) {
        setTeamPerformance(data.data);
      }
    } catch (error) {
      console.error('Error fetching team performance:', error);
    }
  };

  const validatePassword = (password: string) => {
    const criteria = {
      minLength: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /\d/.test(password),
      specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    };
    setPasswordCriteria(criteria);
  };

  const handlePasswordInputChange = (field: keyof PasswordData, value: string) => {
    setPasswordData(prev => ({ ...prev, [field]: value }));
    if (field === 'newPassword') {
      validatePassword(value);
    }
  };

  const handleChangePassword = async () => {
    const { oldPassword, newPassword, confirmPassword } = passwordData;

    if (!oldPassword || !newPassword || !confirmPassword) {
      showAlert('All fields are required!', 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      showAlert('New password and confirm password do not match!', 'error');
      return;
    }

    if (newPassword.length < 8) {
      showAlert('New password must be at least 8 characters long.', 'error');
      return;
    }

    setIsChangingPassword(true);
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.USER.PROFILE, {
        method: 'PATCH',
        body: JSON.stringify({
          password: newPassword,
          confirm: oldPassword,
        }),
      });

      const data = await response.json();

      if (data.success) {
        showAlert('Password updated successfully!', 'success');
        setShowPasswordModal(false);
        setPasswordData({
          oldPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
      } else {
        showAlert(data.errors || 'Unexpected error occurred.', 'error');
      }
    } catch (error: any) {
      if (error.response) {
        const { status, data } = error.response;
        if (status === 400 && data?.errors) {
          handlePasswordErrors(data.errors);
        } else {
          showAlert('An unexpected error occurred.', 'error');
        }
      } else {
        showAlert('A network error occurred. Please check your connection.', 'error');
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handlePasswordErrors = (errors: any) => {
    const errorMessage = typeof errors === 'string' ? errors : errors.confirm || 'An error occurred';
    
    switch (errorMessage) {
      case "Both 'password' and 'confirm' fields are required.":
        showAlert('Please provide both current and new passwords.', 'error');
        break;
      case 'Password does not meet the required criteria.':
        showAlert(
          'Your new password doesn\'t match the required criteria. ' +
          'It must contain at least one letter (uppercase or lowercase), ' +
          'at least one digit, at least one special character (@$!%*#?&), ' +
          'and be at least 8 characters long.',
          'error'
        );
        break;
      case 'Password and confirm must not be the same.':
        showAlert('New password must be different from old password.', 'error');
        break;
      case 'Authentication failed.':
        showAlert('Authentication failed. Please log in again.', 'error');
        break;
      default:
        showAlert(errorMessage, 'error');
    }
  };

  const showAlert = (message: string, icon: 'success' | 'error' | 'info') => {
    const prefix = icon === 'success' ? '[+]' : icon === 'error' ? '[!]' : '[i]';
    const color = icon === 'success' ? 'text-green-400' : icon === 'error' ? 'text-red-400' : 'text-orange-400';
    const borderColor = icon === 'success' ? 'border-green-500/30' : icon === 'error' ? 'border-red-500/30' : 'border-orange-500/30';
    
    Swal.fire({
      html: `
        <div class="font-mono text-left text-sm">
          <div class="${color} mb-2">${prefix} ${message}</div>
        </div>
      `,
      icon: icon,
      background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
      timer: icon === 'success' ? 2000 : undefined,
      showConfirmButton: icon !== 'success',
      confirmButtonText: 'OK',
      customClass: {
        popup: `rounded-lg border ${borderColor}`,
        confirmButton: 'bg-gray-600 hover:bg-gray-700 text-white font-mono px-4 py-2 rounded',
      },
    });
  };

  const getPasswordStrength = () => {
    const validCriteria = Object.values(passwordCriteria).filter(Boolean).length;
    if (validCriteria <= 2) return { label: 'Weak', color: 'error', value: 33 };
    if (validCriteria <= 4) return { label: 'Medium', color: 'warning', value: 66 };
    return { label: 'Strong', color: 'success', value: 100 };
  };

  if (loading) {
    return (
      <Box className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-orange-500 text-6xl mb-4 font-mono">[...]</div>
        <Typography className={`font-mono ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
          Loading profile...
        </Typography>
      </Box>
    );
  }

  const passwordStrength = getPasswordStrength();

  return (
    <div className="min-h-[70vh]">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Profile Card */}
        <div className="lg:col-span-1">
          <div className={`rounded-lg border p-8 flex flex-col items-center ${
            theme === 'dark'
              ? 'bg-gray-900 border-gray-700'
              : 'bg-white border-gray-200'
          }`}>
            <div className="w-full flex flex-col items-center">
              {/* Avatar */}
              <div className="relative mb-4">
                <Avatar
                  sx={{
                    width: 120,
                    height: 120,
                    bgcolor: 'gray',
                    fontSize: '3rem',
                    border: '2px solid',
                    borderColor: theme === 'dark' ? '#4b5563' : '#9ca3af',
                  }}
                >
                  {userInfo.username.charAt(0).toUpperCase()}
                </Avatar>
                <div className="absolute bottom-0 right-0 w-8 h-8 bg-green-500 rounded-full border-4 border-gray-800 flex items-center justify-center">
                  <div className="w-3 h-3 bg-white rounded-full" />
                </div>
              </div>

              {/* User Info */}
              <div className="text-center mb-4 w-full">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <h2 className={`text-2xl font-bold font-mono ${
                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                  }`}>
                    {userInfo.username}
                  </h2>
                </div>
                
                <div className={`flex items-center justify-center gap-2 text-sm mb-2 ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  <Email sx={{ fontSize: 16 }} />
                  <span className="font-mono">{userInfo.email}</span>
                </div>

                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded border font-mono text-sm ${
                  theme === 'dark' ? 'border-gray-700 text-gray-300' : 'border-gray-300 text-gray-700'
                }`}>
                  <People sx={{ fontSize: 16 }} />
                  {userInfo.team || 'No Team'}
                </div>
              </div>

              {/* Change Password Button */}
              <button
                onClick={() => setShowPasswordModal(true)}
                className={`w-full mt-4 flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-bold font-mono transition-all ${
                  theme === 'dark'
                    ? 'bg-gray-700 hover:bg-gray-600 text-white border border-gray-600'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-800 border border-gray-300'
                }`}
              >
                <Lock />
                {'[>]'} CHANGE PASSWORD
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Stats & Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Team Ranking & Progress */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Team Ranking */}
            <div
              className={`rounded-lg border p-6 ${
                theme === 'dark'
                  ? 'bg-gray-900 border-gray-700'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <FaTrophy className="text-yellow-500 text-2xl" />
                  <span className={`font-bold font-mono ${
                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                  }`}>
                    [TEAM_RANKING]
                  </span>
                </div>

                <div className="flex items-baseline gap-2 mb-4">
                  <div className={`text-6xl font-extrabold font-mono ${
                    teamPointInfo.place === 1 ? 'text-yellow-500' :
                    teamPointInfo.place === 2 ? 'text-gray-400' :
                    teamPointInfo.place === 3 ? 'text-orange-700' : 'text-orange-500'
                  }`}>
                    #{teamPointInfo.place}
                  </div>
                  <div className={`text-xl font-mono ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    / {teamPointInfo.members.length} teams
                  </div>
                </div>

                <div className={`flex items-center gap-2 text-lg font-mono ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  <EmojiEvents className="text-orange-500" />
                  <span className="font-bold text-orange-500">{teamPointInfo.score}</span>
                  <span>points</span>
                </div>
              </div>
            </div>

            {/* Team Score */}
            <div
              className={`rounded-lg border p-6 ${
                theme === 'dark'
                  ? 'bg-gray-900 border-gray-700'
                  : 'bg-white border-gray-200'
              }`}
            >
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="text-orange-500 text-2xl" />
                  <span className={`font-bold font-mono ${
                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                  }`}>
                    [TEAM_SCORE]
                  </span>
                </div>

                <div className="flex items-baseline gap-2 mb-4">
                  <div className="text-6xl font-extrabold font-mono text-orange-500">
                    {finishPercent.toFixed(0)}%
                  </div>
                </div>

                <div className="w-full bg-gray-700 rounded-full h-3 relative overflow-hidden">
                  <div
                    className="h-full bg-orange-500 rounded-full transition-all duration-1000"
                    style={{ width: `${finishPercent}%` }}
                  />
                </div>

                <div className={`mt-2 text-xs font-mono text-center ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  {teamPointInfo.score} / {teamPointInfo.challengeTotalScore} total points
                </div>
              </div>
            </div>
          </div>

          {/* Team Members */}
          <div
            className={`rounded-lg border p-6 ${
              theme === 'dark'
                ? 'bg-gray-900 border-gray-700'
                : 'bg-white border-gray-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-4">
              <People className="text-orange-500 text-2xl" />
              <span className={`font-bold text-xl font-mono ${
                theme === 'dark' ? 'text-white' : 'text-gray-800'
              }`}>
                [TEAM_MEMBERS]
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className={`w-full text-sm ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                <thead>
                  <tr className={`border-b-2 font-mono ${
                    theme === 'dark' ? 'border-gray-700' : 'border-gray-300'
                  }`}>
                    <th className="p-3 text-left font-bold">NAME</th>
                    <th className="p-3 text-left font-bold">EMAIL</th>
                    <th className="p-3 text-right font-bold">SCORE</th>
                  </tr>
                </thead>
                <tbody>
                  {teamPointInfo.members.map((member, index) => (
                    <tr
                      key={index}
                      className={`border-b font-mono transition-colors ${
                        theme === 'dark'
                          ? 'border-gray-800 hover:bg-gray-800/50'
                          : 'border-gray-100 hover:bg-gray-50'
                      }`}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Avatar
                            sx={{
                              width: 32,
                              height: 32,
                              bgcolor: 'gray',
                              fontSize: '0.875rem',
                            }}
                          >
                            {member.name.charAt(0).toUpperCase()}
                          </Avatar>
                          <span className="font-semibold">{member.name}</span>
                        </div>
                      </td>
                      <td className="p-3">{member.email}</td>
                      <td className="p-3 text-right">
                        <span className={`px-2 py-1 rounded border text-xs font-bold ${
                          theme === 'dark' ? 'border-gray-700 text-orange-400' : 'border-gray-300 text-orange-600'
                        }`}>
                          {member.score}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Activity */}
          <div
            className={`rounded-lg border p-6 ${
              theme === 'dark'
                ? 'bg-gray-900 border-gray-700'
                : 'bg-white border-gray-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="text-orange-500 text-2xl" />
              <span className={`font-bold text-xl font-mono ${
                theme === 'dark' ? 'text-white' : 'text-gray-800'
              }`}>
                [RECENT_ACTIVITY]
              </span>
            </div>

            <div className="space-y-3">
              {teamPerformance.slice(0, 5).map((activity, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border transition-all ${
                    activity.type === 'correct'
                      ? theme === 'dark'
                        ? 'bg-green-900/20 border-green-500/30 hover:border-green-500/50'
                        : 'bg-green-50 border-green-200 hover:border-green-400'
                      : theme === 'dark'
                      ? 'bg-red-900/20 border-red-500/30 hover:border-red-500/50'
                      : 'bg-red-50 border-red-200 hover:border-red-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {activity.type === 'correct' ? (
                        <CheckCircle className="text-green-500" />
                      ) : (
                        <Cancel className="text-red-500" />
                      )}
                      <div>
                        <h3 className={`font-semibold font-mono ${
                          theme === 'dark' ? 'text-white' : 'text-gray-800'
                        }`}>
                          {activity.challenge.name}
                        </h3>
                        <p className={`text-xs font-mono ${
                          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          {activity.challenge.category}
                        </p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded border text-xs font-bold ${
                      activity.type === 'correct' 
                        ? theme === 'dark' ? 'border-green-700 text-green-400' : 'border-green-300 text-green-600'
                        : theme === 'dark' ? 'border-red-700 text-red-400' : 'border-red-300 text-red-600'
                    }`}>
                      {activity.type.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => !isChangingPassword && setShowPasswordModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-lg border p-8 relative ${
              theme === 'dark'
                ? 'bg-gray-900 border-gray-700'
                : 'bg-white border-gray-200'
            }`}
          >
            <button
              onClick={() => !isChangingPassword && setShowPasswordModal(false)}
              className={`absolute top-4 right-4 p-2 rounded-lg transition-colors ${
                theme === 'dark'
                  ? 'hover:bg-gray-800 text-gray-400 hover:text-white'
                  : 'hover:bg-gray-100 text-gray-600 hover:text-gray-800'
              }`}
              disabled={isChangingPassword}
            >
              <Close />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <Lock className="text-orange-500 text-3xl" />
              <h2 className={`text-2xl font-bold font-mono ${
                theme === 'dark' ? 'text-white' : 'text-gray-800'
              }`}>
                [CHANGE_PASSWORD]
              </h2>
            </div>

              <div className="space-y-4">
                {/* Old Password */}
                <div>
                  <label className={`block text-sm font-medium font-mono mb-2 ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Current Password
                  </label>
                  <div className="relative">
                    <input
                      type={showOldPassword ? 'text' : 'password'}
                      className={`w-full rounded-lg border p-3 pr-12 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${
                        theme === 'dark'
                          ? 'bg-gray-900 text-white border-gray-700'
                          : 'bg-white text-gray-900 border-gray-300'
                      }`}
                      value={passwordData.oldPassword}
                      onChange={(e) => handlePasswordInputChange('oldPassword', e.target.value)}
                      disabled={isChangingPassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowOldPassword(!showOldPassword)}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 ${
                        theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-800'
                      }`}
                      disabled={isChangingPassword}
                    >
                      {showOldPassword ? <VisibilityOff /> : <Visibility />}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div>
                  <label className={`block text-sm font-medium font-mono mb-2 ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      className={`w-full rounded-lg border p-3 pr-12 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${
                        theme === 'dark'
                          ? 'bg-gray-900 text-white border-gray-700'
                          : 'bg-white text-gray-900 border-gray-300'
                      }`}
                      value={passwordData.newPassword}
                      onChange={(e) => handlePasswordInputChange('newPassword', e.target.value)}
                      disabled={isChangingPassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 ${
                        theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-800'
                      }`}
                      disabled={isChangingPassword}
                    >
                      {showNewPassword ? <VisibilityOff /> : <Visibility />}
                    </button>
                  </div>

                  {/* Password Strength Indicator */}
                  {passwordData.newPassword && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-mono ${
                          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          Password Strength:
                        </span>
                        <span className={`text-xs font-bold font-mono ${
                          passwordStrength.color === 'success' ? 'text-green-500' :
                          passwordStrength.color === 'warning' ? 'text-yellow-500' : 'text-red-500'
                        }`}>
                          {passwordStrength.label}
                        </span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            passwordStrength.color === 'success' ? 'bg-green-500' :
                            passwordStrength.color === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${passwordStrength.value}%` }}
                        />
                      </div>

                      {/* Criteria Checklist */}
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        {[
                          { key: 'minLength', label: '8+ chars' },
                          { key: 'uppercase', label: 'Uppercase' },
                          { key: 'lowercase', label: 'Lowercase' },
                          { key: 'number', label: 'Number' },
                          { key: 'specialChar', label: 'Special' },
                        ].map((criterion) => (
                          <div
                            key={criterion.key}
                            className={`flex items-center gap-2 text-xs font-mono ${
                              passwordCriteria[criterion.key as keyof PasswordCriteria]
                                ? 'text-green-500'
                                : theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                            }`}
                          >
                            {passwordCriteria[criterion.key as keyof PasswordCriteria] ? (
                              <CheckCircle sx={{ fontSize: 14 }} />
                            ) : (
                              <Cancel sx={{ fontSize: 14 }} />
                            )}
                            <span>{criterion.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div>
                  <label className={`block text-sm font-medium font-mono mb-2 ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      className={`w-full rounded-lg border p-3 pr-12 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${
                        theme === 'dark'
                          ? 'bg-gray-900 text-white border-gray-700'
                          : 'bg-white text-gray-900 border-gray-300'
                      }`}
                      value={passwordData.confirmPassword}
                      onChange={(e) => handlePasswordInputChange('confirmPassword', e.target.value)}
                      disabled={isChangingPassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 ${
                        theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-800'
                      }`}
                      disabled={isChangingPassword}
                    >
                      {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                    </button>
                  </div>
                  {passwordData.confirmPassword && passwordData.newPassword !== passwordData.confirmPassword && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-red-500 font-mono">
                      <Cancel sx={{ fontSize: 14 }} />
                      <span>Passwords do not match</span>
                    </div>
                  )}
                </div>

                {/* Buttons */}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => !isChangingPassword && setShowPasswordModal(false)}
                    disabled={isChangingPassword}
                    className={`flex-1 py-3 px-4 rounded-lg font-bold font-mono transition-all ${
                      theme === 'dark'
                        ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                        : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={handleChangePassword}
                    disabled={isChangingPassword || !passwordData.oldPassword || !passwordData.newPassword || !passwordData.confirmPassword || passwordData.newPassword !== passwordData.confirmPassword}
                    className="flex-1 py-3 px-4 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-bold font-mono transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isChangingPassword ? (
                      <>
                        <CircularProgress size={20} sx={{ color: 'white' }} />
                        {'[...]'} CHANGING...
                      </>
                    ) : (
                      <>{' [>] CHANGE PASSWORD'}</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}