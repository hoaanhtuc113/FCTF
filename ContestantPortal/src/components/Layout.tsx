import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../hooks/useToast';
import { configService } from '../services/configService';
import { fetchWithAuth } from '../services/api';
import {
  Box,
  Avatar,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Divider,
  Badge,
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
  Notifications,
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

interface Notification {
  id: string;
  title: string;
  content: string;
  date: string;
  isRead: boolean;
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notificationAnchorEl, setNotificationAnchorEl] = useState<null | HTMLElement>(null);
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);
  const [contestStatus, setContestStatus] = useState<string>('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

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

  // Fetch notifications
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const response = await fetchWithAuth('/notifications');
        const data = await response.json();
        
        if (data.success && data.data) {
          const sortedNotifications = data.data
            .map((notification: any) => ({
              ...notification,
              isRead: false,
            }))
            .sort((a: Notification, b: Notification) => 
              new Date(b.date).getTime() - new Date(a.date).getTime()
            );
          setNotifications(sortedNotifications);
          setUnreadCount(sortedNotifications.filter((n: Notification) => !n.isRead).length);
        }
      } catch (error) {
        console.error('Error fetching notifications:', error);
      }
    };

    fetchNotifications();
    
    // Poll for new notifications every 60 seconds
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
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

  const handleNotificationOpen = (event: React.MouseEvent<HTMLElement>) => {
    setNotificationAnchorEl(event.currentTarget);
  };

  const handleNotificationClose = () => {
    setNotificationAnchorEl(null);
  };

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.id === id ? { ...notification, isRead: true } : notification
      )
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const markAllAsRead = () => {
    setNotifications((prev) =>
      prev.map((notification) => ({ ...notification, isRead: true }))
    );
    setUnreadCount(0);
  };

  const formatNotificationDate = (dateString: string) => {
    // Parse the date string and convert to local timezone
    const date = new Date(dateString);
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    // If negative (future date), just show the date
    if (diffMins < 0) {
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    // For older dates, show formatted date with time
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
        className={`sticky top-0 z-50 border-b ${
          theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <div className="px-6 py-3 max-w-[1920px] mx-auto">
          <div className="flex items-center">
            {/* Logo */}
            <Box
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => navigate('/dashboard')}
            >
              <img 
                src="/assets/fctf-logo.png" 
                alt="FCTF Logo" 
                className="w-10 h-10 object-contain"
              />
            </Box>

            {/* Navigation Tabs */}
            <Box className="flex-1 flex items-center gap-2 ml-8">
              {tabs.map((tab) => {
                const isActive = location.pathname === tab.path;
                return (
                  <button
                    key={tab.path}
                    onClick={() => navigate(tab.path)}
                    className={`relative px-4 py-2 rounded-lg font-bold text-sm transition-all font-mono flex items-center gap-2 ${
                      isActive
                        ? theme === 'dark'
                          ? 'text-white bg-orange-600 border border-orange-500'
                          : 'text-white bg-orange-600 border border-orange-500'
                        : theme === 'dark'
                        ? 'text-gray-400 hover:text-orange-400 border border-transparent hover:border-gray-700'
                        : 'text-gray-600 hover:text-orange-600 border border-transparent hover:border-gray-300'
                    }`}
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                );
              })}
            </Box>

            {/* Right Section */}
            <Box className="flex items-center gap-3">
              {/* Countdown Timer */}
              {timeLeft && (
                <div
                  className={`hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border ${
                    theme === 'dark' 
                      ? 'bg-gray-800 border-gray-700' 
                      : 'bg-gray-100 border-gray-300'
                  }`}
                >
                  <TimerIcon 
                    className={theme === 'dark' ? 'text-orange-400' : 'text-orange-600'} 
                    fontSize="small" 
                  />
                  <div>
                    <Typography className={`text-xs font-bold font-mono uppercase ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      {contestStatus}
                    </Typography>
                    <Typography className={`text-sm font-mono font-black tabular-nums ${
                      theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
                    }`}>
                      {formatTime()}
                    </Typography>
                  </div>
                </div>
              )}

               {/* Username */}
              <Box className="hidden md:block text-right">
                <Typography 
                  sx={{ 
                    fontSize: '0.875rem',
                    fontWeight: 700,
                    fontFamily: 'ui-monospace, monospace',
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
                  <span style={{ color: theme === 'dark' ? '#fb923c' : '#f97316', fontWeight: 600 }}>//</span> {user?.team.teamName}
                </Typography>
              </Box>

              {/* Notification Bell */}
              <div>
                <IconButton 
                  onClick={handleNotificationOpen}
                  sx={{ p: 1 }}
                >
                  <Badge 
                    badgeContent={unreadCount} 
                    sx={{
                      '& .MuiBadge-badge': {
                        backgroundColor: '#ef4444',
                        color: 'white',
                        fontSize: '0.625rem',
                        height: '18px',
                        minWidth: '18px',
                        fontFamily: 'ui-monospace, monospace',
                        fontWeight: 'bold',
                      }
                    }}
                  >
                    <Notifications 
                      sx={{ 
                        color: theme === 'dark' ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)',
                        fontSize: '1.5rem',
                      }} 
                    />
                  </Badge>
                </IconButton>
              </div>

              {/* Avatar */}
              <div>
                <IconButton 
                  onClick={handleMenuOpen} 
                  sx={{ p: 0 }}
                >
                  <Avatar
                    sx={{
                      bgcolor: theme === 'dark' ? 'rgb(75, 85, 99)' : 'rgb(156, 163, 175)',
                      width: 42,
                      height: 42,
                      fontWeight: 'bold',
                      fontSize: '18px',
                      border: theme === 'dark' ? '2px solid rgb(55, 65, 81)' : '2px solid rgb(209, 213, 219)',
                    }}
                  >
                    {user?.username.charAt(0).toUpperCase()}
                  </Avatar>
                </IconButton>
              </div>
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
                  borderRadius: 2,
                  backgroundColor: theme === 'dark' ? 'rgb(17, 24, 39)' : 'rgb(255, 255, 255)',
                  border: theme === 'dark' ? '1px solid rgb(55, 65, 81)' : '1px solid rgb(229, 231, 235)',
                  overflow: 'hidden',
                },
              }}
            >
              {/* User Info Header */}
              <Box className={`px-4 py-4 border-b ${
                theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
              }`}>
                <div>
                  <Typography className={`text-base font-black mb-0.5 font-mono ${
                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                  }`}>
                    {user?.username}
                  </Typography>
                  <Typography className={`text-xs font-mono ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {user?.email}
                  </Typography>
                  <Box className={`mt-2 px-2 py-1 rounded border inline-block ${
                    theme === 'dark' ? 'border-gray-700 text-orange-400' : 'border-gray-300 text-orange-600'
                  }`}>
                    <Typography className="text-xs font-bold font-mono">
                      {user?.team.teamName}
                    </Typography>
                  </Box>
                </div>
              </Box>

                            {/* Mobile Countdown */}
              {timeLeft && (
                <Box 
                  className={`md:hidden border-b ${
                    theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
                  }`}
                  sx={{ px: 2, py: 1.5 }}
                >
                  <div className="flex items-center gap-2">
                    <TimerIcon 
                      fontSize="small" 
                      sx={{ color: theme === 'dark' ? '#fb923c' : '#f97316' }} 
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
                          color: theme === 'dark' ? '#fb923c' : '#f97316',
                          letterSpacing: '-0.025em',
                        }}
                      >
                        {formatTime()}
                      </Typography>
                    </div>
                  </div>
                </Box>
              )}

              {/* Menu Items */}
              <MenuItem 
                onClick={handleProfile}
                sx={{
                  gap: 1.5,
                  mx: 1,
                  my: 0.5,
                  borderRadius: 1.5,
                  fontWeight: 600,
                  fontFamily: 'ui-monospace, monospace',
                  color: theme === 'dark' ? 'rgb(229, 231, 235)' : 'rgb(55, 65, 81)',
                  '&:hover': {
                    backgroundColor: theme === 'dark' ? 'rgba(75, 85, 99, 0.5)' : 'rgba(243, 244, 246, 1)',
                  },
                }}
              >
                <PersonOutline fontSize="small" sx={{ color: theme === 'dark' ? '#fb923c' : '#f97316' }} />
                <span>{'[>]'} Profile</span>
              </MenuItem>

              <MenuItem 
                onClick={handleThemeToggle}
                sx={{
                  gap: 1.5,
                  mx: 1,
                  my: 0.5,
                  borderRadius: 1.5,
                  fontWeight: 600,
                  fontFamily: 'ui-monospace, monospace',
                  color: theme === 'dark' ? 'rgb(229, 231, 235)' : 'rgb(55, 65, 81)',
                  '&:hover': {
                    backgroundColor: theme === 'dark' ? 'rgba(75, 85, 99, 0.5)' : 'rgba(243, 244, 246, 1)',
                  },
                }}
              >
                {theme === 'dark' ? (
                  <>
                    <LightMode fontSize="small" sx={{ color: 'rgb(251, 191, 36)' }} />
                    <span>{'[>]'} Light Mode</span>
                  </>
                ) : (
                  <>
                    <DarkMode fontSize="small" sx={{ color: 'rgb(75, 85, 99)' }} />
                    <span>{'[>]'} Dark Mode</span>
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
                  borderRadius: 1.5,
                  fontWeight: 700,
                  fontFamily: 'ui-monospace, monospace',
                  color: theme === 'dark' ? 'rgb(248, 113, 113)' : 'rgb(220, 38, 38)',
                  '&:hover': {
                    backgroundColor: theme === 'dark' ? 'rgba(220, 38, 38, 0.1)' : 'rgba(254, 226, 226, 1)',
                  },
                }}
              >
                <LogoutOutlined fontSize="small" />
                <span>{'[!]'} Logout</span>
              </MenuItem>
            </Menu>

            {/* Notification Menu */}
            <Menu
              anchorEl={notificationAnchorEl}
              open={Boolean(notificationAnchorEl)}
              onClose={handleNotificationClose}
              PaperProps={{
                elevation: 0,
                sx: {
                  mt: 1.5,
                  minWidth: 380,
                  maxWidth: 420,
                  borderRadius: 2,
                  backgroundColor: theme === 'dark' ? 'rgb(17, 24, 39)' : 'rgb(255, 255, 255)',
                  border: theme === 'dark' ? '1px solid rgb(55, 65, 81)' : '1px solid rgb(229, 231, 235)',
                  overflow: 'hidden',
                  maxHeight: '500px',
                },
              }}
            >
              {/* Header */}
              <Box className={`px-4 py-3 border-b flex items-center justify-between ${
                theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
              }`}>
                <Typography className={`text-base font-bold font-mono ${
                  theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
                }`}>
                  [NOTIFICATIONS]
                </Typography>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className={`text-xs font-bold font-mono px-2 py-1 rounded border transition ${
                      theme === 'dark'
                        ? 'border-orange-700 text-orange-400 hover:bg-orange-900/30'
                        : 'border-orange-300 text-orange-600 hover:bg-orange-50'
                    }`}
                  >
                    {'[✓]'} MARK ALL
                  </button>
                )}
              </Box>

              {/* Notifications List */}
              <Box 
                className="overflow-y-auto"
                sx={{
                  maxHeight: '400px',
                  '&::-webkit-scrollbar': {
                    width: '6px',
                  },
                  '&::-webkit-scrollbar-track': {
                    background: theme === 'dark' ? 'rgb(31, 41, 55)' : 'rgb(243, 244, 246)',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    background: theme === 'dark' ? 'rgb(75, 85, 99)' : 'rgb(209, 213, 219)',
                    borderRadius: '3px',
                  },
                }}
              >
                {notifications.length === 0 ? (
                  <Box className="px-4 py-8 text-center">
                    <Typography className={`font-mono text-sm ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      [i] No notifications
                    </Typography>
                  </Box>
                ) : (
                  notifications.slice(0, 10).map((notification) => (
                    <Box
                      key={notification.id}
                      onClick={() => markAsRead(notification.id)}
                      className={`px-4 py-3 cursor-pointer border-b transition-colors ${
                        notification.isRead
                          ? theme === 'dark'
                            ? 'bg-gray-900/50 border-gray-800 opacity-60'
                            : 'bg-gray-50/50 border-gray-100 opacity-60'
                          : theme === 'dark'
                          ? 'bg-gray-900 border-gray-800 hover:bg-gray-800/50'
                          : 'bg-white border-gray-100 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <Typography className={`text-sm font-bold font-mono ${
                          theme === 'dark' ? 'text-white' : 'text-gray-900'
                        }`}>
                          {notification.isRead ? '[·]' : '[!]'} {notification.title}
                        </Typography>
                        <span className={`text-xs font-mono whitespace-nowrap ${
                          theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          {formatNotificationDate(notification.date)}
                        </span>
                      </div>
                      <Typography className={`text-xs font-mono leading-relaxed ${
                        theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                        {notification.content}
                      </Typography>
                    </Box>
                  ))
                )}
              </Box>

              {/* Footer */}
              {notifications.length > 10 && (
                <Box className={`px-4 py-2 border-t text-center ${
                  theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
                }`}>
                  <Typography className={`text-xs font-mono ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    [i] Showing last 10 notifications
                  </Typography>
                </Box>
              )}
            </Menu>
          </div>
        </div>
      </Box>

     {/* Content */}
      <Box className="relative">
        <div className="px-12 pt-6 pb-4 max-w-[1920px] mx-auto">
          {children}
        </div>
      </Box>
    </Box>
  );
}