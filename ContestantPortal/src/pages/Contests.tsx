import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../hooks/useToast';
import { Box, Typography, Button, TextField, InputAdornment, Avatar, IconButton } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search as SearchIcon,
  PlayCircle,
  Calendar,
  Lock,
  LogOut,
  Moon,
  Sun,
  Shield,
  Users,
  Compass
} from 'lucide-react';
import { CyberBackground } from '../components/CyberBackground';
import { contestService, type Contest } from '../services/contestService';

// Individual Contest Card Countdown component for upcoming contests
function ContestCountdown({ targetDate }: { targetDate: string }) {
  const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; minutes: number; seconds: number } | null>(null);

  useEffect(() => {
    const calculateTime = () => {
      const difference = new Date(targetDate).getTime() - new Date().getTime();
      if (difference <= 0) {
        setTimeLeft(null);
        return;
      }
      setTimeLeft({
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((difference % (1000 * 60)) / 1000),
      });
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  if (!timeLeft) return <Typography className="text-xs font-mono text-blue-500 font-bold">MUTED / READY</Typography>;

  return (
    <Typography className="text-xs font-mono font-bold tracking-wider" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
      STARTS IN: <span className="tabular-nums text-orange-500">{String(timeLeft.days).padStart(2, '0')}d : {String(timeLeft.hours).padStart(2, '0')}h : {String(timeLeft.minutes).padStart(2, '0')}m : {String(timeLeft.seconds).padStart(2, '0')}s</span>
    </Typography>
  );
}

export function Contests() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const [contests, setContests] = useState<Contest[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'upcoming' | 'ended'>('all');
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    // Clear active contest context when visiting this page, as user is selecting a new one
    contestService.clearActiveContest();

    (async () => {
      try {
        setLoading(true);
        const list = await contestService.getContests();
        setContests(list);
      } catch (err) {
        toast.error('Failed to load contests');
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelectContest = (contest: Contest) => {
    if (contest.status === 'upcoming') {
      toast.info(`Contest "${contest.name}" has not started yet.`);
      return;
    }
    contestService.setActiveContest(contest);
    toast.success(`Selected Contest: ${contest.name}`);
    navigate(`/contest/${contest.id}/challenges`);
  };

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  const handleThemeToggle = () => {
    toggleTheme();
    toast.success(`Switched to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  };

  // Filter contests based on search term and active tab
  const filteredContests = contests.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.description ?? '').toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;
    if (activeTab === 'all') return true;
    return c.status === activeTab;
  });

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08
      }
    }
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 100, damping: 15 } }
  };

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

      {/* Header Container */}
      <Box
        component="header"
        sx={{
          position: 'relative',
          zIndex: 10,
          borderBottom: `1px solid ${activeColors.border}`,
          bgcolor: theme === 'dark' ? 'rgba(17, 24, 39, 0.75)' : 'rgba(255, 255, 255, 0.75)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <Box
          sx={{
            maxWidth: '1280px',
            mx: 'auto',
            px: { xs: 2, sm: 4 },
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Brand/Logo */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: '8px',
                bgcolor: activeColors.tagBg,
                color: activeColors.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${activeColors.primary}`,
              }}
            >
              <Shield size={20} />
            </Box>
            <Typography
              sx={{
                fontSize: 16,
                fontWeight: 900,
                letterSpacing: '0.05em',
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              FCTF <span style={{ color: activeColors.primary }}>//</span> PORTAL
            </Typography>
          </Box>

          {/* User Session & Utility */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 } }}>
            {/* User Meta */}
            <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'right' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
                {user?.username}
              </Typography>
              <Typography sx={{ fontSize: 11, color: activeColors.textSecondary, fontFamily: '"JetBrains Mono", monospace' }}>
                <span style={{ color: activeColors.primary, fontWeight: 700 }}>#</span> {user?.username}
              </Typography>
            </Box>

            <Avatar
              sx={{
                bgcolor: theme === 'dark' ? '#374151' : '#d1d5db',
                width: 36,
                height: 36,
                fontSize: 14,
                fontWeight: 'bold',
                border: `1px solid ${activeColors.border}`
              }}
            >
              {user?.username?.charAt(0).toUpperCase()}
            </Avatar>

            {/* Theme Toggle */}
            <IconButton
              onClick={handleThemeToggle}
              sx={{
                color: activeColors.textSecondary,
                p: 0.75,
                border: `1px solid ${activeColors.border}`,
                borderRadius: '8px',
                bgcolor: theme === 'dark' ? 'rgba(31, 41, 55, 0.5)' : '#fff',
                '&:hover': {
                  borderColor: activeColors.primary,
                  color: activeColors.primary,
                }
              }}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>

            {/* Logout */}
            <IconButton
              onClick={handleLogout}
              sx={{
                color: '#ef4444',
                p: 0.75,
                border: `1px solid ${activeColors.border}`,
                borderRadius: '8px',
                bgcolor: theme === 'dark' ? 'rgba(239, 68, 68, 0.05)' : '#fff',
                '&:hover': {
                  borderColor: '#ef4444',
                  bgcolor: 'rgba(239, 68, 68, 0.1)',
                }
              }}
            >
              <LogOut size={18} />
            </IconButton>
          </Box>
        </Box>
      </Box>

      {/* Main Container */}
      <Box sx={{ position: 'relative', zIndex: 1, flex: 1, maxWidth: '1280px', width: '100%', mx: 'auto', px: { xs: 2, sm: 4 }, py: { xs: 4, sm: 6 } }}>

        {/* Title Block */}
        <Box sx={{ mb: 5, textAlign: 'center' }}>
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 0.5,
                borderRadius: '999px',
                border: `1px solid ${activeColors.inputBorder}`,
                bgcolor: activeColors.tagBg,
                color: activeColors.primary,
                fontSize: 12,
                mb: 2,
              }}
            >
              <Compass size={14} className="animate-spin-slow" />
              SELECT AN ARENA
            </Box>

            <Typography
              variant="h3"
              sx={{
                fontWeight: 800,
                fontSize: { xs: '2rem', sm: '2.75rem' },
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              <span
                style={{
                  background: 'linear-gradient(135deg,#f59e0b 0%,#ea580c 50%,#dc2626 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  fontWeight: 900,
                }}
              >
                Contests
              </span>
            </Typography>
            <Typography sx={{ mt: 1.5, color: activeColors.textSecondary, fontSize: 14, maxWidth: '560px', mx: 'auto' }}>
              Welcome to the FCTF arena. Choose an active or archived contest to continue.
            </Typography>
          </motion.div>
        </Box>

        {/* Filter Toolbar */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { xs: 'stretch', md: 'center' },
            justifyContent: 'space-between',
            gap: 2,
            mb: 4,
            p: 2,
            border: `1px solid ${activeColors.border}`,
            bgcolor: activeColors.panelBg,
            borderRadius: '12px',
            boxShadow: activeColors.shadow,
          }}
        >
          {/* Tabs */}
          <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: { xs: 0.5, sm: 0 } }}>
            {(['all', 'active', 'upcoming', 'ended'] as const).map((tab) => {
              const label = tab === 'all' ? 'ALL' : tab === 'active' ? 'ACTIVE' : tab === 'upcoming' ? 'UPCOMING' : 'ENDED';
              const isSelected = activeTab === tab;
              return (
                <Button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  sx={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 12,
                    textTransform: 'none',
                    fontWeight: 700,
                    px: 2,
                    py: 0.75,
                    borderRadius: '8px',
                    whiteSpace: 'nowrap',
                    color: isSelected ? '#fff' : activeColors.textSecondary,
                    bgcolor: isSelected ? activeColors.primary : 'transparent',
                    border: `1px solid ${isSelected ? activeColors.primary : 'transparent'}`,
                    '&:hover': {
                      bgcolor: isSelected ? activeColors.primaryDark : (theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'),
                      borderColor: isSelected ? activeColors.primaryDark : activeColors.inputBorder,
                    }
                  }}
                >
                  {`[ ${label} ]`}
                </Button>
              );
            })}
          </Box>

          {/* Search */}
          <TextField
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search contests..."
            sx={{
              width: { xs: '100%', md: '280px' },
              '& .MuiOutlinedInput-root': {
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 13,
                bgcolor: activeColors.inputBg,
                color: activeColors.text,
                borderRadius: '8px',
                height: 38,
                '& fieldset': {
                  borderColor: activeColors.inputBorder,
                },
                '&:hover fieldset': {
                  borderColor: activeColors.primary,
                },
                '&.Mui-focused fieldset': {
                  borderColor: activeColors.primary,
                  borderWidth: '1px',
                },
              },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start" sx={{ color: activeColors.textSecondary }}>
                  <SearchIcon size={16} />
                </InputAdornment>
              ),
            }}
          />
        </Box>

        {/* Loading Spinner */}
        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8 }}>
            <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
            <Typography sx={{ mt: 2, fontSize: 13, color: activeColors.textSecondary, fontFamily: '"JetBrains Mono", monospace' }}>
              {'>'} Loading contests matrix...
            </Typography>
          </Box>
        ) : (
          <AnimatePresence mode="popLayout">
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="flex flex-col gap-4"
            >
              {filteredContests.length > 0 ? (
                filteredContests.map((contest) => {
                  const isActive = contest.status === 'active';
                  const isUpcoming = contest.status === 'upcoming';
                  const isEnded = contest.status === 'ended';

                  return (
                    <motion.div
                      key={contest.id}
                      variants={cardVariants}
                      whileHover={{ x: 4, transition: { duration: 0.15 } }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: { xs: 'column', md: 'row' },
                          alignItems: { xs: 'stretch', md: 'center' },
                          gap: { xs: 3, md: 4 },
                          border: `1px solid ${isActive ? activeColors.primary : activeColors.border}`,
                          bgcolor: activeColors.panelBg,
                          p: { xs: 3, md: 3 },
                          borderRadius: '12px',
                          boxShadow: isActive
                            ? (theme === 'dark' ? '0 10px 30px rgba(234, 122, 0, 0.15)' : '0 10px 35px rgba(234, 122, 0, 0.08)')
                            : activeColors.shadow,
                          transition: 'all 0.2s ease',
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        {/* Pulse Glowing Effect for active card */}
                        {isActive && (
                          <div
                            className="absolute top-0 right-0 w-32 h-32 pointer-events-none rounded-full"
                            style={{
                              background: 'radial-gradient(circle, rgba(234, 122, 0, 0.15) 0%, transparent 70%)',
                              transform: 'translate(30%, -30%)'
                            }}
                          />
                        )}

                        {/* Main Info (Left) */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                            {/* Category Tag */}
                            <Box
                              sx={{
                                fontSize: 10,
                                fontWeight: 'bold',
                                px: 1.2,
                                py: 0.35,
                                borderRadius: '4px',
                                bgcolor: isActive ? 'rgba(234, 122, 0, 0.12)' : (theme === 'dark' ? 'rgba(255,255,255,0.04)' : '#f3f4f6'),
                                border: `1px solid ${isActive ? 'rgba(234, 122, 0, 0.25)' : activeColors.inputBorder}`,
                                color: isActive ? activeColors.primary : activeColors.textSecondary,
                                letterSpacing: '0.05em'
                              }}
                            >
                              {contest.category.toUpperCase()}
                            </Box>

                            {/* Status Badge */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              {isActive ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                  <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
                                  <Typography sx={{ fontSize: 11, fontWeight: 900, color: activeColors.primary }}>
                                    ACTIVE
                                  </Typography>
                                </Box>
                              ) : isUpcoming ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'rgb(59, 130, 246)' }}>
                                    UPCOMING
                                  </Typography>
                                </Box>
                              ) : (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: activeColors.textSecondary }}>
                                    ARCHIVED
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          </Box>

                          {/* Contest Title */}
                          <Typography
                            variant="h5"
                            sx={{
                              fontSize: 18,
                              fontWeight: 800,
                              mb: 1,
                              lineHeight: 1.3,
                              fontFamily: '"JetBrains Mono", monospace',
                              '&:hover': { color: activeColors.primary }
                            }}
                          >
                            {contest.name}
                          </Typography>

                          {/* Contest Description */}
                          <Typography
                            sx={{
                              fontSize: 12.5,
                              color: activeColors.textSecondary,
                              lineHeight: 1.5,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              fontFamily: 'system-ui, -apple-system, sans-serif',
                              maxWidth: '800px'
                            }}
                          >
                            {contest.description}
                          </Typography>
                        </Box>

                        {/* Stats & Action (Right) */}
                        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' }, gap: 4, flexShrink: 0 }}>

                          {/* Info Column */}
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            {/* Duration / Timer row */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Calendar size={13} style={{ color: activeColors.textSecondary }} />
                              {isUpcoming ? (
                                <ContestCountdown targetDate={contest.start_time} />
                              ) : (
                                <Typography sx={{ fontSize: 11, fontFamily: '"JetBrains Mono", monospace', color: activeColors.textSecondary, whiteSpace: 'nowrap' }}>
                                  {new Date(contest.start_time).toLocaleDateString()} - {new Date(contest.end_time).toLocaleDateString()}
                                </Typography>
                              )}
                            </Box>

                            {/* Teams / Challenges statistics */}
                            <Box sx={{ display: 'flex', gap: 3 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Users size={13} style={{ color: activeColors.textSecondary }} />
                                <Typography sx={{ fontSize: 11, fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                                  {contest.team_count} <span style={{ fontWeight: 400, color: activeColors.textSecondary }}>Teams</span>
                                </Typography>
                              </Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <PlayCircle size={13} style={{ color: activeColors.textSecondary }} />
                                <Typography sx={{ fontSize: 11, fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                                  {contest.challenge_count} <span style={{ fontWeight: 400, color: activeColors.textSecondary }}>Challenges</span>
                                </Typography>
                              </Box>
                            </Box>
                          </Box>

                          {/* Action Button */}
                          <Box sx={{ width: { xs: '100%', sm: '230px' } }}>
                            <Button
                              fullWidth
                              onClick={() => handleSelectContest(contest)}
                              disabled={isUpcoming}
                              sx={{
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: 12.5,
                                textTransform: 'none',
                                py: 1.25,
                                borderRadius: '8px',
                                border: `1px solid ${isActive
                                  ? activeColors.primary
                                  : isEnded
                                    ? activeColors.border
                                    : 'rgba(209, 213, 219, 0.4)'
                                  }`,
                                bgcolor: isActive ? activeColors.primary : isEnded ? 'transparent' : 'transparent',
                                color: isActive ? '#fff' : isEnded ? activeColors.text : '#a1a1aa',
                                fontWeight: 700,
                                '&:hover': {
                                  bgcolor: isActive
                                    ? activeColors.primaryDark
                                    : isEnded
                                      ? activeColors.tagBg
                                      : 'transparent',
                                  borderColor: isActive ? activeColors.primaryDark : activeColors.primary,
                                  color: isActive ? '#fff' : activeColors.primary,
                                },
                                '&:disabled': {
                                  color: activeColors.textSecondary,
                                  bgcolor: theme === 'dark' ? 'rgba(31, 41, 55, 0.3)' : 'rgba(0,0,0,0.03)',
                                  borderColor: activeColors.border,
                                }
                              }}
                            >
                              {isActive ? (
                                '[ ENTER CONTEST ]'
                              ) : isUpcoming ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, justifyContent: 'center' }}>
                                  <Lock size={13} />
                                  <span>[ NOT STARTED ]</span>
                                </Box>
                              ) : (
                                '[ VIEW ARCHIVE ]'
                              )}
                            </Button>
                          </Box>
                        </Box>
                      </Box>
                    </motion.div>
                  );
                })
              ) : (
                <Box
                  sx={{
                    gridColumn: '1 / -1',
                    border: `1px dashed ${activeColors.border}`,
                    p: 6,
                    borderRadius: '12px',
                    textAlign: 'center',
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                >
                  <Typography sx={{ fontSize: 13, color: activeColors.textSecondary }}>
                    {'>'} No contests match the current filters.
                  </Typography>
                </Box>
              )}
            </motion.div>
          </AnimatePresence>
        )}

      </Box>

      {/* Sticky Footer */}
      <Box
        component="footer"
        sx={{
          mt: 'auto',
          borderTop: `1px solid ${activeColors.border}`,
          bgcolor: theme === 'dark' ? 'rgba(17, 24, 39, 0.75)' : 'rgba(255, 255, 255, 0.75)',
          backdropFilter: 'blur(4px)',
          py: 2,
          position: 'relative',
          zIndex: 10,
        }}
      >
        <Box
          sx={{
            maxWidth: '1280px',
            mx: 'auto',
            px: 4,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Typography sx={{ fontSize: 10.5, color: activeColors.textSecondary }}>
            (c) 2026 Information Security Lab - FPT University Hanoi
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: activeColors.textSecondary, textAlign: { xs: 'center', sm: 'right' } }}>
            Address: Rooms D101 & D102, FPT University, Hoa Lac, Hanoi.
          </Typography>
        </Box>
      </Box>
    </div>
  );
}

export default Contests;
