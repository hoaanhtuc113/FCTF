import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { notificationService } from '../services/notificationService';
import type { AppNotification } from '../types/notification';
import { Typography, Box, CircularProgress } from '@mui/material';
import { ExpandMore, ExpandLess, DoneAll, MarkEmailRead } from '@mui/icons-material';
import { formatUTCToLocaleString } from '../utils/timezone';

const PER_PAGE = 20;

export function Notifications() {
  const { theme } = useTheme();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchNotifications = async (targetPage: number) => {
    try {
      setLoading(true);
      const data = await notificationService.list(targetPage, PER_PAGE);
      setNotifications(data.notifications);
      setTotal(data.total);
      setUnreadCount(data.unreadCount);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleToggle = async (n: AppNotification) => {
    const opening = expandedId !== n.id;
    setExpandedId(opening ? n.id : null);

    if (opening && !n.isRead) {
      try {
        await notificationService.markAsRead(n.id);
        setNotifications((list) =>
          list.map((item) => (item.id === n.id ? { ...item, isRead: true, readAt: new Date().toISOString() } : item))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications((list) => list.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  if (loading && notifications.length === 0) {
    return (
      <Box className="flex flex-col items-center justify-center min-h-[60vh]">
        <CircularProgress sx={{ color: '#f97316', mb: 2 }} />
        <Typography className={`font-mono ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
          Loading notifications...
        </Typography>
      </Box>
    );
  }

  return (
    <div className="min-h-[70vh]">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <h1 className={`text-2xl font-bold font-mono ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>
          [NOTIFICATIONS] {unreadCount > 0 && <span className="text-sm align-middle">({unreadCount} unread)</span>}
        </h1>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-bold font-mono transition-all border ${
              theme === 'dark'
                ? 'bg-gray-800 hover:bg-gray-700 text-orange-400 border-orange-700'
                : 'bg-white hover:bg-orange-50 text-orange-600 border-orange-300'
            }`}
          >
            <DoneAll fontSize="small" />
            MARK ALL READ
          </button>
        )}
      </div>

      {/* List */}
      <div className={`rounded-lg border overflow-hidden ${theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
        {notifications.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Typography className={`font-mono ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
              [i] No notifications yet
            </Typography>
          </div>
        ) : (
          notifications.map((n, idx) => {
            const isExpanded = expandedId === n.id;
            return (
              <div
                key={n.id}
                className={`px-4 py-3 cursor-pointer transition-colors ${
                  idx !== 0 ? (theme === 'dark' ? 'border-t border-gray-800' : 'border-t border-gray-100') : ''
                } ${theme === 'dark' ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'}`}
                onClick={() => handleToggle(n)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Typography
                          className={`font-mono ${n.isRead ? 'font-semibold' : 'font-black'} ${
                            theme === 'dark' ? 'text-white' : 'text-gray-900'
                          }`}
                        >
                          {n.title}
                        </Typography>
                        <span
                          className={`text-[10px] font-bold font-mono uppercase px-1.5 py-0.5 rounded ${
                            n.targetType === 'team'
                              ? theme === 'dark'
                                ? 'bg-blue-900/40 text-blue-300'
                                : 'bg-blue-100 text-blue-700'
                              : theme === 'dark'
                              ? 'bg-yellow-900/40 text-yellow-300'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {n.targetType}
                        </span>
                        {n.isRead && (
                          <MarkEmailRead fontSize="inherit" className={theme === 'dark' ? 'text-green-400' : 'text-green-600'} />
                        )}
                      </div>
                      {!isExpanded && (
                        <Typography
                          className={`font-mono text-sm truncate ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}
                        >
                          {n.content}
                        </Typography>
                      )}
                      <Typography className={`font-mono text-xs mt-0.5 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                        {n.authorName ? `From ${n.authorName} · ` : ''}
                        {formatUTCToLocaleString(n.createdAt, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Typography>
                      {isExpanded && (
                        <Typography
                          className={`font-mono text-sm mt-2 whitespace-pre-wrap ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}
                        >
                          {n.content}
                        </Typography>
                      )}
                    </div>
                  </div>
                  {isExpanded ? (
                    <ExpandLess className={theme === 'dark' ? 'text-gray-500' : 'text-gray-400'} />
                  ) : (
                    <ExpandMore className={theme === 'dark' ? 'text-gray-500' : 'text-gray-400'} />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`px-3 py-1 rounded font-mono text-sm font-bold border transition ${
                p === page
                  ? 'bg-orange-600 text-white border-orange-500'
                  : theme === 'dark'
                  ? 'border-gray-700 text-gray-400 hover:text-orange-400'
                  : 'border-gray-300 text-gray-600 hover:text-orange-600'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
