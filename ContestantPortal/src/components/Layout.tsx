import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../hooks/useToast';
import { configService } from '../services/configService';
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
  Security,
  EmojiEvents,
  SupportAgent,
  ViewList,
  History,
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
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [smallIconUrl, setSmallIconUrl] = useState<string | null>(null);

  const tabs = [
    { label: 'Challenges', path: '/challenges', icon: <Security fontSize="small" /> },
    { label: 'Instances', path: '/instances', icon: <ViewList fontSize="small" /> },
    { label: 'Scoreboard', path: '/scoreboard', icon: <EmojiEvents fontSize="small" /> },
    { label: 'Action Logs', path: '/action-logs', icon: <History fontSize="small" /> },
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

    // fetch public configuration including logo/icon
    (async function fetchPublic() {
      try {
        const cfg = await configService.getPublicConfig();
        if (cfg) {
          if (cfg.ctf_logo) setLogoUrl(cfg.ctf_logo);
          if (cfg.ctf_small_icon) setSmallIconUrl(cfg.ctf_small_icon);
        }
      } catch (err) {
        console.error('Error fetching public config:', err);
      }
    })();
  }, []);

  // update favicon dynamically when smallIconUrl arrives
  useEffect(() => {
    if (smallIconUrl) {
      let link: HTMLLinkElement | null = document.querySelector(
        "link[rel~='icon']"
      );
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = smallIconUrl;
    }
  }, [smallIconUrl]);


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
        className={`sticky top-0 z-50 border-b ${theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`}
      >
        <div className="px-6 py-3 max-w-[1920px] mx-auto">
          <div className="flex items-center">
            {/* Logo */}
            <Box
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => navigate('/challenges')}
            >
              <img
                src={logoUrl || '/assets/fctf-logo.png'}
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
                    className={`relative px-4 py-2 rounded-lg font-bold text-sm transition-all font-mono flex items-center gap-2 ${isActive
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
                  className={`hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border ${theme === 'dark'
                    ? 'bg-gray-800 border-gray-700'
                    : 'bg-gray-100 border-gray-300'
                    }`}
                >
                  <TimerIcon
                    className={theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}
                    fontSize="small"
                  />
                  <div>
                    <Typography className={`text-xs font-bold font-mono uppercase ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                      {contestStatus}
                    </Typography>
                    <Typography className={`text-sm font-mono font-black tabular-nums ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
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
              <Box className={`px-4 py-4 border-b ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
                }`}>
                <div>
                  <Typography className={`text-base font-black mb-0.5 font-mono ${theme === 'dark' ? 'text-white' : 'text-gray-800'
                    }`}>
                    {user?.username}
                  </Typography>
                  <Typography className={`text-xs font-mono ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                    {user?.email}
                  </Typography>
                  <Box className={`mt-2 px-2 py-1 rounded border inline-block ${theme === 'dark' ? 'border-gray-700 text-orange-400' : 'border-gray-300 text-orange-600'
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
                  className={`md:hidden border-b ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
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