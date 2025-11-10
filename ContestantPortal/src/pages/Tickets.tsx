import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { fetchWithAuth } from '../services/api';
import { API_ENDPOINTS } from '../config/endpoints';
import { Typography, CircularProgress, Box } from '@mui/material';
import { 
  CheckCircle, 
  Cancel, 
  HourglassEmpty,
  Search,
  Add,
  Close,
  Delete,
  Visibility,
} from '@mui/icons-material';
import Swal from 'sweetalert2';

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

export function Tickets() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const ticketTypes = ['Question', 'Error', 'Inform'];

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    try {
      setLoading(true);
      const response = await fetchWithAuth(API_ENDPOINTS.TICKET.LIST);
      const data = await response.json();
      
      if (data && data.tickets) {
        setTickets(data.tickets);
      }
    } catch (error) {
      console.error('Error fetching tickets:', error);
      showAlert('Failed to load tickets', 'error');
    } finally {
      setLoading(false);
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const ticketData = {
      title: formData.get('title') as string,
      type: formData.get('type') as string,
      description: formData.get('description') as string,
    };

    try {
      const response = await fetchWithAuth(API_ENDPOINTS.TICKET.CREATE, {
        method: 'POST',
        body: JSON.stringify(ticketData),
      });

      const data = await response.json();

      if (data.status === true || response.ok) {
        showAlert('Ticket created successfully', 'success');
        setShowModal(false);
        fetchTickets();
      } else {
        showAlert(data.message || 'Failed to create ticket', 'error');
      }
    } catch (error) {
      console.error('Error creating ticket:', error);
      showAlert('Failed to create ticket', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTicketClick = (ticketId: string) => {
    navigate(`/tickets/${ticketId}`);
  };

  const handleDeleteTicket = async (ticketId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click event
    
    const result = await Swal.fire({
      html: `
        <div class="font-mono text-left text-sm">
          <div class="text-yellow-400 mb-2">[?] Delete Ticket</div>
          <div class="text-gray-400">> Are you sure you want to delete this ticket?</div>
          <div class="text-gray-400">> This action cannot be undone</div>
        </div>
      `,
      icon: 'warning',
      iconColor: '#fbbf24',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
      customClass: {
        popup: 'rounded-lg border border-yellow-500/30',
        confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
        cancelButton: 'bg-gray-600 hover:bg-gray-700 text-white font-mono px-4 py-2 rounded',
      },
    });

    if (result.isConfirmed) {
      try {
        const response = await fetchWithAuth(API_ENDPOINTS.TICKET.DELETE(ticketId), {
          method: 'DELETE',
        });

        const data = await response.json();

        if (response.ok) {
          showAlert('Ticket deleted successfully', 'success');
          fetchTickets(); // Refresh list
        } else {
          showAlert(data.message || 'Failed to delete ticket', 'error');
        }
      } catch (error) {
        console.error('Error deleting ticket:', error);
        showAlert('Failed to delete ticket', 'error');
      }
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'open':
        return <HourglassEmpty className="text-yellow-500" fontSize="small" />;
      case 'in_progress':
        return <HourglassEmpty className="text-orange-500" fontSize="small" />;
      case 'closed':
        return <CheckCircle className="text-green-500" fontSize="small" />;
      default:
        return <Cancel className="text-red-500" fontSize="small" />;
    }
  };

  const filteredTickets = tickets.filter((ticket) => {
    const matchesSearch =
      ticket.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      filterStatus === 'all' || ticket.status.toLowerCase() === filterStatus.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <Box className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-orange-500 text-6xl mb-4 font-mono">[...]</div>
        <Typography className={`font-mono ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
          Loading tickets...
        </Typography>
      </Box>
    );
  }

  return (
    <div className="min-h-[70vh]">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className={`text-2xl font-bold font-mono ${
          theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
        }`}>
          [SUPPORT_TICKETS]
        </h1>
        <button
          onClick={() => setShowModal(true)}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 font-bold font-mono transition-all border ${
            theme === 'dark'
              ? 'bg-orange-600 hover:bg-orange-700 text-white border-orange-500'
              : 'bg-orange-600 hover:bg-orange-700 text-white border-orange-500'
          }`}
        >
          <Add fontSize="small" />
          {'[+]'} NEW TICKET
        </button>
      </div>

      {/* Filters */}
      <div className={`mb-6 rounded-lg border p-4 ${
        theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Search className={theme === 'dark' ? 'text-gray-500' : 'text-gray-400'} fontSize="small" />
            </div>
            <input
              type="text"
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full rounded-lg border pl-10 pr-4 py-2 font-mono focus:outline-none focus:ring-2 transition-colors ${
                theme === 'dark'
                  ? 'bg-gray-800 border-gray-700 text-white focus:ring-orange-500'
                  : 'bg-gray-50 border-gray-300 text-gray-900 focus:ring-orange-500'
              }`}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className={`text-sm font-bold font-mono ${
              theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              STATUS:
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className={`rounded-lg border py-2 px-4 font-mono focus:outline-none focus:ring-2 transition-colors ${
                theme === 'dark'
                  ? 'bg-gray-800 border-gray-700 text-white focus:ring-orange-500'
                  : 'bg-gray-50 border-gray-300 text-gray-900 focus:ring-orange-500'
              }`}
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tickets Table */}
      <div className={`overflow-x-auto rounded-lg border ${
        theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <table className="min-w-full">
          <thead className={theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'}>
            <tr>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                ID
              </th>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                TITLE
              </th>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                TYPE
              </th>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                STATUS
              </th>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                DATE
              </th>
              <th className={`px-4 py-3 text-left text-xs font-bold font-mono uppercase ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                ACTION
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredTickets.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center">
                  <Typography className={`font-mono ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    [i] No tickets found
                  </Typography>
                </td>
              </tr>
            ) : (
              filteredTickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  className={`border-t cursor-pointer transition-colors ${
                    theme === 'dark'
                      ? 'border-gray-800 hover:bg-gray-800/50'
                      : 'border-gray-100 hover:bg-gray-50'
                  }`}
                  onClick={() => handleTicketClick(ticket.id)}
                >
                  <td className={`px-4 py-3 font-mono font-bold ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    #{ticket.id}
                  </td>
                  <td className={`px-4 py-3 font-mono font-semibold ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    {ticket.title}
                  </td>
                  <td className={`px-4 py-3 font-mono ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {ticket.type}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 font-mono">
                      {getStatusIcon(ticket.status)}
                      <span className={`capitalize ${
                        theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {ticket.status.replace('_', ' ')}
                      </span>
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-mono ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {ticket.date}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTicketClick(ticket.id);
                        }}
                        className={`px-3 py-1 rounded border font-bold font-mono text-xs transition flex items-center gap-1 ${
                          theme === 'dark'
                            ? 'border-orange-700 text-orange-400 hover:bg-orange-900/30'
                            : 'border-orange-300 text-orange-600 hover:bg-orange-50'
                        }`}
                        title="View ticket details"
                      >
                        <Visibility fontSize="small" />
                        VIEW
                      </button>
                      {/* Show delete button only for open tickets without reply */}
                      {ticket.status.toLowerCase() === 'open' && !ticket.replier_message && (
                        <button
                          onClick={(e) => handleDeleteTicket(ticket.id, e)}
                          className={`p-2 rounded transition ${
                            theme === 'dark'
                              ? 'text-red-400 hover:bg-red-900/30 hover:text-red-300'
                              : 'text-red-600 hover:bg-red-50 hover:text-red-700'
                          }`}
                          title="Delete ticket"
                        >
                          <Delete fontSize="small" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Ticket Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div
            className={`w-full max-w-md rounded-lg border p-6 ${
              theme === 'dark'
                ? 'bg-gray-900 border-gray-700'
                : 'bg-white border-gray-200'
            }`}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className={`text-xl font-bold font-mono ${
                theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
                [CREATE_TICKET]
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className={`p-2 rounded transition-colors ${
                  theme === 'dark'
                    ? 'hover:bg-gray-800 text-gray-400 hover:text-white'
                    : 'hover:bg-gray-100 text-gray-600 hover:text-gray-800'
                }`}
                disabled={submitting}
              >
                <Close />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label
                  htmlFor="title"
                  className={`mb-2 block text-sm font-bold font-mono ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  TITLE
                </label>
                <input
                  type="text"
                  id="title"
                  name="title"
                  className={`w-full rounded-lg border p-3 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${
                    theme === 'dark'
                      ? 'bg-gray-800 text-white border-gray-700'
                      : 'bg-white text-gray-900 border-gray-300'
                  }`}
                  required
                  disabled={submitting}
                />
              </div>
              <div className="mb-4">
                <label
                  htmlFor="type"
                  className={`mb-2 block text-sm font-bold font-mono ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  TYPE
                </label>
                <select
                  id="type"
                  name="type"
                  className={`w-full rounded-lg border p-3 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${
                    theme === 'dark'
                      ? 'bg-gray-800 text-white border-gray-700'
                      : 'bg-white text-gray-900 border-gray-300'
                  }`}
                  required
                  disabled={submitting}
                >
                  {ticketTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-6">
                <label
                  htmlFor="description"
                  className={`mb-2 block text-sm font-bold font-mono ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  DESCRIPTION
                </label>
                <textarea
                  id="description"
                  name="description"
                  className={`w-full rounded-lg border p-3 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all ${
                    theme === 'dark'
                      ? 'bg-gray-800 text-white border-gray-700'
                      : 'bg-white text-gray-900 border-gray-300'
                  }`}
                  rows={4}
                  required
                  disabled={submitting}
                ></textarea>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-orange-600 hover:bg-orange-700 px-4 py-3 text-white font-bold font-mono transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <CircularProgress size={20} sx={{ color: 'white' }} />
                    {'[...]'} SUBMITTING...
                  </>
                ) : (
                  <>{' [+] CREATE TICKET'}</>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}