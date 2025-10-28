import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { configService } from '../services/configService';
import { Box } from '@mui/material';
import { useTheme } from '../context/ThemeContext';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function Home() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [statusMessage, setStatusMessage] = useState('initializing...');
  const [isContestActive, setIsContestActive] = useState(false);
  const [isComing, setIsComing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typedText, setTypedText] = useState('');
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [currentCommand, setCurrentCommand] = useState('');

  // Theme-aware colors
  const isDark = theme === 'dark';
  const colors = {
    // Terminal frame
    terminalBg: isDark ? '#000' : '#0a0a0a',
    terminalBorder: isDark ? '#3f3f46' : '#27272a', // Tăng độ sáng của border trong dark mode
    titleBarBg: isDark ? '#18181b' : '#18181b',
    
    // Text colors
    primary: '#22d3ee', // cyan stays same
    textPrimary: isDark ? '#a1a1aa' : '#d4d4d8',
    textSecondary: isDark ? '#71717a' : '#a1a1aa',
    textMuted: isDark ? '#52525b' : '#71717a',
    
    // Borders and backgrounds
    borderColor: isDark ? '#27272a' : '#3f3f46',
    borderLight: isDark ? '#3f3f46' : '#52525b',
    bgDark: isDark ? '#09090b' : '#18181b',
    bgLight: isDark ? '#000' : '#0a0a0a',
    
    // Decorations
    decorationBg: isDark ? '#ffffff' : '#3f3f46', // Tăng độ sáng cho ASCII art
    gridOpacity: isDark ? 0.08 : 0.05, // Tăng độ sáng của lưới trong dark mode
  };

  // Terminal typing effect
  useEffect(() => {
    const text = 'fctf_platform_v3.0';
    let index = 0;
    const timer = setInterval(() => {
      if (index < text.length) {
        setTypedText(text.slice(0, index + 1));
        index++;
      } else {
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);

  // Continuous terminal commands effect
  useEffect(() => {
    const commands = [
      { cmd: '$ checking_network_status', output: 'connection: stable | latency: 12ms' },
      { cmd: '$ scanning_for_threats', output: 'scan_complete: 0_threats_detected' },
      { cmd: '$ monitoring_user_activity', output: 'active_users: 247 | new_submissions: 15' },
      { cmd: '$ verifying_challenge_integrity', output: 'integrity_check: passed | flags: secure' },
      { cmd: '$ syncing_scoreboard_data', output: 'sync_complete | last_update: just_now' },
      { cmd: '$ checking_system_resources', output: 'cpu: 23% | memory: 41% | disk: 68%' },
      { cmd: '$ analyzing_traffic_patterns', output: 'traffic: normal | requests: 1.2k/min' },
      { cmd: '$ updating_challenge_pool', output: 'challenges_loaded: 42 | difficulty: mixed' },
    ];

    let commandIndex = 0;
    let charIndex = 0;
    let isTypingCommand = true;
    const maxLines = 6;

    const timer = setInterval(() => {
      if (isTypingCommand) {
        // Type command character by character
        const currentCmd = commands[commandIndex].cmd;
        if (charIndex < currentCmd.length) {
          setCurrentCommand(currentCmd.slice(0, charIndex + 1));
          charIndex++;
        } else {
          // Command fully typed, switch to output
          isTypingCommand = false;
          charIndex = 0;
        }
      } else {
        // Show output and prepare for next command
        const output = commands[commandIndex].output;
        setTerminalOutput((prev) => {
          const newOutput = [...prev, currentCommand, `  ${output}`];
          // Keep only last maxLines
          return newOutput.slice(-maxLines);
        });
        
        // Move to next command
        commandIndex = (commandIndex + 1) % commands.length;
        setCurrentCommand('');
        isTypingCommand = true;
        charIndex = 0;
      }
    }, isTypingCommand ? 50 : 1500); // Fast typing, slower between commands

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchDateConfig = async () => {
      try {
        const config = await configService.getDateConfig();
        
        if (!config) {
          setStatusMessage('error_fetch_config');
          setLoading(false);
          return;
        }

        const { message, start_date, end_date } = config;

        if (message === 'CTFd has not been started' && start_date) {
          const startDate = new Date(start_date * 1000);
          if (new Date() < startDate) {
            setStatusMessage('contest_pending');
            setIsComing(true);
            setIsContestActive(false);
            startCountdown(startDate);
          }
        } else if (message === 'CTFd has been started' && end_date) {
          const endDate = new Date(end_date * 1000);
          if (new Date() < endDate) {
            setIsContestActive(true);
            setStatusMessage('contest_active');
            startCountdown(endDate);
          }
        } else {
          setStatusMessage('contest_terminated');
        }
        
        setLoading(false);
      } catch (error) {
        setStatusMessage('connection_failed');
        console.error('Fetch error:', error);
        setLoading(false);
      }
    };

    fetchDateConfig();
  }, []);

  const startCountdown = (targetDate: Date) => {
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const difference = targetDate.getTime() - now;

      if (difference <= 0) {
        clearInterval(timer);
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        setStatusMessage('event_started');
        setIsContestActive(true);
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

  const getStatusColor = () => {
    if (loading) return colors.textSecondary;
    if (isContestActive) return colors.primary;
    if (isComing) return '#eab308';
    return colors.textSecondary;
  };

  const getStatusSymbol = () => {
    if (loading) return '...';
    if (isContestActive) return '●';
    if (isComing) return '◆';
    return '○';
  };

  if (loading) {
    return (
      <Box className="flex items-center justify-center min-h-[70vh] font-mono">
        <Box sx={{ textAlign: 'center' }}>
          <Box sx={{ color: colors.primary, fontSize: '14px', mb: 2 }}>
            <span style={{ color: colors.textSecondary }}>$</span> loading_contest_data
          </Box>
          <Box sx={{ color: colors.textSecondary, fontSize: '12px' }}>
            [{Array(3).fill('█').join('')}
            {Array(5).fill('░').join('')}] 
            <span style={{ marginLeft: '8px' }}>37%</span>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <div className="min-h-[70vh] p-4 font-mono flex items-center justify-center relative">
      {/* Background Grid Pattern */}
      <Box sx={{ 
        position: 'absolute',
        inset: 0,
        backgroundImage: `linear-gradient(rgba(34, 211, 238, ${colors.gridOpacity}) 1px, transparent 1px), linear-gradient(90deg, rgba(34, 211, 238, ${colors.gridOpacity}) 1px, transparent 1px)`,
        backgroundSize: '50px 50px',
        pointerEvents: 'none',
        zIndex: 0
      }} />

      {/* Floating ASCII Art Decorations */}
      <Box sx={{ 
        position: 'absolute',
        top: '10%',
        left: '5%',
        color: colors.decorationBg,
        fontSize: '10px',
        lineHeight: 1,
        fontFamily: 'monospace',
        opacity: isDark ? 0.6 : 0.4, // Tăng opacity trong dark mode
        userSelect: 'none',
        display: { xs: 'none', md: 'block' }
      }}>
        <pre>{`
   ◢◣
  ◢███◣
 ◢█████◣
◢███████◣
 ███████
  █████
   ███
    █`}</pre>
      </Box>

      <Box sx={{ 
        position: 'absolute',
        top: '15%',
        right: '8%',
        color: colors.decorationBg,
        fontSize: '9px',
        lineHeight: 1.2,
        fontFamily: 'monospace',
        opacity: isDark ? 0.5 : 0.3, // Tăng opacity trong dark mode
        userSelect: 'none',
        display: { xs: 'none', lg: 'block' }
      }}>
        <pre>{`
┌─────────┐
│ CTF 2025│
│ ▓▓▓▓▓░░ │
│ [LIVE]  │
└─────────┘`}</pre>
      </Box>

      <Box sx={{ 
        position: 'absolute',
        bottom: '15%',
        left: '8%',
        color: colors.decorationBg,
        fontSize: '10px',
        lineHeight: 1.1,
        fontFamily: 'monospace',
        opacity: isDark ? 0.55 : 0.35, // Tăng opacity trong dark mode
        userSelect: 'none',
        display: { xs: 'none', lg: 'block' }
      }}>
        <pre>{`
{CTF}
 ║║║
 ║║║
▓▓▓▓▓`}</pre>
      </Box>

      <Box sx={{ 
        position: 'absolute',
        bottom: '20%',
        right: '10%',
        color: colors.decorationBg,
        fontSize: '8px',
        lineHeight: 1.3,
        fontFamily: 'monospace',
        opacity: isDark ? 0.5 : 0.3, // Tăng opacity trong dark mode
        userSelect: 'none',
        display: { xs: 'none', md: 'block' }
      }}>
        <pre>{`
 ██╗ ██╗
████████
 ██║ ██║
 ╚═╝ ╚═╝`}</pre>
      </Box>

      {/* Corner Brackets */}
      <Box sx={{ 
        position: 'absolute',
        top: '5%',
        left: '3%',
        color: isDark ? colors.borderLight : colors.borderColor, // Sáng hơn trong dark mode
        fontSize: '40px',
        fontFamily: 'monospace',
        opacity: isDark ? 0.7 : 0.5, // Tăng opacity trong dark mode
        userSelect: 'none',
        display: { xs: 'none', lg: 'block' }
      }}>
        ┌
      </Box>

      <Box sx={{ 
        position: 'absolute',
        top: '5%',
        right: '3%',
        color: isDark ? colors.borderLight : colors.borderColor,
        fontSize: '40px',
        fontFamily: 'monospace',
        opacity: isDark ? 0.7 : 0.5,
        userSelect: 'none',
        display: { xs: 'none', lg: 'block' }
      }}>
        ┐
      </Box>

      <Box sx={{ 
        position: 'absolute',
        bottom: '5%',
        left: '3%',
        color: isDark ? colors.borderLight : colors.borderColor,
        fontSize: '40px',
        fontFamily: 'monospace',
        opacity: isDark ? 0.7 : 0.5,
        userSelect: 'none',
        display: { xs: 'none', lg: 'block' }
      }}>
        └
      </Box>

      <Box sx={{ 
        position: 'absolute',
        bottom: '5%',
        right: '3%',
        color: isDark ? colors.borderLight : colors.borderColor,
        fontSize: '40px',
        fontFamily: 'monospace',
        opacity: isDark ? 0.7 : 0.5,
        userSelect: 'none',
        display: { xs: 'none', lg: 'block' }
      }}>
        ┘
      </Box>

      {/* Cyan Accent Lines */}
      <Box sx={{ 
        position: 'absolute',
        top: '30%',
        left: 0,
        width: '60px',
        height: '2px',
        background: isDark 
          ? 'linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.5), transparent)'
          : 'linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.3), transparent)',
        display: { xs: 'none', md: 'block' }
      }} />

      <Box sx={{ 
        position: 'absolute',
        bottom: '35%',
        right: 0,
        width: '60px',
        height: '2px',
        background: isDark 
          ? 'linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.5), transparent)'
          : 'linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.3), transparent)',
        display: { xs: 'none', md: 'block' }
      }} />

      {/* PC Window Frame */}
      <Box sx={{ 
        maxWidth: '900px', 
        width: '100%',
        bgcolor: colors.terminalBg,
        border: `2px solid ${colors.terminalBorder}`,
        boxShadow: isDark 
          ? '0 0 0 1px rgba(255,255,255,0.1), 0 0 30px rgba(34, 211, 238, 0.15), 0 20px 40px rgba(0,0,0,0.4)'
          : '0 0 0 1px rgba(0,0,0,0.1), 0 20px 40px rgba(0,0,0,0.2)',
        overflow: 'hidden',
        position: 'relative',
        zIndex: 10
      }}>
        {/* Window Title Bar */}
        <Box sx={{ 
          bgcolor: colors.titleBarBg,
          borderBottom: `1px solid ${colors.borderColor}`,
          p: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: '#ef4444', border: '1px solid #7f1d1d' }} />
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: '#eab308', border: '1px solid #713f12' }} />
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: colors.primary, border: '1px solid #164e63' }} />
            </Box>
            <Box sx={{ color: colors.textMuted, fontSize: '11px', ml: 1 }}>
              {typedText}<span style={{ opacity: 0.5 }}>▋</span>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Box sx={{ color: colors.textMuted, fontSize: '10px', fontFamily: 'monospace' }}>
              fctf_terminal
            </Box>
          </Box>
        </Box>

        {/* Terminal Content */}
        <Box sx={{ bgcolor: colors.terminalBg }}>
          <Box sx={{ p: 3 }}>
            {/* System Info */}
            <Box sx={{ mb: 3, color: colors.textSecondary, fontSize: '12px', lineHeight: 1.8 }}>
              <Box>
                <span style={{ color: colors.primary }}>system</span>: fpt_ctf_platform
              </Box>
              <Box>
                <span style={{ color: colors.primary }}>version</span>: 3.0.0-stable
              </Box>
              <Box>
                <span style={{ color: colors.primary }}>status</span>:{' '}
                <span style={{ color: getStatusColor() }}>
                  {getStatusSymbol()} {statusMessage}
                </span>
              </Box>
            </Box>

            {/* Main Display */}
            {(isContestActive || isComing) && (
              <>
                <Box sx={{ 
                  borderTop: `1px solid ${colors.borderColor}`,
                  borderBottom: `1px solid ${colors.borderColor}`,
                  py: 3,
                  my: 3
                }}>
                  <Box sx={{ color: colors.textPrimary, fontSize: '11px', mb: 2 }}>
                    [{isContestActive ? 'TIME_REMAINING' : 'COUNTDOWN_TO_START'}]
                  </Box>
                  
                  {/* Countdown Grid */}
                  <Box sx={{ 
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 2
                  }}>
                    {[
                      { value: timeLeft.days, label: 'DAYS', unit: 'd' },
                      { value: timeLeft.hours, label: 'HOURS', unit: 'h' },
                      { value: timeLeft.minutes, label: 'MINS', unit: 'm' },
                      { value: timeLeft.seconds, label: 'SECS', unit: 's' },
                    ].map((item, idx) => (
                      <Box key={idx} sx={{ 
                        border: `1px solid ${colors.borderColor}`,
                        p: 2,
                        textAlign: 'center'
                      }}>
                        <Box sx={{ 
                          color: colors.primary,
                          fontSize: '32px',
                          fontWeight: 'bold',
                          fontFamily: 'monospace',
                          lineHeight: 1
                        }}>
                          {String(item.value).padStart(2, '0')}
                        </Box>
                        <Box sx={{ 
                          color: colors.textMuted,
                          fontSize: '10px',
                          mt: 1,
                          letterSpacing: '0.05em'
                        }}>
                          [{item.label}]
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>

                {/* Progress Bar */}
                <Box sx={{ mb: 3 }}>
                  <Box sx={{ color: colors.textMuted, fontSize: '11px', mb: 1 }}>
                    [PROGRESS_INDICATOR]
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ flex: 1, height: 4, bgcolor: colors.terminalBorder, position: 'relative' }}>
                      <Box sx={{ 
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        height: '100%',
                        width: isContestActive ? '65%' : '25%',
                        bgcolor: isContestActive ? colors.primary : '#eab308',
                        transition: 'width 0.3s'
                      }} />
                    </Box>
                    <Box sx={{ color: colors.textSecondary, fontSize: '11px', minWidth: 40 }}>
                      {isContestActive ? '65%' : '25%'}
                    </Box>
                  </Box>
                </Box>
              </>
            )}

            {/* Live Terminal Output */}
            <Box sx={{ 
              border: `1px solid ${colors.borderColor}`,
              p: 2,
              bgcolor: colors.bgDark,
              height: '180px',
              overflow: 'hidden',
              fontFamily: 'monospace'
            }}>
              <Box sx={{ color: colors.textSecondary, fontSize: '11px', mb: 2 }}>
                [LIVE_SYSTEM_MONITOR]
              </Box>
              <Box sx={{ 
                color: colors.textPrimary, 
                fontSize: '11px', 
                lineHeight: 1.8,
                fontFamily: 'monospace'
              }}>
                {terminalOutput.map((line, idx) => (
                  <Box 
                    key={idx} 
                    sx={{ 
                      color: line.startsWith('$') ? colors.primary : colors.textSecondary,
                      opacity: idx < terminalOutput.length - 2 ? 0.6 : 1,
                      transition: 'opacity 0.3s'
                    }}
                  >
                    {line}
                  </Box>
                ))}
                {currentCommand && (
                  <Box sx={{ color: colors.primary }}>
                    {currentCommand}<span style={{ opacity: 0.7 }}>▋</span>
                  </Box>
                )}
              </Box>
            </Box>

            {/* Status Messages */}
            <Box sx={{ 
              border: `1px solid ${colors.borderColor}`,
              p: 2,
              bgcolor: colors.terminalBg,
              mt: 2
            }}>
              <Box sx={{ color: colors.textSecondary, fontSize: '11px', mb: 1 }}>
                <span style={{ color: colors.primary }}>$</span> ./status --verbose
              </Box>
              <Box sx={{ color: colors.textPrimary, fontSize: '12px', lineHeight: 1.6 }}>
                {isContestActive && (
                  <>
                    <Box>{'>'} contest_is_live</Box>
                    <Box>{'>'} capture_flags_and_score_points</Box>
                    <Box>{'>'} good_luck_hacker</Box>
                  </>
                )}
                {isComing && (
                  <>
                    <Box>{'>'} preparing_challenges</Box>
                    <Box>{'>'} initializing_scoreboard</Box>
                    <Box>{'>'} contest_starting_soon</Box>
                  </>
                )}
                {!isContestActive && !isComing && (
                  <>
                    <Box>{'>'} contest_has_ended</Box>
                    <Box>{'>'} check_scoreboard_for_results</Box>
                    <Box>{'>'} thank_you_for_participating</Box>
                  </>
                )}
              </Box>
            </Box>

            {/* Footer Stats */}
                        {/* Footer Stats */}
            <Box sx={{ 
              mt: 3,
              pt: 3,
              borderTop: `1px solid ${colors.borderColor}`,
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 2,
              fontSize: '11px'
            }}>
              <Box sx={{ color: colors.textMuted }}>
                fpt_university_2025
              </Box>
              <Box sx={{ display: 'flex', gap: 3 }}>
                <Box sx={{ color: colors.textSecondary }}>
                  uptime: <span style={{ color: colors.primary }}>99.9%</span>
                </Box>
                <Box sx={{ color: colors.textSecondary }}>
                  ping: <span style={{ color: colors.primary }}>12ms</span>
                </Box>
                <Box sx={{ color: colors.textSecondary }}>
                  ssl: <span style={{ color: colors.primary }}>secure</span>
                </Box>
              </Box>
            </Box>
          </Box>

          {/* Quick Actions - Inside Terminal */}
          <Box sx={{ 
            borderTop: `1px solid ${colors.borderColor}`,
            p: 3,
            bgcolor: colors.terminalBg,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 2
          }}>
            {[
              { label: 'view_challenges', key: 'F1', active: isContestActive, route: '/challenges' },
              { label: 'check_scoreboard', key: 'F2', active: true, route: '/scoreboard' },
              { label: 'submit_ticket', key: 'F3', active: true, route: '/tickets' },
            ].map((action, idx) => (
              <Box 
                key={idx} 
                onClick={() => action.active && navigate(action.route)}
                sx={{ 
                  border: `1px solid ${colors.borderColor}`,
                  p: 2,
                  bgcolor: action.active ? colors.bgDark : colors.terminalBg,
                  cursor: action.active ? 'pointer' : 'not-allowed',
                  opacity: action.active ? 1 : 0.5,
                  transition: 'all 0.2s',
                  '&:hover': action.active ? {
                    borderColor: colors.borderLight,
                    bgcolor: colors.terminalBorder
                  } : {}
                }}>
                <Box sx={{ 
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <Box sx={{ color: colors.textPrimary, fontSize: '12px' }}>
                    {action.label}
                  </Box>
                  <Box sx={{ 
                    color: colors.textMuted,
                    fontSize: '10px',
                    border: `1px solid ${colors.borderColor}`,
                    px: 0.5,
                    py: 0.25
                  }}>
                    {action.key}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </div>
  );
}