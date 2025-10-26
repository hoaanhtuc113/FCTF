import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Typography, 
  CircularProgress, 
  Box,
  Avatar,
  Chip
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
  Email,
  PersonOutline
} from '@mui/icons-material';
import { FaTrophy, FaMedal } from 'react-icons/fa';
import Swal from 'sweetalert2';
import { useTheme } from '../context/ThemeContext';
import { fetchWithAuth } from '../services/api';
import { API_ENDPOINTS } from '../config/endpoints';
import { useAuth } from '../context/AuthContext';

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
  const { user } = useAuth();
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
    Swal.fire({
      title: icon === 'success' ? '🎉 Success!' : icon === 'error' ? '❌ Error!' : 'ℹ️ Info',
      text: message,
      icon: icon,
      confirmButtonText: 'OK',
      background: theme === 'dark' ? '#1f2937' : '#ffffff',
      color: theme === 'dark' ? '#ffffff' : '#000000',
      customClass: {
        popup: 'rounded-2xl',
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
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <PersonOutline className="text-orange-500 text-6xl mb-4" />
        </motion.div>
        <Typography className={`font-mono ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
          Loading profile...
        </Typography>
      </Box>
    );
  }

  const passwordStrength = getPasswordStrength();

  return (
    <div className="min-h-[70vh]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-6"
      >
        {/* LEFT: Profile Card */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="lg:col-span-1"
        >
          <div className={`rounded-2xl shadow-2xl border p-8 flex flex-col items-center relative overflow-hidden ${
            theme === 'dark'
              ? 'bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 border-orange-500/30'
              : 'bg-gradient-to-br from-white via-gray-50 to-white border-orange-200'
          }`}>
            {/* Background effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-orange-500/5 to-orange-400/5 animate-pulse" />
            
            <div className="relative z-10 w-full flex flex-col items-center">
              {/* Avatar */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                className="relative mb-4"
              >
                <Avatar
                  sx={{
                    width: 120,
                    height: 120,
                    bgcolor: 'orange',
                    fontSize: '3rem',
                    border: '4px solid',
                    borderColor: theme === 'dark' ? '#fb923c' : '#f97316',
                    boxShadow: '0 8px 32px rgba(249, 115, 22, 0.3)',
                  }}
                >
                  {userInfo.username.charAt(0).toUpperCase()}
                </Avatar>
                <div className="absolute bottom-0 right-0 w-8 h-8 bg-green-500 rounded-full border-4 border-gray-800 flex items-center justify-center">
                  <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                </div>
              </motion.div>

              {/* User Info */}
              <div className="text-center mb-4 w-full">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <h2 className={`text-2xl font-bold font-mono ${
                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                  }`}>
                    {userInfo.username}
                  </h2>
                  <span className="text-lg">🇻🇳</span>
                </div>
                
                <div className={`flex items-center justify-center gap-2 text-sm mb-2 ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  <Email sx={{ fontSize: 16 }} />
                  <span className="font-mono">{userInfo.email}</span>
                </div>

                <Chip
                  icon={<People />}
                  label={userInfo.team || 'No Team'}
                  sx={{
                    backgroundColor: 'rgba(249, 115, 22, 0.2)',
                    color: '#fb923c',
                    fontFamily: 'monospace',
                    fontWeight: 'bold',
                  }}
                />
              </div>

              {/* Change Password Button */}
              <motion.button
                onClick={() => setShowPasswordModal(true)}
                className={`w-full mt-4 flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-bold font-mono transition-all ${
                  theme === 'dark'
                    ? 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white'
                    : 'bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white'
                } shadow-lg hover:shadow-xl hover:shadow-orange-500/30`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Lock />
                CHANGE PASSWORD
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* RIGHT: Stats & Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Team Ranking & Progress */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Team Ranking */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`rounded-2xl shadow-2xl border p-6 relative overflow-hidden ${
                theme === 'dark'
                  ? 'bg-gradient-to-br from-gray-800 to-gray-900 border-yellow-500/30'
                  : 'bg-gradient-to-br from-white to-yellow-50 border-yellow-200'
              }`}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-yellow-500/10 to-transparent rounded-full -mr-16 -mt-16" />
              
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <FaTrophy className="text-yellow-500 text-2xl" />
                  <span className={`font-bold font-mono ${
                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                  }`}>
                    TEAM RANKING
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
            </motion.div>

            {/* Progress */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className={`rounded-2xl shadow-2xl border p-6 relative overflow-hidden ${
                theme === 'dark'
                  ? 'bg-gradient-to-br from-gray-800 to-gray-900 border-orange-500/30'
                  : 'bg-gradient-to-br from-white to-orange-50 border-orange-200'
              }`}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-orange-500/10 to-transparent rounded-full -mr-16 -mt-16" />
              
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="text-orange-500 text-2xl" />
                  <span className={`font-bold font-mono ${
                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                  }`}>
                    COMPLETION
                  </span>
                </div>

                <div className="flex items-baseline gap-2 mb-4">
                  <div className="text-6xl font-extrabold font-mono text-orange-500">
                    {finishPercent.toFixed(0)}%
                  </div>
                </div>

                <div className="w-full bg-gray-700 rounded-full h-3 relative overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-orange-400 via-orange-500 to-orange-600 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${finishPercent}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
                </div>

                <div className={`mt-2 text-xs font-mono text-center ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  {teamPointInfo.score} / {teamPointInfo.challengeTotalScore} points
                </div>
              </div>
            </motion.div>
          </div>

          {/* Team Members */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className={`rounded-2xl shadow-2xl border p-6 ${
              theme === 'dark'
                ? 'bg-gradient-to-br from-gray-800 to-gray-900 border-orange-500/30'
                : 'bg-gradient-to-br from-white to-gray-50 border-orange-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-4">
              <People className="text-orange-500 text-2xl" />
              <span className={`font-bold text-xl font-mono ${
                theme === 'dark' ? 'text-white' : 'text-gray-800'
              }`}>
                TEAM MEMBERS
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className={`w-full text-sm ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                <thead>
                  <tr className={`border-b-2 font-mono ${
                    theme === 'dark' ? 'border-orange-500/30' : 'border-orange-200'
                  }`}>
                    <th className="p-3 text-left font-bold">NAME</th>
                    <th className="p-3 text-left font-bold">EMAIL</th>
                    <th className="p-3 text-right font-bold">SCORE</th>
                  </tr>
                </thead>
                <tbody>
                  {teamPointInfo.members.map((member, index) => (
                    <motion.tr
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 + index * 0.05 }}
                      className={`border-b font-mono transition-colors ${
                        theme === 'dark'
                          ? 'border-gray-700 hover:bg-gray-800/50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Avatar
                            sx={{
                              width: 32,
                              height: 32,
                              bgcolor: 'orange',
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
                        <Chip
                          label={member.score}
                          size="small"
                          sx={{
                            backgroundColor: 'rgba(249, 115, 22, 0.2)',
                            color: '#fb923c',
                            fontFamily: 'monospace',
                            fontWeight: 'bold',
                          }}
                        />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>

          {/* Recent Activity */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className={`rounded-2xl shadow-2xl border p-6 ${
              theme === 'dark'
                ? 'bg-gradient-to-br from-gray-800 to-gray-900 border-orange-500/30'
                : 'bg-gradient-to-br from-white to-gray-50 border-orange-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="text-orange-500 text-2xl" />
              <span className={`font-bold text-xl font-mono ${
                theme === 'dark' ? 'text-white' : 'text-gray-800'
              }`}>
                RECENT ACTIVITY
              </span>
            </div>

            <div className="space-y-3">
              {teamPerformance.slice(0, 5).map((activity, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + index * 0.05 }}
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
                    <Chip
                      label={activity.type.toUpperCase()}
                      size="small"
                      sx={{
                        backgroundColor: activity.type === 'correct' 
                          ? 'rgba(34, 197, 94, 0.2)' 
                          : 'rgba(239, 68, 68, 0.2)',
                        color: activity.type === 'correct' ? '#4ade80' : '#f87171',
                        fontFamily: 'monospace',
                        fontWeight: 'bold',
                      }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Password Change Modal */}
      <AnimatePresence>
        {showPasswordModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => !isChangingPassword && setShowPasswordModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-md rounded-2xl shadow-2xl border p-8 relative ${
                theme === 'dark'
                  ? 'bg-gray-800 border-orange-500/30'
                  : 'bg-white border-orange-200'
              }`}
            >
              <button
                onClick={() => !isChangingPassword && setShowPasswordModal(false)}
                className={`absolute top-4 right-4 p-2 rounded-lg transition-colors ${
                  theme === 'dark'
                    ? 'hover:bg-gray-700 text-gray-400 hover:text-white'
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
                  CHANGE PASSWORD
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
                        <motion.div
                          className={`h-full rounded-full ${
                            passwordStrength.color === 'success' ? 'bg-green-500' :
                            passwordStrength.color === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          initial={{ width: 0 }}
                          animate={{ width: `${passwordStrength.value}%` }}
                          transition={{ duration: 0.3 }}
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
                    className="flex-1 py-3 px-4 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-lg font-bold font-mono transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isChangingPassword ? (
                      <>
                        <CircularProgress size={20} sx={{ color: 'white' }} />
                        CHANGING...
                      </>
                    ) : (
                      'CHANGE PASSWORD'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}