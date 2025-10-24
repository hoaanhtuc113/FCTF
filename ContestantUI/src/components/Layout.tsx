import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../hooks/useToast';
import { configService } from '../services/configService';
import { motion } from 'framer-motion';
import {
  Box,
  Avatar,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Divider,
} from '@mui/material';
import { 
  LogoutOutlined, 
  PersonOutline,
  DarkMode,
  LightMode,
  Timer as TimerIcon,
  Home,
  Security,
  EmojiEvents,
  SupportAgent,
} from '@mui/icons-material';
import type { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);
  const [contestStatus, setContestStatus] = useState<string>('');

  const tabs = [
    { label: 'Home', path: '/dashboard', icon: <Home fontSize="small" /> },
    { label: 'Challenges', path: '/challenges', icon: <Security fontSize="small" /> },
    { label: 'Scoreboard', path: '/scoreboard', icon: <EmojiEvents fontSize="small" /> },
    { label: 'Tickets', path: '/tickets', icon: <SupportAgent fontSize="small" /> },
  ];

  useEffect(() => {
    const fetchContestStatus = async () => {
      try {
        const config = await configService.getDateConfig();
        if (!config) return;

        const { message, start_date, end_date } = config;

        if (message === 'CTFd has not been started' && start_date) {
          const startDate = new Date(start_date * 1000);
          if (new Date() < startDate) {
            setContestStatus('Starts in');
            startCountdown(startDate);
          }
        } else if (message === 'CTFd has been started' && end_date) {
          const endDate = new Date(end_date * 1000);
          if (new Date() < endDate) {
            setContestStatus('Ends in');
            startCountdown(endDate);
          }
        } else {
          setContestStatus('Contest ended');
        }
      } catch (error) {
        console.error('Error fetching contest status:', error);
      }
    };

    fetchContestStatus();
  }, []);

  const startCountdown = (targetDate: Date) => {
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const difference = targetDate.getTime() - now;

      if (difference <= 0) {
        clearInterval(timer);
        setTimeLeft(null);
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setTimeLeft({ days, hours, minutes, seconds });
    }, 1000);

    return () => clearInterval(timer);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleProfile = () => {
    handleMenuClose();
    navigate('/profile');
  };

  const handleThemeToggle = () => {
    toggleTheme();
    toast.success(`Switched to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  };

  const handleLogout = () => {
    handleMenuClose();
    logout();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  const formatTime = () => {
    if (!timeLeft) return '';
    const parts = [];
    if (timeLeft.days > 0) parts.push(`${String(timeLeft.days).padStart(2, '0')}d`);
    parts.push(`${String(timeLeft.hours).padStart(2, '0')}h`);
    parts.push(`${String(timeLeft.minutes).padStart(2, '0')}m`);
    parts.push(`${String(timeLeft.seconds).padStart(2, '0')}s`);
    return parts.join(':');
  };

  return (
    <Box className="min-h-screen">
      {/* Header */}
      <Box
        component="header"
        className="sticky top-0 z-50 backdrop-blur-lg shadow-sm border-b border-gray-200 dark:border-orange-500/20"
        sx={{
          backgroundColor: theme === 'dark' 
            ? 'rgba(17, 24, 39, 0.9)' 
            : 'rgba(255, 255, 255, 0.9)',
        }}
      >
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-r from-orange-500/3 via-orange-400/3 to-orange-500/3 dark:from-orange-500/5 dark:via-orange-400/5 dark:to-orange-500/5" />

        <div className="relative z-10 px-6 py-3">
          <div className="flex items-center">
            {/* Logo */}
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Box
                className="flex items-center gap-2 cursor-pointer group"
                onClick={() => navigate('/dashboard')}
              >
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg group-hover:shadow-orange-500/50 transition-shadow" />
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-orange-400 to-transparent opacity-50" />
                  <div className="relative w-full h-full flex items-center justify-center">
                    <span className="text-white font-black text-lg tracking-tight">F</span>
                  </div>
                </div>
                <Typography
                  variant="h6"
                  className="font-black hidden md:block text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-orange-500 dark:from-orange-400 dark:to-orange-500"
                >
                  FCTF
                </Typography>
              </Box>
            </motion.div>

            {/* Navigation Tabs */}
            <Box className="flex-1 flex items-center gap-2 ml-8">
              {tabs.map((tab) => {
                const isActive = location.pathname === tab.path;
                return (
                  <motion.button
                    key={tab.path}
                    onClick={() => navigate(tab.path)}
                    className={`relative px-4 py-2 rounded-lg font-semibold text-sm transition-all duration-200 flex items-center gap-2 ${
                      isActive
                        ? 'text-white bg-gradient-to-r from-orange-500 to-orange-600 shadow-md shadow-orange-500/30'
                        : theme === 'dark'
                        ? 'text-gray-400 hover:text-orange-400 hover:bg-gray-800/50'
                        : 'text-gray-600 hover:text-orange-600 hover:bg-orange-50'
                    }`}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                    {isActive && (
                      <motion.div
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full"
                        layoutId="activeTab"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                  </motion.button>
                );
              })}
            </Box>

            {/* Right Section */}
            <Box className="flex items-center gap-3">
              {/* Countdown Timer */}
              {timeLeft && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border border-orange-200 dark:border-orange-500/30 shadow-sm"
                >
                  <TimerIcon className="text-orange-600 dark:text-orange-400 animate-pulse" fontSize="small" />
                  <div>
                    <Typography className="text-xs font-bold text-gray-700 dark:text-gray-300 font-mono uppercase tracking-wide">
                      {contestStatus}
                    </Typography>
                    <Typography className="text-sm text-orange-600 dark:text-orange-400 font-mono font-black tabular-nums tracking-tight">
                      {formatTime()}
                    </Typography>
                  </div>
                </motion.div>
              )}

               {/* Username */}
              <Box className="hidden md:block text-right">
                <Typography 
                  sx={{ 
                    fontSize: '0.875rem',
                    fontWeight: 700,
                    color: theme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(31, 41, 55)',
                  }}
                >
                  {user?.username}
                </Typography>
                <Typography 
                  sx={{ 
                    fontSize: '0.75rem',
                    fontFamily: 'ui-monospace, monospace',
                    color: theme === 'dark' ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)',
                  }}
                >
                  <span style={{ color: '#ff6f00', fontWeight: 600 }}>//</span> {user?.team.teamName}
                </Typography>
              </Box>

              {/* Avatar */}
              <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                <IconButton 
                  onClick={handleMenuOpen} 
                  sx={{ p: 0 }}
                  className="relative group"
                >
                  <div className="absolute inset-0 rounded-full bg-orange-500 blur-md opacity-0 group-hover:opacity-50 transition-opacity" />
                  <Avatar
                    sx={{
                      bgcolor: '#ff6f00',
                      width: 42,
                      height: 42,
                      fontWeight: 'bold',
                      fontSize: '18px',
                      border: theme === 'dark' ? '2px solid rgba(255, 111, 0, 0.3)' : '2px solid rgba(255, 111, 0, 0.15)',
                    }}
                  >
                    {user?.username.charAt(0).toUpperCase()}
                  </Avatar>
                </IconButton>
              </motion.div>
            </Box>

            {/* User Menu */}
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              PaperProps={{
                elevation: 0,
                sx: {
                  mt: 1.5,
                  minWidth: 260,
                  borderRadius: 3,
                  backgroundColor: theme === 'dark' ? 'rgba(31, 41, 55, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                  backdropFilter: 'blur(20px)',
                  border: theme === 'dark' ? '1px solid rgba(255, 111, 0, 0.2)' : '1px solid rgba(229, 231, 235, 1)',
                  boxShadow: theme === 'dark' 
                    ? '0 8px 32px rgba(0, 0, 0, 0.4)' 
                    : '0 8px 32px rgba(0, 0, 0, 0.1)',
                  overflow: 'hidden',
                },
              }}
            >
              {/* User Info Header */}
              <Box className="relative px-4 py-4 bg-gradient-to-br from-orange-500 to-orange-600 text-white overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-400/50 to-transparent" />
                <div className="relative z-10">
                  <Typography className="text-base font-black mb-0.5">
                    {user?.username}
                  </Typography>
                  <Typography className="text-xs opacity-90 font-mono">
                    {user?.email}
                  </Typography>
                  <Box className="mt-2 px-2 py-1 bg-white/20 backdrop-blur-sm rounded-md inline-block">
                    <Typography className="text-xs font-bold font-mono">
                      TEAM: {user?.team.teamName}
                    </Typography>
                  </Box>
                </div>
              </Box>

                            {/* Mobile Countdown */}
              {timeLeft && (
                <>
                  <Box 
                    className="md:hidden" 
                    sx={{ 
                      px: 2, 
                      py: 1.5,
                      backgroundColor: theme === 'dark' 
                        ? 'rgba(255, 111, 0, 0.1)' 
                        : 'rgba(255, 237, 213, 0.5)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <TimerIcon 
                        className="animate-pulse" 
                        fontSize="small" 
                        sx={{ color: '#ff6f00' }} 
                      />
                      <div className="flex-1">
                        <Typography 
                          sx={{ 
                            fontSize: '0.625rem',
                            fontFamily: 'ui-monospace, monospace',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: theme === 'dark' ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)',
                          }}
                        >
                          {contestStatus}
                        </Typography>
                        <Typography 
                          sx={{ 
                            fontSize: '0.8125rem',
                            fontFamily: 'ui-monospace, monospace',
                            fontWeight: 900,
                            color: '#ff6f00',
                            letterSpacing: '-0.025em',
                          }}
                        >
                          {formatTime()}
                        </Typography>
                      </div>
                    </div>
                  </Box>
                  <Divider sx={{ borderColor: theme === 'dark' ? 'rgba(75, 85, 99, 0.5)' : 'rgba(229, 231, 235, 1)' }} />
                </>
              )}

              {/* Menu Items */}
              <MenuItem 
                onClick={handleProfile}
                sx={{
                  gap: 1.5,
                  mx: 1,
                  my: 0.5,
                  borderRadius: 2,
                  fontWeight: 600,
                  color: theme === 'dark' ? 'rgb(229, 231, 235)' : 'rgb(55, 65, 81)',
                  '&:hover': {
                    backgroundColor: theme === 'dark' ? 'rgba(255, 111, 0, 0.1)' : 'rgba(255, 237, 213, 1)',
                  },
                }}
              >
                <PersonOutline fontSize="small" sx={{ color: '#ff6f00' }} />
                <span>Profile Settings</span>
              </MenuItem>

              <MenuItem 
                onClick={handleThemeToggle}
                sx={{
                  gap: 1.5,
                  mx: 1,
                  my: 0.5,
                  borderRadius: 2,
                  fontWeight: 600,
                  color: theme === 'dark' ? 'rgb(229, 231, 235)' : 'rgb(55, 65, 81)',
                  '&:hover': {
                    backgroundColor: theme === 'dark' ? 'rgba(255, 111, 0, 0.1)' : 'rgba(255, 237, 213, 1)',
                  },
                }}
              >
                {theme === 'dark' ? (
                  <>
                    <LightMode fontSize="small" sx={{ color: 'rgb(251, 191, 36)' }} />
                    <span>Light Mode</span>
                  </>
                ) : (
                  <>
                    <DarkMode fontSize="small" sx={{ color: 'rgb(75, 85, 99)' }} />
                    <span>Dark Mode</span>
                  </>
                )}
              </MenuItem>

              <Divider sx={{ borderColor: theme === 'dark' ? 'rgba(75, 85, 99, 0.5)' : 'rgba(229, 231, 235, 1)', my: 1 }} />

              <MenuItem 
                onClick={handleLogout}
                sx={{
                  gap: 1.5,
                  mx: 1,
                  mb: 1,
                  borderRadius: 2,
                  fontWeight: 700,
                  color: theme === 'dark' ? 'rgb(248, 113, 113)' : 'rgb(220, 38, 38)',
                  '&:hover': {
                    backgroundColor: theme === 'dark' ? 'rgba(220, 38, 38, 0.1)' : 'rgba(254, 226, 226, 1)',
                  },
                }}
              >
                <LogoutOutlined fontSize="small" />
                <span>Logout</span>
              </MenuItem>
            </Menu>
          </div>
        </div>
      </Box>

     {/* Content */}
      <Box className="relative">
        {/* Grid pattern background */}
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.015] dark:opacity-[0.03] pointer-events-none" 
          style={{
            backgroundImage: `linear-gradient(rgba(255, 111, 0, 0.08) 1px, transparent 1px), 
                             linear-gradient(90deg, rgba(255, 111, 0, 0.08) 1px, transparent 1px)`,
            backgroundSize: '50px 50px'
          }}
        />
        
        <div className="relative z-10 px-12 pt-6 pb-4">
          {children}
        </div>
      </Box>
    </Box>
  );
}