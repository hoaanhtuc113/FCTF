import { Typography, CircularProgress, Box, Chip, Tabs, Tab } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useEffect, useState, useRef } from 'react';
import { challengeService } from '../services/challengeService';
import { useTheme } from '../context/ThemeContext';
import { 
  LockOpen, 
  Lock, 
  EmojiEvents, 
  Timer, 
  ReplayCircleFilled,
  CheckCircle,
  Terminal,
  Security,
  Description,
  PictureAsPdf,
  Close,
} from '@mui/icons-material';
import { FaDownload } from 'react-icons/fa';
import Swal from 'sweetalert2';
import { saveAs } from 'file-saver';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Document, Page, pdfjs } from 'react-pdf';
import { fetchWithAuth, downloadFile } from '../services/api';
import { API_ENDPOINTS } from '../config/endpoints';

// Setup PDF worker
// Setup PDF worker - Use jsDelivr CDN (supports CORS)
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Category {
  topic_name: string;
  challenge_count: number;
}

interface Challenge {
  id: number;
  name: string;
  value: number;
  solve_by_myteam: boolean;
  solves?: number;
  time_limit: number;
  max_attempts: number;
  category: string;
  description?: string;
  files?: string[];
  type?: string;
  attemps?: number;
  require_deploy?: boolean;
  is_captain?: boolean;
}

interface Hint {
  id: number;
  cost: number;
  content?: string;
}

