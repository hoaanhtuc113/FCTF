import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { fetchWithAuth } from '../services/api';
import { API_ENDPOINTS } from '../config/endpoints';
import { Typography, Box } from '@mui/material';
import { 
  ArrowBack,
  Person,
  CalendarToday,
  Reply,
  CheckCircle,
  Cancel,
  HourglassEmpty,
} from '@mui/icons-material';

interface Ticket {
  id: string;
  title: string;
  type: string;
  status: string;
  description: string;
  date: string;
  author_name: string;
  replier_name?: string;
  replier_message?: string;
}

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchTicketDetail();
    }
  }, [id]);

  const fetchTicketDetail = async () => {
    try {
      setLoading(true);
      const response = await fetchWithAuth(API_ENDPOINTS.TICKET.DETAIL(id!));
      const data = await response.json();
      
      if (data) {
        setTicket(data);
      }
    } catch (error) {
      console.error('Error fetching ticket:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusLower = status.toLowerCase();
    let icon, colorClass, borderClass;

    switch (statusLower) {
      case 'open':
        icon = <HourglassEmpty fontSize="small" />;
        colorClass = 'text-yellow-500';
        borderClass = 'border-yellow-500';
        break;
      case 'in_progress':
        icon = <HourglassEmpty fontSize="small" />;
        colorClass = 'text-cyan-500';
        borderClass = 'border-cyan-500';
        break;
      case 'closed':
        icon = <CheckCircle fontSize="small" />;
        colorClass = 'text-green-500';
        borderClass = 'border-green-500';
        break;
      default:
        icon = <Cancel fontSize="small" />;
        colorClass = 'text-red-500';
        borderClass = 'border-red-500';
    }

    return (
      <span className={`inline-flex items-center gap-2 px-3 py-1 rounded border font-mono font-bold text-sm ${colorClass} ${borderClass}`}>
        {icon}
        {status.toUpperCase()}
      </span>
    );
  };

  if (loading) {
    return (
      <Box className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-cyan-500 text-6xl mb-4 font-mono">[...]</div>
        <Typography className={`font-mono ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
          Loading ticket...
        </Typography>
      </Box>
    );
  }

  if (!ticket) {
    return (
      <Box className="flex flex-col items-center justify-center min-h-[60vh]">
        <Typography className={`font-mono text-xl ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`}>
          [!] Ticket not found
        </Typography>
        <button
          onClick={() => navigate('/tickets')}
          className={`mt-4 flex items-center gap-2 px-4 py-2 rounded-lg font-bold font-mono transition-all border ${
            theme === 'dark'
              ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600'
              : 'bg-gray-200 hover:bg-gray-300 text-gray-800 border-gray-300'
          }`}
        >
          <ArrowBack fontSize="small" />
          {'[<]'} BACK
        </button>
      </Box>
    );
  }

  return (
    <div className="min-h-[70vh]">
      {/* Back Button */}
      <button
        onClick={() => navigate('/tickets')}
        className={`mb-4 flex items-center gap-2 px-4 py-2 rounded-lg font-bold font-mono transition-all border ${
          theme === 'dark'
            ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600'
            : 'bg-gray-200 hover:bg-gray-300 text-gray-800 border-gray-300'
        }`}
      >
        <ArrowBack fontSize="small" />
        {'[<]'} BACK TO LIST
      </button>

      {/* Main Card */}
      <div className={`rounded-lg border overflow-hidden ${
        theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`p-6 border-b ${
          theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
        }`}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <h1 className={`text-2xl font-bold font-mono ${
              theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'
            }`}>
              [TICKET_DETAIL]
            </h1>
            {getStatusBadge(ticket.status)}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column - Info */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Person className={theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'} />
                <div>
                  <p className={`text-sm font-bold font-mono mb-1 ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    AUTHOR
                  </p>
                  <p className={`font-mono ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    {ticket.author_name}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CalendarToday className={theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'} />
                <div>
                  <p className={`text-sm font-bold font-mono mb-1 ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    CREATED
                  </p>
                  <p className={`font-mono ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    {ticket.date}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Reply className={theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'} />
                <div>
                  <p className={`text-sm font-bold font-mono mb-1 ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    TYPE
                  </p>
                  <p className={`font-mono ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    {ticket.type}
                  </p>
                </div>
              </div>

              {ticket.replier_name && (
                <div className="flex items-start gap-3">
                  <Reply className={theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'} />
                  <div>
                    <p className={`text-sm font-bold font-mono mb-1 ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      REPLIER
                    </p>
                    <p className={`font-mono ${
                      theme === 'dark' ? 'text-white' : 'text-gray-900'
                    }`}>
                      {ticket.replier_name}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column - Content */}
            <div className="space-y-4">
              <div>
                <h2 className={`text-lg font-bold mb-2 font-mono ${
                  theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'
                }`}>
                  [TITLE]
                </h2>
                <p className={`font-mono p-3 rounded-lg border ${
                  theme === 'dark'
                    ? 'bg-gray-800 border-gray-700 text-gray-200'
                    : 'bg-gray-50 border-gray-200 text-gray-800'
                }`}>
                  {ticket.title}
                </p>
              </div>

              <div>
                <h2 className={`text-lg font-bold mb-2 font-mono ${
                  theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'
                }`}>
                  [DESCRIPTION]
                </h2>
                <p className={`font-mono p-3 rounded-lg border min-h-[100px] whitespace-pre-wrap ${
                  theme === 'dark'
                    ? 'bg-gray-800 border-gray-700 text-gray-200'
                    : 'bg-gray-50 border-gray-200 text-gray-800'
                }`}>
                  {ticket.description}
                </p>
              </div>

              {ticket.replier_message && (
                <div>
                  <h2 className={`text-lg font-bold mb-2 font-mono ${
                    theme === 'dark' ? 'text-green-400' : 'text-green-600'
                  }`}>
                    [REPLY]
                  </h2>
                  <p className={`font-mono p-3 rounded-lg border min-h-[100px] whitespace-pre-wrap ${
                    theme === 'dark'
                      ? 'bg-green-900/20 border-green-500/30 text-gray-200'
                      : 'bg-green-50 border-green-200 text-gray-800'
                  }`}>
                    {ticket.replier_message}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
