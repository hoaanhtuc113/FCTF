import { useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useTheme } from '../context/ThemeContext';
import { fetchWithAuth } from '../services/api';
import { API_ENDPOINTS } from '../config/endpoints';
import { Terminal, Refresh, ContentCopy } from '@mui/icons-material';
import Swal from 'sweetalert2';
import { useNavigate } from 'react-router-dom';
import { formatUTCToLocaleString } from '../utils/timezone';

interface ChallengeInstance {
  challenge_id: number;
  challenge_name: string;
  category: string;
  status: string;
  pod_name: string;
  challenge_url: string;
  ready: boolean;
  age: string;
}

export function Instances() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [instances, setInstances] = useState<ChallengeInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stoppingIds, setStoppingIds] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const fetchInstances = async (showRefreshing = false) => {
    try {
      if (showRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.INSTANCES, {
        method: 'GET'
      });
      const data = await response.json();
      if (data.success && data.data) {
        setInstances(data.data);
      }
    } catch (error) {
      console.error('Error fetching instances:', error);
      Swal.fire({
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-red-400 mb-2">[!] Error</div>
            <div class="text-gray-400">> Failed to load instances</div>
          </div>
        `,
        icon: 'error',
        iconColor: '#ef4444',
        confirmButtonText: 'OK',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        customClass: {
          popup: 'rounded-lg border border-red-500/30',
          confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
        },
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    await fetchInstances(true);
  };

  useEffect(() => {
    fetchInstances();
    // Refresh every 5 seconds
    // const interval = setInterval(fetchInstances, 5000);
    // return () => clearInterval(interval);
  }, []);

  const handleStop = async (challengeId: number, challengeName: string) => {
    const result = await Swal.fire({
      html: `
        <div class="font-mono text-left text-sm">
          <div class="text-orange-400 mb-2">[?] Stop challenge</div>
          <div class="text-gray-400 mb-2">> Challenge: ${challengeName}</div>
          <div class="text-gray-400">> Confirm stop?</div>
        </div>
      `,
      icon: 'question',
      iconColor: '#fb923c',
      showCancelButton: true,
      confirmButtonText: 'Stop',
      cancelButtonText: 'Cancel',
      background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
      customClass: {
        popup: 'rounded-lg border border-orange-500/30',
        confirmButton: 'bg-orange-500 hover:bg-orange-600 text-white font-mono px-4 py-2 rounded',
        cancelButton: 'bg-gray-600 hover:bg-gray-700 text-white font-mono px-4 py-2 rounded',
      },
    });

    if (!result.isConfirmed) return;

    setStoppingIds(prev => new Set(prev).add(challengeId));

    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.STOP, {
        method: 'POST',
        body: JSON.stringify({
          challengeId: challengeId,
        })
      });
      const data = await response.json();

      if (data.success) {
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-green-400 mb-2">[✓] Success</div>
              <div class="text-gray-400">> Challenge stopped</div>
            </div>
          `,
          icon: 'success',
          iconColor: '#22c55e',
          confirmButtonText: 'OK',
          timer: 2000,
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          customClass: {
            popup: 'rounded-lg border border-green-500/30',
            confirmButton: 'bg-green-500 hover:bg-green-600 text-white font-mono px-4 py-2 rounded',
          },
        });
        // Refresh instances list
        await fetchInstances();
      } else {
        throw new Error(data.message || 'Failed to stop challenge');
      }
    } catch (error: any) {
      console.error('Error stopping challenge:', error);
      Swal.fire({
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-red-400 mb-2">[!] Error</div>
            <div class="text-gray-400">> ${error.message || 'Failed to stop challenge'}</div>
          </div>
        `,
        icon: 'error',
        iconColor: '#ef4444',
        confirmButtonText: 'OK',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        customClass: {
          popup: 'rounded-lg border border-red-500/30',
          confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
        },
      });
    } finally {
      setStoppingIds(prev => {
        const next = new Set(prev);
        next.delete(challengeId);
        return next;
      });
    }
  };

  const handleNavigateToChallenge = (challengeId: number, category: string) => {
    // Navigate to challenges page with category selected and challenge opened
    navigate(`/challenges?category=${encodeURIComponent(category)}&challenge=${challengeId}`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Running':
        return theme === 'dark' 
          ? 'text-green-400 bg-green-500/20 border-green-500/30' 
          : 'text-green-700 bg-green-100 border-green-300';
      case 'Pending':
        return theme === 'dark'
          ? 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30'
          : 'text-yellow-700 bg-yellow-100 border-yellow-300';
      case 'Failed':
        return theme === 'dark'
          ? 'text-red-400 bg-red-500/20 border-red-500/30'
          : 'text-red-700 bg-red-100 border-red-300';
      case 'Succeeded':
        return theme === 'dark'
          ? 'text-blue-400 bg-blue-500/20 border-blue-500/30'
          : 'text-blue-700 bg-blue-100 border-blue-300';
      default:
        return theme === 'dark'
          ? 'text-gray-400 bg-gray-700 border-gray-600'
          : 'text-gray-600 bg-gray-100 border-gray-300';
    }
  };

  const parseUnixTimeToDate = (unixTime: string) => {
    const unixTimeInt = parseInt(unixTime);
    if (isNaN(unixTimeInt) || unixTimeInt <= 0) {
      return 'N/A';
    }
    return formatUTCToLocaleString(unixTimeInt);
  }

  const parseAndFormatURL = (rawUrl: string) => {
    // Remove "Connection string: " prefix
    const cleaned = rawUrl.replace(/^Connection string:\s*/i, '').trim();
    
    // Split host and port
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 2) {
      const host = parts[0];
      const port = parts[1];
      
      return `${host}:${port}`;
    }
    return cleaned;
  }

  const handleCopyURL = (url: string, challengeId: number) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(challengeId);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch((err) => {
      console.error('Failed to copy URL:', err);
    });
  }

  if (loading) {
    return (
      <Box className="flex flex-col items-center justify-center min-h-[60vh]">
        <Terminal className={`text-4xl mb-4 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`} />
        <CircularProgress size={24} className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} />
        <p className={`mt-4 font-mono text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
          [~] Loading instances...
        </p>
      </Box>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className={`text-2xl font-mono font-bold ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>
            [#] Running Instances
          </h1>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`flex items-center gap-2 px-4 py-2 rounded font-mono text-sm border transition-colors ${
              refreshing
                ? theme === 'dark'
                  ? 'bg-gray-700 border-gray-600 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
                : theme === 'dark'
                ? 'bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/30'
                : 'bg-orange-100 text-orange-700 border-orange-300 hover:bg-orange-200'
            }`}
          >
            <Refresh className={`text-lg ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? '[REFRESHING...]' : '[REFRESH]'}
          </button>
        </div>
        <p className={`font-mono text-sm ${
          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
        }`}>
          &gt; Manage your active challenge deployments
        </p>
      </div>

      {instances.length === 0 ? (
        <div className={`text-center py-12 border rounded-lg ${
          theme === 'dark' 
            ? 'bg-gray-800/50 border-gray-700 text-gray-400' 
            : 'bg-gray-50 border-gray-300 text-gray-600'
        }`}>
          <Terminal className="text-4xl mb-4 mx-auto" />
          <p className="font-mono text-sm">No running instances</p>
          <p className="font-mono text-xs mt-2">Start a challenge to see it here</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full font-mono text-sm border-collapse ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
          }`}>
            <thead>
              <tr className={`${
                theme === 'dark' 
                  ? 'bg-gray-800 border-gray-700' 
                  : 'bg-gray-100 border-gray-300'
              } border-b`}>
                <th className="text-left py-3 px-2 font-mono" style={{ width: '5%' }}>ID</th>
                <th className="text-left py-3 px-3 font-mono" style={{ width: '15%' }}>Challenge</th>
                <th className="text-left py-3 px-2 font-mono" style={{ width: '8%' }}>Cat</th>
                <th className="text-left py-3 px-2 font-mono" style={{ width: '8%' }}>Status</th>
                <th className="text-left py-3 px-3 font-mono" style={{ width: '35%' }}>Your Access Token</th>
                <th className="text-left py-3 px-2 font-mono" style={{ width: '12%' }}>Age</th>
                <th className="text-right py-3 px-2 font-mono" style={{ width: '17%' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((instance) => {
                const formattedURL = parseAndFormatURL(instance.challenge_url);
                return (
                <tr 
                  key={instance.challenge_id}
                  className={`border-b transition-colors ${
                    theme === 'dark'
                      ? 'border-gray-700 hover:bg-gray-800/50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <td className="py-3 px-2 text-xs" style={{ width: '5%' }}>{instance.challenge_id}</td>
                  <td className="py-3 px-3 font-semibold text-sm truncate" style={{ width: '15%' }} title={instance.challenge_name}>
                    {instance.challenge_name}
                  </td>
                  <td className="py-3 px-2" style={{ width: '8%' }}>
                    <span className={`px-2 py-1 rounded text-xs border ${
                      theme === 'dark'
                        ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                        : 'bg-blue-100 text-blue-700 border-blue-300'
                    }`}>
                      {instance.category}
                    </span>
                  </td>
                  <td className="py-3 px-2" style={{ width: '8%' }}>
                    <span className={`px-2 py-1 rounded text-xs border font-semibold ${getStatusColor(instance.status)}`}>
                      {instance.status}
                    </span>
                  </td>
                  <td className="py-3 px-3" style={{ width: '35%' }}>
                    {instance.status === 'Running' ? (
                      <div className="flex items-center gap-2">
                        <code className={`text-xs break-all ${
                          theme === 'dark' ? 'text-orange-400' : 'text-orange-700'
                        }`}>
                          {formattedURL}
                        </code>
                        <button
                          onClick={() => handleCopyURL(formattedURL, instance.challenge_id)}
                          className={`px-2 py-1.5 rounded transition-colors shrink-0 flex items-center gap-1 text-xs ${
                            copiedId === instance.challenge_id
                              ? theme === 'dark'
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : 'bg-green-100 text-green-700 border border-green-300'
                              : theme === 'dark'
                              ? 'bg-gray-700 hover:bg-gray-600 text-gray-400'
                              : 'bg-gray-200 hover:bg-gray-300 text-gray-600'
                          }`}
                          title="Copy URL"
                        >
                          {copiedId === instance.challenge_id ? (
                            <>✓ Copied</>
                          ) : (
                            <ContentCopy sx={{ fontSize: 14 }} />
                          )}
                        </button>
                      </div>
                    ) : (
                      <span className={`text-xs italic ${
                        theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                      }`}>
                        [Not available]
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-xs" style={{ width: '12%' }}>{parseUnixTimeToDate(instance.age)}</td>
                  <td className="py-3 px-2" style={{ width: '17%' }}>
                    <div className="flex justify-end gap-1">
                      <button
                            onClick={() => handleNavigateToChallenge(instance.challenge_id, instance.category)}
                            className={`px-2 py-1.5 text-xs rounded transition-colors ${
                              theme === 'dark'
                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30'
                                : 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'
                            }`}
                            title="Open challenge"
                          >
                            [GO]
                          </button>
                      {instance.status === 'Running' && (
                        <>
                          <button
                            onClick={() => handleStop(instance.challenge_id, instance.challenge_name)}
                            disabled={stoppingIds.has(instance.challenge_id)}
                            className={`px-2 py-1.5 text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              theme === 'dark'
                                ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                                : 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                            }`}
                            title="Stop challenge"
                          >
                            [STOP]
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
