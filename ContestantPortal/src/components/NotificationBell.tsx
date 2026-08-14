import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { notificationService } from '../services/notificationService';
import type { AppNotification } from '../types/notification';
import {
  Badge,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Divider,
  Box,
} from '@mui/material';
import { NotificationsNoneOutlined, DoneAll } from '@mui/icons-material';
import { formatUTCToLocaleString } from '../utils/timezone';

const POLL_INTERVAL_MS = 30000;

export function NotificationBell() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { contestId } = useParams<{ contestId?: string }>();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recent, setRecent] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshUnreadCount = async () => {
    try {
      const count = await notificationService.unreadCount();
      setUnreadCount(count);
    } catch {
      // silent — the bell just keeps showing the last known count
    }
  };

  useEffect(() => {
    if (!contestId) return;
    refreshUnreadCount();
    pollRef.current = setInterval(refreshUnreadCount, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [contestId]);

  const handleOpen = async (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    setLoading(true);
    try {
      const data = await notificationService.list(1, 6);
      setRecent(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      setRecent([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => setAnchorEl(null);

  const handleItemClick = async (n: AppNotification) => {
    handleClose();
    if (!n.isRead) {
      try {
        await notificationService.markAsRead(n.id);
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // ignore — the notifications page will reconcile on next load
      }
    }
    navigate(contestId ? `/contest/${contestId}/notifications` : '/notifications');
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setUnreadCount(0);
      setRecent((list) => list.map((n) => ({ ...n, isRead: true })));
    } catch {
      // ignore
    }
  };

  const handleViewAll = () => {
    handleClose();
    navigate(contestId ? `/contest/${contestId}/notifications` : '/notifications');
  };

  return (
    <>
      <IconButton onClick={handleOpen} sx={{ position: 'relative' }}>
        <Badge
          badgeContent={unreadCount}
          max={99}
          color="error"
          overlap="circular"
        >
          <NotificationsNoneOutlined
            sx={{ color: theme === 'dark' ? 'rgb(209, 213, 219)' : 'rgb(75, 85, 99)' }}
          />
        </Badge>
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        PaperProps={{
          elevation: 0,
          sx: {
            mt: 1.5,
            width: 360,
            maxWidth: '90vw',
            borderRadius: 2,
            backgroundColor: theme === 'dark' ? 'rgb(17, 24, 39)' : 'rgb(255, 255, 255)',
            border: theme === 'dark' ? '1px solid rgb(55, 65, 81)' : '1px solid rgb(229, 231, 235)',
            overflow: 'hidden',
          },
        }}
      >
        <Box
          className={`px-4 py-3 border-b flex items-center justify-between ${
            theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
          }`}
        >
          <Typography className={`text-sm font-black font-mono ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
            NOTIFICATIONS
          </Typography>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className={`flex items-center gap-1 text-xs font-mono font-bold ${
                theme === 'dark' ? 'text-orange-400 hover:text-orange-300' : 'text-orange-600 hover:text-orange-700'
              }`}
            >
              <DoneAll fontSize="inherit" /> Mark all read
            </button>
          )}
        </Box>

        {loading ? (
          <Box className="px-4 py-6 text-center">
            <Typography className={`text-xs font-mono ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              Loading...
            </Typography>
          </Box>
        ) : recent.length === 0 ? (
          <Box className="px-4 py-6 text-center">
            <Typography className={`text-xs font-mono ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              No notifications yet
            </Typography>
          </Box>
        ) : (
          recent.map((n) => (
            <MenuItem
              key={n.id}
              onClick={() => handleItemClick(n)}
              sx={{
                display: 'block',
                whiteSpace: 'normal',
                px: 2,
                py: 1.2,
                borderLeft: n.isRead ? '3px solid transparent' : '3px solid #f97316',
                backgroundColor: n.isRead
                  ? 'transparent'
                  : theme === 'dark'
                  ? 'rgba(249, 115, 22, 0.06)'
                  : 'rgba(249, 115, 22, 0.05)',
              }}
            >
              <Typography
                sx={{
                  fontFamily: 'ui-monospace, monospace',
                  fontWeight: n.isRead ? 500 : 800,
                  fontSize: '0.8rem',
                  color: theme === 'dark' ? 'rgb(229, 231, 235)' : 'rgb(31, 41, 55)',
                }}
                noWrap
              >
                {n.title}
              </Typography>
              <Typography
                sx={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.72rem',
                  color: theme === 'dark' ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)',
                }}
                noWrap
              >
                {n.content}
              </Typography>
              <Typography
                sx={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.65rem',
                  mt: 0.3,
                  color: theme === 'dark' ? 'rgb(107, 114, 128)' : 'rgb(156, 163, 175)',
                }}
              >
                {formatUTCToLocaleString(n.createdAt, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Typography>
            </MenuItem>
          ))
        )}

        <Divider sx={{ borderColor: theme === 'dark' ? 'rgba(75, 85, 99, 0.5)' : 'rgba(229, 231, 235, 1)' }} />
        <MenuItem
          onClick={handleViewAll}
          sx={{
            justifyContent: 'center',
            fontFamily: 'ui-monospace, monospace',
            fontWeight: 700,
            fontSize: '0.8rem',
            color: theme === 'dark' ? '#fb923c' : '#f97316',
          }}
        >
          View All Notifications
        </MenuItem>
      </Menu>
    </>
  );
}