export function Challenges() {
  const { theme } = useTheme();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingChallenges, setLoadingChallenges] = useState(false);
  const [error, setError] = useState('');
  const [isContestActive, setIsContestActive] = useState(false);

  useEffect(() => {
    const fetchDataAsync = async () => {
      try {
        setLoading(true);
        
        const config = await challengeService.getContestStatus();
        setIsContestActive(config?.isActive || false);

        const data = await challengeService.getCategories();
        setCategories(Array.isArray(data) ? data : []);
        
        if (data.length > 0) {
          setSelectedCategory(data[0].topic_name);
          await fetchChallenges(data[0].topic_name);
        }
        
        setLoading(false);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Failed to load challenges. Please try again later.');
        setLoading(false);
      }
    };

    fetchDataAsync();
  }, []);

  const fetchChallenges = async (categoryName: string) => {
    try {
      setLoadingChallenges(true);
      const data = await challengeService.getChallengesByTopic(categoryName);
      setChallenges(Array.isArray(data) ? data : []);
      setLoadingChallenges(false);
    } catch (err) {
      console.error('Error fetching challenges:', err);
      setChallenges([]);
      setLoadingChallenges(false);
    }
  };

  const handleCategoryClick = async (categoryName: string) => {
    setSelectedCategory(categoryName);
    setSelectedChallenge(null);
    await fetchChallenges(categoryName);
  };

  const handleChallengeClick = async (challenge: Challenge) => {
    if (!isContestActive) return;
    
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.DETAIL(challenge.id), {
        method: 'GET'
      });
      const data = await response.json();
      setSelectedChallenge(data.data);
    } catch (error) {
      console.error('Error fetching challenge details:', error);
      setSelectedChallenge(challenge);
    }
  };

  const getCategoryIcon = (name: string) => {
    const iconMap: { [key: string]: React.JSX.Element } = {
      'Web': <Security className="text-lg" />,
      'Pwm': <Terminal className="text-lg" />,
      'Crypto': <LockOpen className="text-lg" />,
      'Reverse': <Security className="text-lg" />,
      'Forensics': <Security className="text-lg" />,
      'Misc': <Security className="text-lg" />,
    };
    return iconMap[name] || <Security className="text-lg" />;
  };

  if (loading) {
    return (
      <Box className="flex flex-col items-center justify-center min-h-[60vh]">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Terminal className="text-orange-500 text-6xl mb-4" />
        </motion.div>
        <Typography className={`font-mono ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
          Loading challenges...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Typography className="text-red-600 font-bold text-xl mb-2">⚠️ Error</Typography>
          <Typography className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
            {error}
          </Typography>
        </div>
      </Box>
    );
  }

  return (
    <div className="flex gap-4 min-h-[70vh] relative">
      {/* Column 1: Categories */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="w-56 flex-shrink-0"
      >
        <div className={`rounded-2xl shadow-2xl border p-4 sticky top-24 overflow-hidden ${
          theme === 'dark'
            ? 'bg-gradient-to-br from-gray-800 via-gray-900 to-gray-800 border-orange-500/30'
            : 'bg-gradient-to-br from-white via-gray-50 to-white border-orange-200'
        }`}>
          <div className="absolute inset-0 bg-gradient-to-r from-orange-500/5 to-orange-400/5 animate-pulse" />
          
          <div className="relative z-10">
            <div className={`flex items-center gap-2 mb-4 pb-3 border-b ${
              theme === 'dark' ? 'border-orange-400/30' : 'border-orange-200'
            }`}>
              <Terminal className={theme === 'dark' ? 'text-orange-400' : 'text-orange-500'} />
              <Typography variant="h6" className={`font-bold font-mono text-sm ${
                theme === 'dark' ? 'text-white' : 'text-gray-800'
              }`}>
                {'> CATEGORIES'}
              </Typography>
            </div>
            
            <div className="space-y-2">
              {categories.map((category, index) => (
                <motion.button
                  key={category.topic_name}
                  onClick={() => handleCategoryClick(category.topic_name)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-200 flex items-center justify-between group relative overflow-hidden ${
                    selectedCategory === category.topic_name
                      ? 'bg-gradient-to-r from-orange-500 to-orange-400 text-white shadow-lg shadow-orange-500/30'
                      : theme === 'dark'
                      ? 'bg-gray-800/50 hover:bg-gray-700/70 text-gray-100 border border-gray-700/50'
                      : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'
                  }`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  whileHover={{ x: 4, transition: { duration: 0.2 } }}
                  whileTap={{ scale: 0.98 }}
                >
                  {selectedCategory !== category.topic_name && (
                    <div className="absolute inset-0 bg-gradient-to-r from-orange-500/0 via-orange-500/10 to-orange-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  )}
                  
                  <div className="flex items-center gap-2 relative z-10">
                    {getCategoryIcon(category.topic_name)}
                    <div className="flex-1">
                      <div className="font-bold text-xs font-mono">
                        {category.topic_name.toUpperCase()}
                      </div>
                      <div className={`text-xs mt-0.5 font-mono ${
                        selectedCategory === category.topic_name
                          ? 'text-orange-100'
                          : theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        [{category.challenge_count}]
                      </div>
                    </div>
                  </div>
                  
                  {selectedCategory === category.topic_name && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-2 h-2 bg-white rounded-full shadow-lg shadow-white/50"
                    />
                  )}
                </motion.button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Column 2: Challenge List */}
      <div className={selectedChallenge ? "w-96 flex-shrink-0" : "flex-1"}>
        {!isContestActive && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mb-4 p-3 rounded-xl border-2 ${
              theme === 'dark'
                ? 'bg-gradient-to-r from-yellow-900/30 to-orange-900/30 border-yellow-500/50'
                : 'bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-400/50'
            }`}
          >
            <Typography className={`text-center font-bold font-mono text-sm flex items-center justify-center gap-2 ${
              theme === 'dark' ? 'text-yellow-300' : 'text-yellow-700'
            }`}>
              <Lock fontSize="small" />
              {'> CONTEST NOT ACTIVE'}
            </Typography>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={selectedCategory}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div 
              className="mb-4 relative"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
            >
              <div className="flex items-center gap-2">
                <Terminal className="text-orange-500 text-3xl" />
                <div>
                  <h1 className={`text-2xl font-bold font-mono ${
                    theme === 'dark'
                      ? 'text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-orange-500 to-orange-400'
                      : 'text-transparent bg-clip-text bg-gradient-to-r from-orange-600 via-orange-500 to-orange-600'
                  }`}>
                    {selectedCategory.toUpperCase()}
                  </h1>
                  <div className="flex gap-2 mt-1">
                    <div className="h-1 w-8 bg-gradient-to-r from-orange-500 to-transparent rounded-full" />
                    <div className="h-1 w-6 bg-gradient-to-r from-orange-400 to-transparent rounded-full" />
                  </div>
                </div>
              </div>
            </motion.div>

            {loadingChallenges ? (
              <Box className="flex flex-col items-center justify-center py-12">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                  <Terminal className="text-orange-500 text-4xl mb-2" />
                </motion.div>
                <Typography className={`font-mono text-sm ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-500'
                }`}>
                  Fetching challenges...
                </Typography>
              </Box>
            ) : challenges.length > 0 ? (
              <div className="space-y-2">
                {challenges.map((challenge, index) => (
                  <ChallengeListItem
                    key={challenge.id}
                    challenge={challenge}
                    isContestActive={isContestActive}
                    index={index}
                    onClick={() => handleChallengeClick(challenge)}
                    isSelected={selectedChallenge?.id === challenge.id}
                  />
                ))}
              </div>
            ) : (
              <Box className="text-center py-12">
                <Lock className={theme === 'dark' ? 'text-gray-500' : 'text-gray-400'} sx={{ fontSize: 48 }} />
                <Typography className={`font-mono mt-3 text-sm ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-500'
                }`}>
                  {'> NO CHALLENGES FOUND'}
                </Typography>
              </Box>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Column 3: Challenge Detail */}
      <AnimatePresence mode="wait">
        {selectedChallenge && (
          <motion.div
            key={selectedChallenge.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex-1"
          >
            <ChallengeDetailPanel 
              challenge={selectedChallenge} 
              theme={theme}
              onClose={() => setSelectedChallenge(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Challenge List Item Component
function ChallengeListItem({
  challenge,
  isContestActive,
  index,
  onClick,
  isSelected,
}: {
  challenge: Challenge;
  isContestActive: boolean;
  index: number;
  onClick: () => void;
  isSelected: boolean;
}) {
  const { theme } = useTheme();
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (isContestActive) {
      onClick();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={`relative group ${
        !isContestActive ? 'cursor-not-allowed' : 'cursor-pointer'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {isHovered && isContestActive && (
        <motion.div
          className={`absolute -inset-0.5 rounded-lg opacity-40 blur ${
            challenge.solve_by_myteam
              ? 'bg-gradient-to-r from-green-400 to-emerald-400'
              : 'bg-gradient-to-r from-orange-400 to-orange-500'
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.4 }}
          transition={{ duration: 0.3 }}
        />
      )}

      <motion.div
        className={`relative border rounded-lg shadow transition-all duration-300 overflow-hidden ${
          isSelected
            ? 'border-orange-500 bg-orange-500/10'
            : !isContestActive
            ? theme === 'dark'
              ? 'bg-gray-800/50 border-gray-600 opacity-60'
              : 'bg-white border-gray-300 opacity-60'
            : challenge.solve_by_myteam
            ? theme === 'dark'
              ? 'bg-gradient-to-br from-green-900/50 to-emerald-900/50 border-green-500/60 hover:border-green-400'
              : 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-400 hover:border-green-500'
            : theme === 'dark'
            ? 'bg-gray-800/90 border-gray-600 hover:border-orange-500'
            : 'bg-white border-gray-300 hover:border-orange-400'
        }`}
        whileHover={isContestActive ? { x: 3, transition: { duration: 0.2 } } : {}}
      >
        {isHovered && isContestActive && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-b from-transparent via-orange-500/5 to-transparent"
            initial={{ y: '-100%' }}
            animate={{ y: '100%' }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}

        <div className="relative z-10 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {challenge.solve_by_myteam ? (
                  <CheckCircle className="text-green-500 flex-shrink-0" sx={{ fontSize: 20 }} />
                ) : isContestActive ? (
                  <LockOpen className="text-orange-500 flex-shrink-0" sx={{ fontSize: 20 }} />
                ) : (
                  <Lock className={`flex-shrink-0 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`} sx={{ fontSize: 20 }} />
                )}
                
                <h3
                  className={`text-base font-bold font-mono truncate ${
                    challenge.solve_by_myteam
                      ? 'text-green-600 dark:text-green-400'
                      : isContestActive
                      ? theme === 'dark' ? 'text-gray-100' : 'text-gray-800'
                      : theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                  }`}
                  title={challenge.name}
                >
                  {challenge.name}
                </h3>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Chip
                  icon={<EmojiEvents sx={{ fontSize: 14 }} />}
                  label={`${challenge.value}pts`}
                  size="small"
                  sx={{
                    height: '22px',
                    fontSize: '0.7rem',
                    fontFamily: 'monospace',
                    fontWeight: 'bold',
                    '& .MuiChip-icon': { fontSize: 14 },
                    ...(challenge.solve_by_myteam
                      ? { backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.5)' }
                      : { backgroundColor: 'rgba(249, 115, 22, 0.2)', color: '#fb923c', border: '1px solid rgba(249, 115, 22, 0.5)' }
                    )
                  }}
                />

                {challenge.solves !== undefined && (
                  <Chip
                    label={`${challenge.solves}`}
                    size="small"
                    sx={{
                      height: '22px',
                      fontSize: '0.7rem',
                      fontFamily: 'monospace',
                      backgroundColor: 'rgba(59, 130, 246, 0.2)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59, 130, 246, 0.5)'
                    }}
                  />
                )}
              </div>
            </div>

            {isContestActive && challenge.solve_by_myteam && (
              <CheckCircle className="text-green-500 flex-shrink-0" fontSize="small" />
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Challenge Detail Panel Component
function ChallengeDetailPanel({ 
  challenge, 
  theme,
  onClose 
}: { 
  challenge: Challenge; 
  theme: string;
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [hints, setHints] = useState<Hint[]>([]);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isChallengeStarted, setIsChallengeStarted] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [isSubmittingFlag, setIsSubmittingFlag] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedPdfIndex, setSelectedPdfIndex] = useState<number | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [unlockingHintId, setUnlockingHintId] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  // Filter PDF files
  const pdfFiles = challenge.files?.filter(file => file.toLowerCase().includes('.pdf')) || [];
  const hasDescription = !!challenge.description;
  const hasPdfFiles = pdfFiles.length > 0;

  useEffect(() => {
    fetchHints();
    fetchChallengeStatus();

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [challenge.id]);

  useEffect(() => {
    if (isChallengeStarted && timeRemaining && timeRemaining > 0) {
      timerRef.current = window.setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev && prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev ? prev - 1 : null;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isChallengeStarted, timeRemaining]);

  const fetchHints = async () => {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.HINTS.GET_ALL(challenge.id), {
        method: 'GET'
      });
      const data = await response.json();
      if (data.hints) {
        setHints(data.hints.hints || []);
      }
    } catch (error) {
      console.error('Error fetching hints:', error);
    }
  };

  const fetchChallengeStatus = async () => {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.DETAIL(challenge.id), {
        method: 'GET'
      });
      const data = await response.json();
      if (data.data) {
        console.log('Challenge status data:', data.data);
        setTimeRemaining(data.data.time_limit);
        setIsChallengeStarted(data.data.is_started || false);
        setUrl(data.challenge_url || null);
      }
    } catch (error) {
      console.error('Error fetching challenge status:', error);
    }
  };

  const handleStartChallenge = async () => {
    setIsStarting(true);
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.START, {
        method: 'POST',
        body: JSON.stringify({
          challenge_id: challenge.id,
          generatedToken: localStorage.getItem('accessToken'),
        })
      });
      const data = await response.json();

      if (data.success) {
        setIsChallengeStarted(true);
        setUrl(data.challenge_url || null);
        await fetchChallengeStatus();
        Swal.fire({
          title: 'Success!',
          text: 'Challenge started successfully.',
          icon: 'success',
          confirmButtonText: 'OK',
        });
      }
    } catch (error) {
      Swal.fire({
        title: 'Error!',
        text: 'Failed to start challenge.',
        icon: 'error',
        confirmButtonText: 'OK',
      });
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopChallenge = async () => {
    setIsStopping(true);
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.STOP, {
        method: 'POST',
        body: JSON.stringify({
          challenge_id: challenge.id,
          generatedToken: localStorage.getItem('accessToken'),
        })
      });
      const data = await response.json();

      if (data.isSuccess) {
        setIsChallengeStarted(false);
        setUrl(null);
        Swal.fire({
          title: 'Success!',
          text: 'Challenge stopped successfully.',
          icon: 'success',
          confirmButtonText: 'OK',
        });
      }
    } catch (error) {
      Swal.fire({
        title: 'Error!',
        text: 'Failed to stop challenge.',
        icon: 'error',
        confirmButtonText: 'OK',
      });
    } finally {
      setIsStopping(false);
    }
  };

  const handleSubmitFlag = async () => {
    if (!answer.trim()) {
      Swal.fire({
        title: 'Empty Flag!',
        text: 'Please enter a flag before submitting.',
        icon: 'warning',
        confirmButtonText: 'OK',
      });
      return;
    }

    setIsSubmittingFlag(true);
    try {
      const formData = new FormData();
      formData.append('challengeId', challenge.id.toString());
      formData.append('submission', answer);
      formData.append('generatedToken', localStorage.getItem('accessToken') || '');

      const MANAGEMENT_API_URL = import.meta.env.VITE_MANAGEMENT_API_URL || import.meta.env.VITE_API_URL;
      const token = localStorage.getItem('accessToken');
      
      const response = await fetch(`${MANAGEMENT_API_URL}${API_ENDPOINTS.FLAGS.SUBMIT}`, {
        method: 'POST',
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: formData,
      });

      const data = await response.json();
      
      if (data?.data?.status === 'correct') {
        Swal.fire({
          title: 'Correct Flag!',
          text: 'You have solved the challenge!',
          icon: 'success',
          confirmButtonText: 'OK',
        });
        setAnswer('');
      } else {
        Swal.fire({
          title: 'Incorrect Flag!',
          text: 'The flag you entered is incorrect.',
          icon: 'error',
          confirmButtonText: 'OK',
        });
      }
    } catch (error) {
      Swal.fire({
        title: 'Error!',
        text: 'Error submitting flag.',
        icon: 'error',
        confirmButtonText: 'OK',
      });
    } finally {
      setIsSubmittingFlag(false);
    }
  };

  const formatTime = (seconds: number | string | null) => {
    console.log('Formatting time for seconds:', seconds);
    if (challenge?.time_limit === -1) return '∞';
    if (seconds === null || seconds === undefined) return '--:--';
    
    // Convert to number and validate
    const numSeconds = typeof seconds === 'string' ? parseFloat(seconds) : seconds;
    
    if (isNaN(numSeconds)) return '--:--';
    
    // Ensure seconds is a positive number
    const totalSeconds = Math.max(0, Math.floor(numSeconds));
    
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

const getFileName = (filePath : string) => {
  try {
    // Check if it's a URL with query parameters
    if (filePath.includes('?path=')) {
      // Extract the path parameter value
      const urlObj = new URL(filePath, window.location.origin);
      const pathParam = urlObj.searchParams.get('path');
      if (pathParam) {
        // Get filename from the path parameter
        const pathParts = pathParam.split('/');
        return pathParts[pathParts.length - 1];
      }
    }
    
    // Fallback to original logic for simple paths
    const pathParts = filePath.split("/");
    const fullName = pathParts[pathParts.length - 1];
    return fullName.split("?")[0];
  } catch (error) {
    console.error("Error parsing filename:", error);
    return "download";
  }
};

  const handleDownloadFile = async (filePath: string) => {
    try {
      const blob = await downloadFile(filePath);
      saveAs(blob, getFileName(filePath));
    } catch (error) {
      console.error('Error downloading file:', error);
      Swal.fire({
        title: 'Download Error!',
        text: 'Failed to download file.',
        icon: 'error',
        confirmButtonText: 'OK',
      });
    }
  };

  const FetchHintDetails = async (hintId: number) => {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.HINTS.GET_DETAIL(hintId), {
        method: 'GET'
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching hint details:', error);
      return null;
    }
  };

  const HintUnlocks = async (hintId: number) => {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.HINTS.UNLOCK, {
        method: 'POST',
        body: JSON.stringify({
          type: "hints",
          target: hintId,
        })
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Failed to unlock hint:", error);
      return { success: false, errors: error.response?.data?.errors || {} };
    }
  };

  const handleUnlockHint = async (hintId: number, hintCost: number) => {
    if (unlockingHintId === hintId) return; // Prevent double click
    
    try {
      setUnlockingHintId(hintId);
      
      // Fetch hint details first to check if already unlocked
      const hintDetailsResponse = await FetchHintDetails(hintId);
      
      if (!hintDetailsResponse?.data) {
        Swal.fire({
          title: "Error!",
          text: "Failed to fetch hint data",
          icon: "error",
          confirmButtonText: "OK",
          background: theme === 'dark' ? '#1f2937' : '#ffffff',
          color: theme === 'dark' ? '#ffffff' : '#000000',
        });
        return;
      }

      // Check if hint is already unlocked
      if (hintDetailsResponse?.data.content) {
        Swal.fire({
          title: "💡 Hint Details",
          html: `<div class="text-left"><strong>Details:</strong><br/>${hintDetailsResponse.data.content || "No content available."}</div>`,
          icon: "info",
          confirmButtonText: "Got it!",
          background: theme === 'dark' ? '#1f2937' : '#ffffff',
          color: theme === 'dark' ? '#ffffff' : '#000000',
          customClass: {
            popup: 'rounded-2xl',
          }
        });
        return;
      }

      // Show confirmation dialog with GenZ style
      const result = await Swal.fire({
        title: "🤔 Unlock Hint?",
        html: `<div class="text-lg">This will cost you <span class="font-bold text-pink-500">${hintCost}</span> points.<br/>Are you sure you want to continue?</div>`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Yes, unlock it! 🔓",
        cancelButtonText: "Nah, cancel 🚫",
        reverseButtons: true,
        background: theme === 'dark' ? '#1f2937' : '#ffffff',
        color: theme === 'dark' ? '#ffffff' : '#000000',
        customClass: {
          popup: 'rounded-2xl',
          confirmButton: 'bg-gradient-to-r from-green-400 to-blue-500 hover:from-blue-500 hover:to-green-400',
          cancelButton: 'bg-gradient-to-r from-red-400 to-pink-500 hover:from-pink-500 hover:to-red-400',
        }
      });

      if (result.isConfirmed) {
        // Call unlock API
        const response = await HintUnlocks(hintId);
        
        if (response?.success) {
          // Fetch hint details again after unlock
          const updatedHintDetails = await FetchHintDetails(hintId);
          
          if (updatedHintDetails?.data) {
            Swal.fire({
              title: "🎉 Unlocked!",
              html: `<div class="text-left"><strong>Hint:</strong><br/>${updatedHintDetails.data.content || "No content available."}</div>`,
              icon: "success",
              confirmButtonText: "Awesome! 🚀",
              background: theme === 'dark' ? '#1f2937' : '#ffffff',
              color: theme === 'dark' ? '#ffffff' : '#000000',
              customClass: {
                popup: 'rounded-2xl',
              }
            });
            
            // Refresh hints list
            fetchHints();
          } else {
            Swal.fire({
              title: "✅ Unlocked!",
              text: "Hint unlocked, but no details available.",
              icon: "info",
              confirmButtonText: "OK",
              background: theme === 'dark' ? '#1f2937' : '#ffffff',
              color: theme === 'dark' ? '#ffffff' : '#000000',
            });
          }
        } else {
          // Handle errors
          if (response.errors?.score) {
            Swal.fire({
              title: "❌ Error!",
              text: response.errors.score,
              icon: "error",
              confirmButtonText: "OK",
              background: theme === 'dark' ? '#1f2937' : '#ffffff',
              color: theme === 'dark' ? '#ffffff' : '#000000',
            });
          } else if (response.errors?.target) {
            const errorMessage = response.errors.target;
            
            if (errorMessage === "You've already unlocked this this target") {
              const hintDetailsResponse = await FetchHintDetails(hintId);
              
              if (hintDetailsResponse?.data) {
                Swal.fire({
                  title: "ℹ️ Already Unlocked",
                  html: `<div class="text-left">You've already unlocked this hint.<br/><strong>Details:</strong><br/>${hintDetailsResponse.data.content || "No content available."}</div>`,
                  icon: "info",
                  confirmButtonText: "OK",
                  background: theme === 'dark' ? '#1f2937' : '#ffffff',
                  color: theme === 'dark' ? '#ffffff' : '#000000',
                });
              } else {
                Swal.fire({
                  title: "ℹ️ Already Unlocked",
                  text: "You've already unlocked this hint, but no details are available.",
                  icon: "info",
                  confirmButtonText: "OK",
                  background: theme === 'dark' ? '#1f2937' : '#ffffff',
                  color: theme === 'dark' ? '#ffffff' : '#000000',
                });
              }
            } else {
              Swal.fire({
                title: "❌ Error!",
                text: errorMessage,
                icon: "error",
                confirmButtonText: "OK",
                background: theme === 'dark' ? '#1f2937' : '#ffffff',
                color: theme === 'dark' ? '#ffffff' : '#000000',
              });
            }
          } else {
            Swal.fire({
              title: "❌ Error!",
              text: "An error occurred while unlocking the hint.",
              icon: "error",
              confirmButtonText: "OK",
              background: theme === 'dark' ? '#1f2937' : '#ffffff',
              color: theme === 'dark' ? '#ffffff' : '#000000',
            });
          }
        }
      } else {
        Swal.fire({
          title: "🚫 Cancelled",
          text: "Unlocking the hint was cancelled.",
          icon: "info",
          confirmButtonText: "OK",
          background: theme === 'dark' ? '#1f2937' : '#ffffff',
          color: theme === 'dark' ? '#ffffff' : '#000000',
          timer: 2000,
          timerProgressBar: true,
        });
      }
    } catch (error) {
      Swal.fire({
        title: "💥 Error!",
        text: "An error occurred while processing your request.",
        icon: "error",
        confirmButtonText: "OK",
        background: theme === 'dark' ? '#1f2937' : '#ffffff',
        color: theme === 'dark' ? '#ffffff' : '#000000',
      });
      console.error("Error in handleUnlockHint:", error);
    } finally {
      setUnlockingHintId(null);
    }
  };

  const handlePdfClick = async (index: number) => {
    setSelectedPdfIndex(index);
    setPageNumber(1);
    setLoadingPdf(true);
    
    // Revoke previous blob URL if exists
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }

    try {
      // Download PDF with authentication
      const blob = await downloadFile(pdfFiles[index]);
      
      // Create blob URL
      const blobUrl = URL.createObjectURL(blob);
      setPdfBlobUrl(blobUrl);
    } catch (error) {
      console.error('Error loading PDF:', error);
      Swal.fire({
        title: 'Error!',
        text: 'Failed to load PDF file.',
        icon: 'error',
        confirmButtonText: 'OK',
      });
      setSelectedPdfIndex(null);
    } finally {
      setLoadingPdf(false);
    }
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const closePdfViewer = () => {
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }
    setSelectedPdfIndex(null);
    setNumPages(null);
    setPageNumber(1);
  };

  // Cleanup blob URL when component unmounts or PDF changes
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);

  return (
    <>
      <div className={`flex gap-4 h-full ${
        selectedPdfIndex !== null ? 'w-full' : ''
      }`}>
        {/* Main Challenge Detail Panel */}
        <div className={`rounded-2xl shadow-2xl border overflow-hidden transition-all duration-300 ${
          selectedPdfIndex !== null ? 'w-1/2' : 'w-full'
        } ${
          theme === 'dark'
            ? 'bg-gray-800 border-orange-500/30'
            : 'bg-white border-orange-200'
        }`}>
          <div className="p-6 space-y-4 h-full overflow-y-auto">
            {/* Header with Timer */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h2 className="text-2xl font-bold font-mono text-orange-500">
                  {challenge.name}
                </h2>
              </div>
              
              <div className="flex items-center gap-2">
                {/* Timer for deploy challenges */}
                {challenge.require_deploy && (
                  <div className={`flex items-center gap-2 px-3 py-1 rounded-lg border ${
                    theme === 'dark' 
                      ? 'bg-gray-900 border-orange-500/30' 
                      : 'bg-orange-50 border-orange-300'
                  }`}>
                    <Timer className="text-orange-500" sx={{ fontSize: 20 }} />
                    <span className={`font-mono text-sm font-bold ${
                      isChallengeStarted ? 'text-green-400' : 'text-orange-400'
                    }`}>
                      {formatTime(timeRemaining)}
                    </span>
                  </div>
                )}
                
                {challenge.solve_by_myteam && (
                  <Chip
                    icon={<CheckCircle />}
                    label="SOLVED"
                    sx={{
                      backgroundColor: 'rgba(34, 197, 94, 0.2)',
                      color: '#4ade80',
                      fontWeight: 'bold',
                    }}
                  />
                )}
                
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-white transition-colors text-2xl"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Info Badges */}
            <div className="flex flex-wrap gap-2">
              {/* <Chip
                icon={<EmojiEvents />}
                label={`${challenge.value} pts`}
                size="small"
                sx={{
                  backgroundColor: 'rgba(249, 115, 22, 0.2)',
                  color: '#fb923c',
                  fontFamily: 'monospace',
                }}
              /> */}
              <Chip
                icon={<Timer />}
                label={challenge.time_limit === -1 ? '∞' : `${challenge.time_limit}s`}
                size="small"
                sx={{
                  backgroundColor: 'rgba(168, 85, 247, 0.2)',
                  color: '#c084fc',
                  fontFamily: 'monospace',
                }}
              />
              <Chip
                icon={<ReplayCircleFilled />}
                label={challenge.max_attempts === 0 ? '∞' : challenge.max_attempts}
                size="small"
                sx={{
                  backgroundColor: 'rgba(6, 182, 212, 0.2)',
                  color: '#22d3ee',
                  fontFamily: 'monospace',
                }}
              />
            </div>

            {/* Files */}
            {challenge.files && challenge.files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {challenge.files.map((file, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      if (file.toLowerCase().includes('.pdf')) {
                        const pdfIndex = pdfFiles.indexOf(file);
                        handlePdfClick(pdfIndex);
                        // Switch to the corresponding PDF tab
                        setSelectedTab(hasDescription ? pdfIndex + 1 : pdfIndex);
                      } else {
                        handleDownloadFile(file);
                      }
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm ${
                      file.toLowerCase().includes('.pdf')
                        ? 'bg-red-500 hover:bg-red-600 text-white'
                        : 'bg-blue-500 hover:bg-blue-600 text-white'
                    }`}
                  >
                    {file.toLowerCase().includes('.pdf') ? <PictureAsPdf /> : <FaDownload />}
                    {getFileName(file)}
                  </button>
                ))}
              </div>
            )}

            {/* Connection URL */}
            {url && (
              <div className={`p-3 rounded-lg border ${
                theme === 'dark' ? 'bg-orange-950 border-orange-600' : 'bg-orange-50 border-orange-300'
              }`}>
                <p className="font-mono text-sm">
                  <span className="font-semibold">Connection: </span>
                  <span className="text-orange-500 break-all">{url}</span>
                </p>
              </div>
            )}

            {/* Tabs for Description and PDFs */}
            {(hasDescription || hasPdfFiles) && (
              <div>
                <Tabs
                  value={selectedTab}
                  onChange={(_, newValue) => {
                    setSelectedTab(newValue);
                    // Close PDF viewer if switching away from PDF tab
                    const isPdfTab = hasDescription ? newValue > 0 : newValue >= 0;
                    if (!isPdfTab || (hasDescription && newValue === 0)) {
                      closePdfViewer();
                    } else {
                      // Open corresponding PDF
                      const pdfIdx = hasDescription ? newValue - 1 : newValue;
                      handlePdfClick(pdfIdx);
                    }
                  }}
                  sx={{
                    '& .MuiTab-root': {
                      color: theme === 'dark' ? '#9ca3af' : '#6b7280',
                      fontFamily: 'monospace',
                      fontSize: '0.875rem',
                      minHeight: '40px',
                    },
                    '& .Mui-selected': {
                      color: '#fb923c !important',
                    },
                    '& .MuiTabs-indicator': {
                      backgroundColor: '#fb923c',
                    },
                  }}
                >
                  {hasDescription && (
                    <Tab 
                      icon={<Description sx={{ fontSize: 18 }} />} 
                      iconPosition="start" 
                      label="Description" 
                    />
                  )}
                  {pdfFiles.map((file, index) => (
                    <Tab
                      key={index}
                      icon={<PictureAsPdf sx={{ fontSize: 18 }} />}
                      iconPosition="start"
                      label={`PDF ${index + 1}`}
                    />
                  ))}
                </Tabs>

                {/* Tab Content */}
                <div className="mt-4">
                  {selectedTab === 0 && hasDescription && (
                    <div className={`p-4 rounded-lg ${
                      theme === 'dark' ? 'bg-gray-900' : 'bg-gray-50'
                    }`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {challenge.description}
                      </ReactMarkdown>
                    </div>
                  )}
                  
                  {pdfFiles.map((file, index) => {
                    const tabIndex = hasDescription ? index + 1 : index;
                    return selectedTab === tabIndex && selectedPdfIndex === null && (
                      <div key={index} className={`p-4 rounded-lg ${
                        theme === 'dark' ? 'bg-gray-900' : 'bg-gray-50'
                      }`}>
                        <div className="text-center">
                          <CircularProgress sx={{ color: '#fb923c' }} size={40} />
                          <Typography className="mt-2 font-mono text-sm text-orange-500">
                            Loading PDF...
                          </Typography>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Hints Section - GenZ Style Compact */}
            {hints.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className={`h-0.5 w-8 rounded-full ${
                    theme === 'dark' ? 'bg-gradient-to-r from-cyan-500 to-purple-500' : 'bg-gradient-to-r from-cyan-400 to-purple-400'
                  }`} />
                  <h3 className={`font-bold text-sm font-mono ${
                    theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'
                  }`}>
                    {'>'} HINTS_AVAILABLE
                  </h3>
                  <div className={`h-0.5 flex-1 rounded-full ${
                    theme === 'dark' ? 'bg-gradient-to-r from-purple-500 to-cyan-500' : 'bg-gradient-to-r from-purple-400 to-cyan-400'
                  }`} />
                </div>
                
                <div className="grid grid-cols-6 gap-2">
                  {hints.map((hint, index) => (
                    <motion.button
                      key={hint.id}
                      onClick={() => handleUnlockHint(hint.id, hint.cost)}
                      disabled={unlockingHintId === hint.id}
                      className={`relative group overflow-hidden rounded-lg p-2.5 transition-all duration-300 ${
                        theme === 'dark'
                          ? 'bg-gradient-to-br from-gray-800 via-gray-900 to-black hover:from-cyan-900/50 hover:via-purple-900/50 hover:to-black border border-cyan-500/30 hover:border-cyan-400'
                          : 'bg-gradient-to-br from-white via-cyan-50 to-purple-50 hover:from-cyan-100 hover:via-purple-100 hover:to-white border border-cyan-300 hover:border-cyan-500'
                      } ${unlockingHintId === hint.id ? 'opacity-50 cursor-wait' : 'hover:scale-105 hover:shadow-lg hover:shadow-cyan-500/20'}`}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      {/* Matrix-like background effect */}
                      <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${
                        theme === 'dark' 
                          ? 'bg-[linear-gradient(0deg,transparent_24%,rgba(6,182,212,0.05)_25%,rgba(6,182,212,0.05)_26%,transparent_27%,transparent_74%,rgba(6,182,212,0.05)_75%,rgba(6,182,212,0.05)_76%,transparent_77%,transparent)] bg-[length:50px_50px]' 
                          : 'bg-[linear-gradient(0deg,transparent_24%,rgba(6,182,212,0.1)_25%,rgba(6,182,212,0.1)_26%,transparent_27%,transparent_74%,rgba(6,182,212,0.1)_75%,rgba(6,182,212,0.1)_76%,transparent_77%,transparent)] bg-[length:50px_50px]'
                      }`} />
                      
                      {/* Corner brackets - CTF style */}
                      <div className={`absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 ${
                        theme === 'dark' ? 'border-cyan-500 group-hover:border-cyan-400' : 'border-cyan-600 group-hover:border-cyan-700'
                      } transition-colors`} />
                      <div className={`absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 ${
                        theme === 'dark' ? 'border-cyan-500 group-hover:border-cyan-400' : 'border-cyan-600 group-hover:border-cyan-700'
                      } transition-colors`} />
                      <div className={`absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 ${
                        theme === 'dark' ? 'border-purple-500 group-hover:border-purple-400' : 'border-purple-600 group-hover:border-purple-700'
                      } transition-colors`} />
                      <div className={`absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 ${
                        theme === 'dark' ? 'border-purple-500 group-hover:border-purple-400' : 'border-purple-600 group-hover:border-purple-700'
                      } transition-colors`} />
                      
                      {/* Loading/Status icon */}
                      <div className={`absolute top-1 right-1 text-xs ${
                        unlockingHintId === hint.id ? 'animate-spin' : 'group-hover:animate-pulse'
                      }`}>
                        {unlockingHintId === hint.id ? '⟳' : '◉'}
                      </div>
                      
                      <div className="relative z-10 flex flex-col items-center gap-1">
                        {/* Terminal-style hint label */}
                        <div className={`font-bold text-xs font-mono tracking-wider ${
                          theme === 'dark' ? 'text-cyan-400 group-hover:text-cyan-300' : 'text-cyan-600 group-hover:text-cyan-700'
                        } transition-colors`}>
                          {'[HINT_' + (index + 1) + ']'}
                        </div>
                        
                        {/* Cost badge */}
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${
                          theme === 'dark' 
                            ? 'bg-purple-900/60 group-hover:bg-purple-800/80 border border-purple-500/30' 
                            : 'bg-purple-100 group-hover:bg-purple-200 border border-purple-300'
                        } transition-all duration-300`}>
                          <span className="text-xs">⬡</span>
                          <span className={`font-bold text-xs font-mono ${
                            theme === 'dark' ? 'text-purple-300' : 'text-purple-700'
                          }`}>
                            {hint.cost}
                          </span>
                        </div>
                      </div>
                      
                      {/* Scan line effect */}
                      <motion.div
                        className={`absolute inset-0 ${
                          theme === 'dark' 
                            ? 'bg-gradient-to-b from-transparent via-cyan-500/10 to-transparent' 
                            : 'bg-gradient-to-b from-transparent via-cyan-300/20 to-transparent'
                        } opacity-0 group-hover:opacity-100`}
                        animate={{
                          y: ['-100%', '100%'],
                        }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                          repeatDelay: 0.5,
                        }}
                      />
                      
                      {/* Bottom indicator */}
                      <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${
                        theme === 'dark'
                          ? 'bg-gradient-to-r from-cyan-500 via-purple-500 to-cyan-500'
                          : 'bg-gradient-to-r from-cyan-400 via-purple-400 to-cyan-400'
                      } opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                    </motion.button>
                  ))}
                </div>
                
                <div className={`text-center text-xs font-mono flex items-center justify-center gap-2 ${
                  theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
                }`}>
                  <span className="text-cyan-500">{'>'}</span>
                  <span>Click to unlock hints | Cost in points</span>
                  <span className="text-purple-500">{'<'}</span>
                </div>
              </div>
            )}

            {/* Submit Form */}
            {!challenge.solve_by_myteam && (
              <div className="space-y-3">
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  className={`w-full p-3 border rounded-lg font-mono ${
                    theme === 'dark'
                      ? 'bg-gray-900 text-white border-gray-700'
                      : 'bg-white text-gray-900 border-gray-300'
                  }`}
                  rows={4}
                  placeholder="Enter your flag here..."
                />
                
                <button
                  onClick={handleSubmitFlag}
                  disabled={isSubmittingFlag || !answer.trim()}
                  className="w-full py-2 px-4 bg-gradient-to-r from-blue-500 to-pink-500 hover:from-pink-500 hover:to-blue-500 text-white rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isSubmittingFlag ? 'Submitting...' : 'Submit Flag'}
                </button>
              </div>
            )}

            {/* Start/Stop Buttons */}
            {challenge.require_deploy && !challenge.solve_by_myteam && (
              <div className="space-y-2">
                {!isChallengeStarted ? (
                  challenge.is_captain ? (
                    <button
                      onClick={handleStartChallenge}
                      disabled={isStarting}
                      className="w-full py-2 px-4 bg-gradient-to-r from-green-400 to-blue-400 hover:from-blue-400 hover:to-green-400 text-white rounded-lg font-bold disabled:opacity-50 transition-all"
                    >
                      {isStarting ? 'Starting...' : 'Start Challenge'}
                    </button>
                  ) : (
                    <p className="text-red-500 text-center text-sm">
                      Only captain can start this challenge
                    </p>
                  )
                ) : (
                  <button
                    onClick={handleStopChallenge}
                    disabled={isStopping}
                    className="w-full py-2 px-4 bg-gradient-to-r from-red-500 to-pink-500 hover:from-pink-500 hover:to-red-500 text-white rounded-lg font-bold disabled:opacity-50 transition-all"
                  >
                    {isStopping ? 'Stopping...' : 'Stop Challenge'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* PDF Viewer Panel - Shows when PDF tab is selected */}
        <AnimatePresence>
          {selectedPdfIndex !== null && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className={`w-1/2 rounded-2xl shadow-2xl border overflow-hidden ${
                theme === 'dark'
                  ? 'bg-gray-900 border-orange-500/30'
                  : 'bg-gray-100 border-orange-200'
              }`}
            >
              {/* PDF Header */}
              <div className={`p-4 border-b flex items-center justify-between ${
                theme === 'dark' 
                  ? 'bg-gray-800 border-gray-700' 
                  : 'bg-white border-gray-300'
              }`}>
                <div className="flex items-center gap-3">
                  <PictureAsPdf className="text-red-500" sx={{ fontSize: 24 }} />
                  <h3 className={`font-bold font-mono text-base ${
                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                  }`}>
                    {getFileName(pdfFiles[selectedPdfIndex])}
                  </h3>
                </div>
                
                <div className="flex items-center gap-3">
                  {numPages && !loadingPdf && (
                    <>
                      <div className={`font-mono text-sm ${
                        theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                        {pageNumber} / {numPages}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPageNumber(prev => Math.max(1, prev - 1))}
                          disabled={pageNumber <= 1}
                          className="px-2 py-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-mono text-xs transition-colors"
                        >
                          ←
                        </button>
                        <button
                          onClick={() => setPageNumber(prev => Math.min(numPages, prev + 1))}
                          disabled={pageNumber >= numPages}
                          className="px-2 py-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-mono text-xs transition-colors"
                        >
                          →
                        </button>
                      </div>
                    </>
                  )}
                  
                  <button
                    onClick={closePdfViewer}
                    className={`p-1.5 rounded-lg transition-all hover:scale-110 ${
                      theme === 'dark' 
                        ? 'bg-gray-700 hover:bg-red-600 text-white' 
                        : 'bg-gray-200 hover:bg-red-500 text-gray-800 hover:text-white'
                    }`}
                    title="Close PDF"
                  >
                    <Close sx={{ fontSize: 20 }} />
                  </button>
                </div>
              </div>

              {/* PDF Content */}
              <div className="h-[calc(100%-80px)] overflow-auto p-4 flex justify-center items-start">
                {loadingPdf ? (
                  <div className="flex flex-col items-center justify-center p-12">
                    <CircularProgress sx={{ color: '#fb923c' }} size={60} />
                    <Typography className="mt-4 font-mono text-orange-500 font-bold">
                      Loading PDF...
                    </Typography>
                  </div>
                ) : pdfBlobUrl ? (
                  <div className="shadow-2xl">
                    <Document
                      file={pdfBlobUrl}
                      onLoadSuccess={onDocumentLoadSuccess}
                      onLoadError={(error) => {
                        console.error('Error loading PDF document:', error);
                        Swal.fire({
                          title: 'PDF Load Error!',
                          text: 'Failed to load PDF document.',
                          icon: 'error',
                          confirmButtonText: 'OK',
                        });
                      }}
                      loading={
                        <div className="flex flex-col items-center justify-center p-12">
                          <CircularProgress sx={{ color: '#fb923c' }} size={60} />
                          <Typography className="mt-4 font-mono text-orange-500 font-bold">
                            Rendering PDF...
                          </Typography>
                        </div>
                      }
                    >
                      <Page 
                        pageNumber={pageNumber} 
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        width={Math.min((window.innerWidth * 0.33) - 100, 600)}
                        loading={
                          <div className="flex items-center justify-center p-8">
                            <CircularProgress sx={{ color: '#fb923c' }} size={40} />
                          </div>
                        }
                      />
                    </Document>
                  </div>
                ) : null}
              </div>

              {/* PDF Bottom Navigation */}
              {numPages && !loadingPdf && (
                <div className={`p-3 border-t flex items-center justify-center gap-2 ${
                  theme === 'dark' 
                    ? 'bg-gray-800 border-gray-700' 
                    : 'bg-white border-gray-300'
                }`}>
                  <button
                    onClick={() => setPageNumber(1)}
                    disabled={pageNumber === 1}
                    className="px-2 py-1 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-mono text-xs transition-colors"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setPageNumber(prev => Math.max(1, prev - 1))}
                    disabled={pageNumber <= 1}
                    className="px-3 py-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-mono text-xs transition-colors"
                  >
                    ← Prev
                  </button>
                  
                  <span className={`font-mono font-bold px-2 text-sm ${
                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                  }`}>
                    {pageNumber} / {numPages}
                  </span>
                  
                  <button
                    onClick={() => setPageNumber(prev => Math.min(numPages, prev + 1))}
                    disabled={pageNumber >= numPages}
                    className="px-3 py-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-mono text-xs transition-colors"
                  >
                    Next →
                  </button>
                  <button
                    onClick={() => setPageNumber(numPages)}
                    disabled={pageNumber === numPages}
                    className="px-2 py-1 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-mono text-xs transition-colors"
                  >
                    Last
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}