import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';
import { actionLogService } from '../services/actionLogService';
import type { ActionLog } from '../models';
import { ACTION_TYPE_LABELS } from '../models';
import { Typography, Box } from '@mui/material';
import { Search, ChevronLeft, ChevronRight } from '@mui/icons-material';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export function ActionLogs() {
  const { theme } = useTheme();
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionTypeFilter, setActionTypeFilter] = useState<number | 'all'>('all');
  const [topicFilter, setTopicFilter] = useState<string>('all');

  useEffect(() => {
    fetchActionLogs();
  }, []);

  const fetchActionLogs = async () => {
    setLoading(true);
    try {
      const response = await actionLogService.getTeamActionLogs();
      if (response.success && response.data) {
        setLogs(response.data);
      }
    } catch (error) {
      console.error('Error fetching action logs:', error);
    } finally {
      setLoading(false);
    }
  };

  // Get unique topics for filter
  const uniqueTopics = useMemo(() => {
    const topics = new Set(logs.map(log => log.topicName));
    return Array.from(topics).sort();
  }, [logs]);

  // Filter and search logs
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Search filter
      const matchesSearch = 
        searchQuery === '' ||
        log.actionDetail.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.topicName.toLowerCase().includes(searchQuery.toLowerCase());

      // Action type filter
      const matchesActionType = 
        actionTypeFilter === 'all' || 
        log.actionType === actionTypeFilter;

      // Topic filter
      const matchesTopic = 
        topicFilter === 'all' || 
        log.topicName === topicFilter;

      return matchesSearch && matchesActionType && matchesTopic;
    });
  }, [logs, searchQuery, actionTypeFilter, topicFilter]);

  // Paginated logs
  const paginatedLogs = useMemo(() => {
    const startIndex = page * rowsPerPage;
    return filteredLogs.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredLogs, page, rowsPerPage]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    setPage(0);
  };

  const handleActionTypeFilterChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setActionTypeFilter(value === 'all' ? 'all' : parseInt(value, 10));
    setPage(0);
  };

  const handleTopicFilterChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTopicFilter(event.target.value);
    setPage(0);
  };

  const getActionTypeBadge = (actionType: number) => {
    const label = ACTION_TYPE_LABELS[actionType] || 'Unknown';
    let colorClass = '';
    
    switch (actionType) {
      case 1: // Access
        colorClass = theme === 'dark' 
          ? 'bg-blue-900/50 text-blue-300 border-blue-700' 
          : 'bg-blue-100 text-blue-700 border-blue-300';
        break;
      case 2: // Start
        colorClass = theme === 'dark'
          ? 'bg-green-900/50 text-green-300 border-green-700'
          : 'bg-green-100 text-green-700 border-green-300';
        break;
      case 3: // Correct
        colorClass = theme === 'dark'
          ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700'
          : 'bg-emerald-100 text-emerald-700 border-emerald-300';
        break;
      case 4: // Incorrect
        colorClass = theme === 'dark'
          ? 'bg-red-900/50 text-red-300 border-red-700'
          : 'bg-red-100 text-red-700 border-red-300';
        break;
      case 5: // Hint
        colorClass = theme === 'dark'
          ? 'bg-yellow-900/50 text-yellow-300 border-yellow-700'
          : 'bg-yellow-100 text-yellow-700 border-yellow-300';
        break;
      default:
        colorClass = theme === 'dark'
          ? 'bg-gray-800 text-gray-300 border-gray-700'
          : 'bg-gray-100 text-gray-700 border-gray-300';
    }
    
    return (
      <span className={`inline-block px-2 py-1 rounded border text-xs font-bold font-mono ${colorClass}`}>
        {label}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    const date = dayjs(dateString);
    return (
      <div className="font-mono">
        <div className={`text-sm font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
          {date.format('MMM DD, YYYY')}
        </div>
        <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          {date.format('HH:mm:ss')} ({date.fromNow()})
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <Box className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-orange-500 text-6xl mb-4 font-mono">[...]</div>
        <Typography className={`font-mono ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
          Loading action logs...
        </Typography>
      </Box>
    );
  }

  const totalPages = Math.ceil(filteredLogs.length / rowsPerPage);

  return (
    <div className="min-h-[70vh]">
      {/* Header */}
      <div className="mb-6">
        <h1 className={`text-2xl font-bold font-mono ${
          theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
        }`}>
          [TEAM_ACTION_LOGS]
        </h1>
      </div>

      {/* Filters */}
      <div className={`mb-6 rounded-lg border p-4 ${
        theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Search className={theme === 'dark' ? 'text-gray-500' : 'text-gray-400'} fontSize="small" />
            </div>
            <input
              type="text"
              placeholder="Search by detail, user, or topic..."
              value={searchQuery}
              onChange={handleSearchChange}
              className={`w-full rounded-lg border pl-10 pr-4 py-2 font-mono focus:outline-none focus:ring-2 transition-colors ${
                theme === 'dark'
                  ? 'bg-gray-800 border-gray-700 text-white focus:ring-orange-500'
                  : 'bg-gray-50 border-gray-300 text-gray-900 focus:ring-orange-500'
              }`}
            />
          </div>

          {/* Action Type Filter */}
          <div>
            <select
              value={actionTypeFilter}
              onChange={handleActionTypeFilterChange}
              className={`w-full rounded-lg border py-2 px-4 font-mono focus:outline-none focus:ring-2 transition-colors ${
                theme === 'dark'
                  ? 'bg-gray-800 border-gray-700 text-white focus:ring-orange-500'
                  : 'bg-gray-50 border-gray-300 text-gray-900 focus:ring-orange-500'
              }`}
            >
              <option value="all">All Actions</option>
              <option value={1}>Access Challenge</option>
              <option value={2}>Start Challenge</option>
              <option value={3}>Correct Flag</option>
              <option value={4}>Incorrect Flag</option>
              <option value={5}>Unlock Hint</option>
            </select>
          </div>

          {/* Topic Filter */}
          <div>
            <select
              value={topicFilter}
              onChange={handleTopicFilterChange}
              className={`w-full rounded-lg border py-2 px-4 font-mono focus:outline-none focus:ring-2 transition-colors ${
                theme === 'dark'
                  ? 'bg-gray-800 border-gray-700 text-white focus:ring-orange-500'
                  : 'bg-gray-50 border-gray-300 text-gray-900 focus:ring-orange-500'
              }`}
            >
              <option value="all">All Topics</option>
              {uniqueTopics.map(topic => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Results count */}
        <div className="mt-3">
          <Typography className={`text-sm font-mono ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            [i] Showing {filteredLogs.length} of {logs.length} logs
          </Typography>
        </div>
      </div>

      {/* Table */}
      <div className={`overflow-x-auto rounded-lg border ${
        theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <table className="min-w-full">
          <thead className={theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}>
            <tr>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                DATE & TIME
              </th>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                ACTION TYPE
              </th>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                TOPIC
              </th>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                DETAIL
              </th>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                USER
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedLogs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <Typography className={`font-mono ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    [i] No action logs found
                  </Typography>
                </td>
              </tr>
            ) : (
              paginatedLogs.map((log) => (
                <tr
                  key={log.actionId}
                  className={`border-t transition-colors ${
                    theme === 'dark'
                      ? 'border-gray-800 hover:bg-gray-800/50'
                      : 'border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <td className="px-4 py-3">
                    {formatDate(log.actionDate)}
                  </td>
                  <td className="px-4 py-3">
                    {getActionTypeBadge(log.actionType)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 rounded border text-xs font-bold font-mono ${
                      theme === 'dark'
                        ? 'bg-gray-800 text-gray-300 border-gray-700'
                        : 'bg-gray-100 text-gray-700 border-gray-300'
                    }`}>
                      {log.topicName}
                    </span>
                  </td>
                  <td className={`px-4 py-3 max-w-md ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    <div className="font-mono text-sm truncate">
                      {log.actionDetail}
                    </div>
                  </td>
                  <td className={`px-4 py-3 font-mono font-semibold ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    {log.userName}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Custom Pagination */}
        {filteredLogs.length > 0 && (
          <div className={`flex items-center justify-between px-4 py-3 border-t ${
            theme === 'dark' ? 'border-gray-800' : 'border-gray-200'
          }`}>
            <div className={`text-sm font-mono ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              Page {page + 1} of {totalPages} | Rows per page:
              <select
                value={rowsPerPage}
                onChange={handleChangeRowsPerPage}
                className={`ml-2 rounded border px-2 py-1 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                  theme === 'dark'
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                }`}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleChangePage(null, page - 1)}
                disabled={page === 0}
                className={`p-2 rounded border font-mono transition ${
                  page === 0
                    ? theme === 'dark'
                      ? 'border-gray-800 text-gray-600 cursor-not-allowed'
                      : 'border-gray-200 text-gray-400 cursor-not-allowed'
                    : theme === 'dark'
                      ? 'border-gray-700 text-orange-400 hover:bg-gray-800'
                      : 'border-gray-300 text-orange-600 hover:bg-gray-50'
                }`}
              >
                <ChevronLeft fontSize="small" />
              </button>
              <span className={`font-mono font-bold ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>
                {page + 1}
              </span>
              <button
                onClick={() => handleChangePage(null, page + 1)}
                disabled={page >= totalPages - 1}
                className={`p-2 rounded border font-mono transition ${
                  page >= totalPages - 1
                    ? theme === 'dark'
                      ? 'border-gray-800 text-gray-600 cursor-not-allowed'
                      : 'border-gray-200 text-gray-400 cursor-not-allowed'
                    : theme === 'dark'
                      ? 'border-gray-700 text-orange-400 hover:bg-gray-800'
                      : 'border-gray-300 text-orange-600 hover:bg-gray-50'
                }`}
              >
                <ChevronRight fontSize="small" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
