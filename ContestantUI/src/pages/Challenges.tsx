import { Typography, CircularProgress, Box, Tabs, Tab } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useEffect, useState, useRef } from 'react';
import { challengeService } from '../services/challengeService';
import { useTheme } from '../context/ThemeContext';
import { 
  LockOpen, 
  Lock, 
  Timer, 
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

interface ChallengeRequirements {
  prerequisites?: number[];
  anonymize?: boolean;
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
  requirements?: ChallengeRequirements | null;
}

interface PrerequisiteChallenge {
  id: number;
  name: string;
  category: string;
  solved: boolean;
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
  const [prerequisiteInfo, setPrerequisiteInfo] = useState<Map<number, PrerequisiteChallenge[]>>(new Map());

  // Pagination states
  const [categoryPage, setCategoryPage] = useState(1);
  const [challengePage, setChallengePage] = useState(1);
  const categoriesPerPage = 5;
  const challengesPerPage = 10;

  // Check if challenge prerequisites are met
  const checkPrerequisites = async (challenge: Challenge): Promise<{ locked: boolean; unmetPrereqs: PrerequisiteChallenge[] }> => {
    if (!challenge.requirements?.prerequisites || challenge.requirements.prerequisites.length === 0) {
      return { locked: false, unmetPrereqs: [] };
    }

    const unmetPrereqs: PrerequisiteChallenge[] = [];
    
    for (const prereqId of challenge.requirements.prerequisites) {
      try {
        const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.DETAIL(prereqId), {
          method: 'GET'
        });
        const data = await response.json();
        
        // API response structure: { message: true, data: { id, name, category, solve_by_myteam, ... } }
        if (data.data) {
          const isSolved = data.data.solve_by_myteam || false;
          
          if (!isSolved) {
            unmetPrereqs.push({
              id: prereqId,
              name: data.data.name || `Challenge ${prereqId}`,
              category: data.data.category || '',
              solved: false
            });
          }
        }
      } catch (error) {
        console.error(`Error checking prerequisite ${prereqId}:`, error);
      }
    }

    return { locked: unmetPrereqs.length > 0, unmetPrereqs };
  };

  // Load prerequisites info for all challenges
  const loadPrerequisitesInfo = async (challengeList: Challenge[]) => {
    const prereqMap = new Map<number, PrerequisiteChallenge[]>();
    
    for (const challenge of challengeList) {
      if (challenge.requirements?.prerequisites) {
        const { unmetPrereqs } = await checkPrerequisites(challenge);
        if (unmetPrereqs.length > 0) {
          prereqMap.set(challenge.id, unmetPrereqs);
        }
      }
    }
    
    setPrerequisiteInfo(prereqMap);
  };


  const refreshChallengeData = async () => {
    if (selectedCategory) {
      await fetchChallenges(selectedCategory);
    }
    if (selectedChallenge) {
      try {
        const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.DETAIL(selectedChallenge.id), {
          method: 'GET'
        });
        const data = await response.json();
        // Preserve value and solves from the current selected challenge
        setSelectedChallenge({
          ...data.data,
          value: selectedChallenge.value,
          solves: selectedChallenge.solves,
          requirements: selectedChallenge.requirements
        });
      } catch (error) {
        console.error('Error refreshing challenge details:', error);
      }
    }
  };
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
      const challengeList = Array.isArray(data) ? data : [];
      setChallenges(challengeList);
      
      // Load prerequisites info for challenges with requirements
      await loadPrerequisitesInfo(challengeList);
      
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
    setChallengePage(1); // Reset challenge page when switching category
    await fetchChallenges(categoryName);
  };

  const handleChallengeClick = async (challenge: Challenge) => {
    if (!isContestActive) return;
    
    // Check if challenge has prerequisites
    const unmetPrereqs = prerequisiteInfo.get(challenge.id) || [];
    
    if (unmetPrereqs.length > 0) {
      // Show locked challenge warning
      const prereqList = unmetPrereqs.map(p => `${p.name} (${p.category})`).join(', ');
      
      Swal.fire({
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-yellow-400 mb-2">[!] Challenge Locked</div>
            <div class="text-gray-400 mb-2">> Prerequisites required:</div>
            <div class="text-cyan-400 text-xs p-2 bg-gray-800/50 rounded border border-yellow-500/30">
              ${prereqList}
            </div>
            <div class="text-gray-400 mt-2">> Complete required challenges first</div>
          </div>
        `,
        icon: 'warning',
        iconColor: '#fbbf24',
        confirmButtonText: 'OK',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        color: theme === 'dark' ? '#fbbf24' : '#000000',
        customClass: {
          popup: 'rounded-lg border border-yellow-500/30',
          confirmButton: 'bg-yellow-500 hover:bg-yellow-600 text-black font-mono px-4 py-2 rounded',
        },
      });
      return;
    }
    
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.DETAIL(challenge.id), {
        method: 'GET'
      });
      const data = await response.json();
      // Preserve value and solves from the list since API detail doesn't return them
      setSelectedChallenge({
        ...data.data,
        value: challenge.value,
        solves: challenge.solves,
        requirements: challenge.requirements // Preserve requirements
      });
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
        <Terminal className={`text-4xl mb-4 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`} />
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
          <Typography className={`text-red-600 font-bold font-mono text-xl mb-2`}>[!] Error</Typography>
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
      <div className="w-56 flex-shrink-0">
        <div className={`rounded-lg border p-4 sticky top-24 ${
          theme === 'dark'
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-300'
        }`}>
          <div className={`mb-4 pb-3 border-b ${
            theme === 'dark' ? 'border-gray-700' : 'border-gray-300'
          }`}>
            <Typography variant="h6" className={`font-bold font-mono text-sm ${
              theme === 'dark' ? 'text-cyan-300' : 'text-cyan-600'
            }`}>
              [CATEGORIES]
            </Typography>
          </div>
          
          <div className="space-y-2">
            {categories
              .slice((categoryPage - 1) * categoriesPerPage, categoryPage * categoriesPerPage)
              .map((category) => (
              <button
                key={category.topic_name}
                onClick={() => handleCategoryClick(category.topic_name)}
                className={`w-full text-left px-3 py-2 rounded transition-colors flex items-center justify-between ${
                  selectedCategory === category.topic_name
                    ? theme === 'dark'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-green-50 text-green-700 border border-green-300'
                    : theme === 'dark'
                    ? 'bg-gray-700/50 hover:bg-gray-700 text-gray-300 border border-gray-600'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {getCategoryIcon(category.topic_name)}
                  <div className="flex-1">
                    <div className="font-bold text-xs font-mono">
                      {category.topic_name.toUpperCase()}
                    </div>
                    <div className={`text-xs font-mono ${
                      selectedCategory === category.topic_name
                        ? theme === 'dark' ? 'text-green-300' : 'text-green-600'
                        : theme === 'dark' ? 'text-gray-500' : 'text-gray-500'
                    }`}>
                      {category.challenge_count} challs
                    </div>
                  </div>
                </div>
                
                {selectedCategory === category.topic_name && (
                  <span className="text-green-500">●</span>
                )}
              </button>
            ))}
          </div>

          {/* Categories Pagination */}
          {categories.length > categoriesPerPage && (
            <div className="mt-4 pt-3 border-t border-gray-700">
              <TerminalPagination
                currentPage={categoryPage}
                totalPages={Math.ceil(categories.length / categoriesPerPage)}
                onPageChange={setCategoryPage}
                theme={theme}
              />
            </div>
          )}
        </div>
      </div>

      {/* Column 2: Challenge List */}
      <div className={selectedChallenge ? "w-96 flex-shrink-0" : "flex-1"}>
        {!isContestActive && (
          <div className={`mb-4 p-3 rounded border ${
            theme === 'dark'
              ? 'bg-orange-900/20 border-orange-500/30'
              : 'bg-orange-50 border-orange-300'
          }`}>
            <Typography className={`text-center font-bold font-mono text-sm flex items-center justify-center gap-2 ${
              theme === 'dark' ? 'text-orange-400' : 'text-orange-700'
            }`}>
              <Lock fontSize="small" />
              [!] CONTEST NOT ACTIVE
            </Typography>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={selectedCategory}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <div className="mb-4">
              <h1 className={`text-xl font-bold font-mono ${
                theme === 'dark' ? 'text-cyan-300' : 'text-cyan-600'
              }`}>
                [{selectedCategory.toUpperCase()}]
              </h1>
            </div>

            {loadingChallenges ? (
              <Box className="flex flex-col items-center justify-center py-12">
                <Terminal className={`text-3xl mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`} />
                <Typography className={`font-mono text-sm ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-500'
                }`}>
                  Fetching challenges...
                </Typography>
              </Box>
            ) : challenges.length > 0 ? (
              <>
                <div className="space-y-2">
                  {challenges
                    .slice((challengePage - 1) * challengesPerPage, challengePage * challengesPerPage)
                    .map((challenge) => (
                    <ChallengeListItem
                      key={challenge.id}
                      challenge={challenge}
                      isContestActive={isContestActive}
                      onClick={() => handleChallengeClick(challenge)}
                      isSelected={selectedChallenge?.id === challenge.id}
                      isLocked={(prerequisiteInfo.get(challenge.id) || []).length > 0}
                      prerequisites={prerequisiteInfo.get(challenge.id) || []}
                    />
                  ))}
                </div>

                {/* Challenges Pagination */}
                {challenges.length > challengesPerPage && (
                  <div className="mt-4">
                    <TerminalPagination
                      currentPage={challengePage}
                      totalPages={Math.ceil(challenges.length / challengesPerPage)}
                      onPageChange={setChallengePage}
                      theme={theme}
                      totalItems={challenges.length}
                      itemsPerPage={challengesPerPage}
                    />
                  </div>
                )}
              </>
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
              onFlagSuccess={refreshChallengeData} // Pass refresh function
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Terminal Pagination Component
function TerminalPagination({
  currentPage,
  totalPages,
  onPageChange,
  theme,
  totalItems,
  itemsPerPage,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  theme: string;
  totalItems?: number;
  itemsPerPage?: number;
}) {
  const startItem = totalItems ? (currentPage - 1) * itemsPerPage! + 1 : 0;
  const endItem = totalItems ? Math.min(currentPage * itemsPerPage!, totalItems) : 0;

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    
    if (totalPages <= 7) {
      // Show all pages if 7 or less
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);
      
      if (currentPage > 3) {
        pages.push('...');
      }
      
      // Show pages around current page
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      
      if (currentPage < totalPages - 2) {
        pages.push('...');
      }
      
      // Always show last page
      pages.push(totalPages);
    }
    
    return pages;
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Page info */}
      {totalItems && (
        <div className={`text-xs font-mono text-center ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
        }`}>
          [{startItem}-{endItem} / {totalItems}]
        </div>
      )}

      {/* Pagination controls */}
      <div className="flex items-center justify-center gap-1">
        {/* Previous button */}
        <button
          onClick={() => currentPage > 1 && onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className={`px-2 py-1 text-xs font-mono font-bold border rounded transition-all ${
            currentPage === 1
              ? theme === 'dark'
                ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                : 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
              : theme === 'dark'
              ? 'bg-gray-700 border-gray-600 text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-500/50'
              : 'bg-white border-gray-300 text-cyan-600 hover:bg-cyan-50 hover:border-cyan-400'
          }`}
        >
          {'[<]'}
        </button>

        {/* Page numbers */}
        {getPageNumbers().map((page, index) => (
          <React.Fragment key={index}>
            {page === '...' ? (
              <span className={`px-2 py-1 text-xs font-mono ${
                theme === 'dark' ? 'text-gray-600' : 'text-gray-400'
              }`}>
                ...
              </span>
            ) : (
              <button
                onClick={() => onPageChange(page as number)}
                className={`min-w-[32px] px-2 py-1 text-xs font-mono font-bold border rounded transition-all ${
                  currentPage === page
                    ? theme === 'dark'
                      ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                      : 'bg-cyan-50 border-cyan-400 text-cyan-600'
                    : theme === 'dark'
                    ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:border-gray-500'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400'
                }`}
              >
                {page}
              </button>
            )}
          </React.Fragment>
        ))}

        {/* Next button */}
        <button
          onClick={() => currentPage < totalPages && onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={`px-2 py-1 text-xs font-mono font-bold border rounded transition-all ${
            currentPage === totalPages
              ? theme === 'dark'
                ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                : 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
              : theme === 'dark'
              ? 'bg-gray-700 border-gray-600 text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-500/50'
              : 'bg-white border-gray-300 text-cyan-600 hover:bg-cyan-50 hover:border-cyan-400'
          }`}
        >
          {'[>]'}
        </button>
      </div>
    </div>
  );
}

// Challenge List Item Component
function ChallengeListItem({
  challenge,
  isContestActive,
  onClick,
  isSelected,
  isLocked = false,
  prerequisites = [],
}: {
  challenge: Challenge;
  isContestActive: boolean;
  onClick: () => void;
  isSelected: boolean;
  isLocked?: boolean;
  prerequisites?: PrerequisiteChallenge[];
}) {
  const { theme } = useTheme();
  
  // Check if this challenge is deploying
  const [isDeploying, setIsDeploying] = React.useState(false);
  
  React.useEffect(() => {
    const deploymentKey = `deployment_${challenge.id}`;
    const checkDeploymentStatus = () => {
      const savedDeployment = localStorage.getItem(deploymentKey);
      if (savedDeployment) {
        const { isDeploying, startTime } = JSON.parse(savedDeployment);
        const now = Date.now();
        const elapsed = (now - startTime) / 1000;
        // If still within timeout
        if (isDeploying && elapsed < 120) {
          setIsDeploying(true);
        } else {
          setIsDeploying(false);
        }
      } else {
        setIsDeploying(false);
      }
    };
    
    // Check immediately
    checkDeploymentStatus();
    
    // Check every 2 seconds
    const interval = setInterval(checkDeploymentStatus, 2000);
    
    return () => clearInterval(interval);
  }, [challenge.id]);

  const handleClick = () => {
    if (isContestActive) {
      onClick();
    }
  };

  return (
    <div
      className={`relative border rounded transition-colors ${
        !isContestActive || isLocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${
        isSelected
          ? theme === 'dark' 
            ? 'border-green-500 bg-green-900/20' 
            : 'border-green-500 bg-green-50'
          : !isContestActive || isLocked
          ? theme === 'dark'
            ? 'bg-gray-800/50 border-gray-700'
            : 'bg-white border-gray-300'
          : challenge.solve_by_myteam
          ? theme === 'dark'
            ? 'bg-green-900/30 border-green-700 hover:border-green-500'
            : 'bg-green-50 border-green-300 hover:border-green-500'
          : theme === 'dark'
          ? 'bg-gray-800 border-gray-700 hover:border-gray-500'
          : 'bg-white border-gray-300 hover:border-gray-500'
      }`}
      onClick={handleClick}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {challenge.solve_by_myteam ? (
                <CheckCircle className="text-green-500 flex-shrink-0" sx={{ fontSize: 18 }} />
              ) : isLocked ? (
                <Lock className="text-yellow-500 flex-shrink-0" sx={{ fontSize: 18 }} />
              ) : isContestActive ? (
                <LockOpen className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} sx={{ fontSize: 18 }} />
              ) : (
                <Lock className="text-gray-500 flex-shrink-0" sx={{ fontSize: 18 }} />
              )}
              
              <h3
                className={`text-sm font-mono font-bold truncate ${
                  challenge.solve_by_myteam
                    ? 'text-green-500'
                    : isLocked
                    ? 'text-yellow-500'
                    : isContestActive
                    ? theme === 'dark' ? 'text-white' : 'text-gray-900'
                    : 'text-gray-500'
                }`}
                title={challenge.name}
              >
                {challenge.name}
              </h3>
            </div>

            <div className="flex flex-wrap gap-2 text-xs font-mono">
              {isLocked && (
                <span className={`px-2 py-0.5 rounded ${
                  theme === 'dark'
                    ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    : 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                }`}>
                  [!] locked
                </span>
              )}
              
              {/* Prerequisites chips */}
              {isLocked && prerequisites.map((prereq) => (
                <span 
                  key={prereq.id}
                  className={`px-2 py-0.5 rounded ${
                    theme === 'dark'
                      ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                      : 'bg-orange-100 text-orange-700 border border-orange-300'
                  }`}
                  title={`Requires: ${prereq.name}`}
                >
                  {prereq.name} ({prereq.category})
                </span>
              ))}
              
              <span className={`px-2 py-0.5 rounded ${
                challenge.solve_by_myteam
                  ? theme === 'dark'
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-green-100 text-green-700 border border-green-300'
                  : theme === 'dark'
                  ? 'bg-gray-700 text-gray-300 border border-gray-600'
                  : 'bg-gray-100 text-gray-700 border border-gray-300'
              }`}>
                {challenge.value}pts
              </span>

              {challenge.solves !== undefined && (
                <span className={`px-2 py-0.5 rounded ${
                  theme === 'dark'
                    ? 'bg-gray-700 text-gray-400 border border-gray-600'
                    : 'bg-gray-100 text-gray-600 border border-gray-300'
                }`}>
                  {challenge.solves} solves
                </span>
              )}
              
              {/* Deployment status badge */}
              {isDeploying && (
                <span className={`px-2 py-0.5 rounded animate-pulse ${
                  theme === 'dark'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'bg-cyan-100 text-cyan-700 border border-cyan-300'
                }`}>
                  [~] deploying...
                </span>
              )}
            </div>
          </div>

          {challenge.solve_by_myteam && (
            <span className="text-green-500 text-xs">✓</span>
          )}
        </div>
      </div>
    </div>
  );
}

// Challenge Detail Panel Component
function ChallengeDetailPanel({ 
  challenge, 
  theme,
  onClose,
  onFlagSuccess 
}: { 
  challenge: Challenge; 
  theme: string;
  onClose: () => void;
  onFlagSuccess?: () => Promise<void>; // Add this prop
}) {
  const [answer, setAnswer] = useState('');
  const [hints, setHints] = useState<Hint[]>([]);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isChallengeStarted, setIsChallengeStarted] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [isSubmittingFlag, setIsSubmittingFlag] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isDeploymentInProgress, setIsDeploymentInProgress] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedPdfIndex, setSelectedPdfIndex] = useState<number | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [unlockingHintId, setUnlockingHintId] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [cooldownTotal, setCooldownTotal] = useState<number>(0);
  const timerRef = useRef<number | null>(null);
  const cooldownTimerRef = useRef<number | null>(null);

  // Filter PDF files
  const pdfFiles = challenge.files?.filter(file => file.toLowerCase().includes('.pdf')) || [];
  const hasDescription = !!challenge.description;
  const hasPdfFiles = pdfFiles.length > 0;

  // Load cooldown and deployment state from localStorage when challenge changes
  useEffect(() => {
    const loadCooldown = () => {
      const cooldownKey = `cooldown_${challenge.id}`;
      const savedCooldown = localStorage.getItem(cooldownKey);
      
      if (savedCooldown) {
        const { expireTime, totalSeconds } = JSON.parse(savedCooldown);
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((expireTime - now) / 1000));
        
        if (remaining > 0) {
          setCooldownRemaining(remaining);
          setCooldownTotal(totalSeconds || remaining);
        } else {
          // Expired, remove from localStorage
          localStorage.removeItem(cooldownKey);
          setCooldownRemaining(0);
          setCooldownTotal(0);
        }
      }
    };

    const loadDeploymentState = async () => {
      const deploymentKey = `deployment_${challenge.id}`;
      const savedDeployment = localStorage.getItem(deploymentKey);
      
      if (savedDeployment) {
        const { isDeploying, startTime } = JSON.parse(savedDeployment);
        const now = Date.now();
        const elapsed = (now - startTime) / 1000; // seconds
        
        // If still within deployment timeout (2 minutes = 120 seconds)
        if (isDeploying && elapsed < 120) {
          setIsDeploymentInProgress(true);
          setIsStarting(true);
          // Continue health check in background
          setTimeout(() => {
            startHealthCheckLoop();
          }, 100);
        } else {
          // Timeout or completed, clean up
          localStorage.removeItem(deploymentKey);
        }
      }
    };

    loadCooldown();
    loadDeploymentState();
    fetchHints();
    fetchChallengeStatus();

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
      }
    };
  }, [challenge.id]);

  // Cooldown countdown effect
  useEffect(() => {
    if (cooldownRemaining > 0) {
      // Save to localStorage with expiry time and total seconds
      const cooldownKey = `cooldown_${challenge.id}`;
      const expireTime = Date.now() + (cooldownRemaining * 1000);
      localStorage.setItem(cooldownKey, JSON.stringify({ 
        expireTime, 
        totalSeconds: cooldownTotal > 0 ? cooldownTotal : cooldownRemaining 
      }));

      cooldownTimerRef.current = window.setInterval(() => {
        setCooldownRemaining((prev) => {
          if (prev <= 1) {
            if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
            // Remove from localStorage when cooldown ends
            localStorage.removeItem(cooldownKey);
            setCooldownTotal(0);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
    }

    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
      }
    };
  }, [cooldownRemaining, challenge.id]);

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
        setTimeRemaining(data.data.time_limit);
        setIsChallengeStarted(data.data.is_started || false);
        setUrl(data.challenge_url || null);
        
        // If we have URL, deployment is complete - clean up deployment state
        if (data.challenge_url) {
          const deploymentKey = `deployment_${challenge.id}`;
          localStorage.removeItem(deploymentKey);
          setIsDeploymentInProgress(false);
          setIsStarting(false);
        }
      }
    } catch (error) {
      console.error('Error fetching challenge status:', error);
    }
  };

  const handleStartChallenge = async () => {
    setIsStarting(true);
    setIsDeploymentInProgress(true); // Set immediately with button
    
    // Save deployment state to localStorage
    const deploymentKey = `deployment_${challenge.id}`;
    localStorage.setItem(deploymentKey, JSON.stringify({
      isDeploying: true,
      startTime: Date.now()
    }));
    
    // Give React time to update the UI before showing popup
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Show initial deploying message with 3s timer
    Swal.fire({
      html: `
        <div class="font-mono text-left text-sm">
          <div class="text-cyan-400 mb-2">[~] Deploying challenge...</div>
          <div class="text-gray-400">> Please wait...</div>
        </div>
      `,
      icon: 'info',
      iconColor: '#22d3ee',
      background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
      color: theme === 'dark' ? '#22d3ee' : '#000000',
      showConfirmButton: false,
      allowOutsideClick: false,
      timer: 2000, // Auto close after 3 seconds
      customClass: {
        popup: 'rounded-lg border border-cyan-500/30',
      },
    });

    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.START, {
        method: 'POST',
        body: JSON.stringify({
          challengeId: challenge.id,
        })
      });
      const data = await response.json();

      // Case 1: 200 + true + có URL = Challenge đã deploy xong, trả URL luôn
      if (response.status === 200 && data.success === true && data.challenge_url) {
        Swal.close();
        setIsChallengeStarted(true);
        setUrl(data.challenge_url);
        setIsStarting(false);
        setIsDeploymentInProgress(false);
        
        // Clear deployment state from localStorage
        const deploymentKey = `deployment_${challenge.id}`;
        localStorage.removeItem(deploymentKey);
        
        await fetchChallengeStatus();
        
        // Save notification for global listener (immediate success)
        const notificationKey = `deployment_notification_${challenge.id}`;
        localStorage.setItem(notificationKey, JSON.stringify({
          challengeId: challenge.id,
          challengeName: challenge.name,
          status: 'success',
          url: data.challenge_url,
          message: 'Challenge already deployed',
          timestamp: Date.now()
        }));
      }
      // Case 2: 200 + true + KHÔNG có URL = Đang deploy, cần loop health check
      else if (response.status === 200 && data.success === true && !data.challenge_url) {
        await startHealthCheckLoop();
      }
      else {
        Swal.close();
        setIsStarting(false);
        setIsDeploymentInProgress(false);
        
        // Clear deployment state from localStorage
        const deploymentKey = `deployment_${challenge.id}`;
        localStorage.removeItem(deploymentKey);
        
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-red-400 mb-2">[!] Deploy failed</div>
              <div class="text-gray-400">> ${data.message || 'Unknown error'}</div>
              <div class="text-gray-500 mt-2">> Status: ${response.status}</div>
            </div>
          `,
          icon: 'error',
          iconColor: '#ef4444',
          confirmButtonText: 'Close',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#ef4444' : '#000000',
          customClass: {
            popup: 'rounded-lg border border-red-500/30',
            confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
          },
        });
      }
    } catch (error) {
      Swal.close();
      setIsStarting(false);
      setIsDeploymentInProgress(false); // Hide red note
      
      // Clear deployment state from localStorage
      const deploymentKey = `deployment_${challenge.id}`;
      localStorage.removeItem(deploymentKey);
      
      Swal.fire({
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-red-400 mb-2">[!] Connection error</div>
            <div class="text-gray-400">> Failed to reach server</div>
            <div class="text-gray-400">> Please try again</div>
          </div>
        `,
        icon: 'error',
        iconColor: '#ef4444',
        confirmButtonText: 'Close',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        color: theme === 'dark' ? '#ef4444' : '#000000',
        customClass: {
          popup: 'rounded-lg border border-red-500/30',
          confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
        },
      });
    }
  };

  // Health check loop function
  const startHealthCheckLoop = async () => {
    const maxAttempts = 40;
    let attempts = 0;
    
    const checkStatus = async (): Promise<boolean> => {
      try {
        attempts++;
        // note: Sủa url
        const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.DETAIL(challenge.id), {
          method: 'GET'
        });
        const data = await response.json();
        
        // Check if challenge is started and has URL
        if (data.data && data.challenge_url) {
          setIsChallengeStarted(true);
          setUrl(data.challenge_url);
          setTimeRemaining(data.data.time_limit);
          setIsStarting(false);
          setIsDeploymentInProgress(false);
          
          // Clear deployment state from localStorage
          const deploymentKey = `deployment_${challenge.id}`;
          localStorage.removeItem(deploymentKey);
          
          // Save notification for global listener
          const notificationKey = `deployment_notification_${challenge.id}`;
          localStorage.setItem(notificationKey, JSON.stringify({
            challengeId: challenge.id,
            challengeName: challenge.name,
            status: 'success',
            url: data.challenge_url,
            message: data.message,
            timestamp: Date.now()
          }));
          
          return true; // Success
        }
        
        // Max attempts reached
        if (attempts >= maxAttempts) {
          setIsStarting(false);
          setIsDeploymentInProgress(false);
          
          // Clear deployment state from localStorage
          const deploymentKey = `deployment_${challenge.id}`;
          localStorage.removeItem(deploymentKey);
          
          // Save notification for global listener
          const notificationKey = `deployment_notification_${challenge.id}`;
          localStorage.setItem(notificationKey, JSON.stringify({
            challengeId: challenge.id,
            challengeName: challenge.name,
            status: 'timeout',
            message: 'Pod creation taking longer than expected',
            timestamp: Date.now()
          }));
          
          return true; // Stop loop
        }
        
        // Continue checking silently (no popup updates)
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
        return checkStatus(); // Recursive call
        
      } catch (error) {
        console.error('Health check error:', error);
        
        // Continue trying even on error
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          return checkStatus();
        }
        
        setIsStarting(false);
        setIsDeploymentInProgress(false);
        
        // Clear deployment state from localStorage
        const deploymentKey = `deployment_${challenge.id}`;
        localStorage.removeItem(deploymentKey);
        
        // Save notification for global listener
        const notificationKey = `deployment_notification_${challenge.id}`;
        localStorage.setItem(notificationKey, JSON.stringify({
          challengeId: challenge.id,
          challengeName: challenge.name,
          status: 'error',
          message: 'Unable to verify deployment',
          timestamp: Date.now()
        }));
        
        return true; // Stop loop
      }
    };
    
    // Start the check loop
    await checkStatus();
  };

  const handleStopChallenge = async () => {
    setIsStopping(true);
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.STOP, {
        method: 'POST',
        body: JSON.stringify({
          challenge_id: challenge.id,
          generatedToken: localStorage.getItem('auth_token'),
        })
      });
      const data = await response.json();

      if (data.isSuccess) {
        setIsChallengeStarted(false);
        setUrl(null);
        setTimeRemaining(null);
        
        // Clear timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-orange-400 mb-2">[-] Challenge stopped</div>
              <div class="text-gray-400">> Connection closed</div>
            </div>
          `,
          icon: 'info',
          iconColor: '#fb923c',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#fb923c' : '#000000',
          timer: 1500,
          showConfirmButton: false,
          customClass: {
            popup: 'rounded-lg border border-orange-500/30',
          },
        });
      }
    } catch (error) {
      Swal.fire({
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-red-400">[!] Stop failed</div>
          </div>
        `,
        icon: 'error',
        iconColor: '#ff006e',
        confirmButtonText: 'OK',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        customClass: {
          popup: 'rounded-lg border border-red-500/30',
          confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
        },
      });
    } finally {
      setIsStopping(false);
    }
  };

  const handleSubmitFlag = async () => {
    if (!answer.trim()) {
      Swal.fire({
        html: `<div class="font-mono text-sm text-yellow-400">[!] Empty flag</div>`,
        icon: 'warning',
        iconColor: '#fbbf24',
        confirmButtonText: 'OK',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        timer: 1500,
        customClass: {
          popup: 'rounded-lg border border-yellow-500/30',
          confirmButton: 'bg-yellow-500 hover:bg-yellow-600 text-black font-mono px-4 py-2 rounded',
        },
      });
      return;
    }

    setIsSubmittingFlag(true);
    try {
      const formData = new FormData();
      formData.append('challengeId', challenge.id.toString());
      formData.append('submission', answer);
      formData.append('generatedToken', localStorage.getItem('auth_token') || '');

      const MANAGEMENT_API_URL = import.meta.env.VITE_MANAGEMENT_API_URL || import.meta.env.VITE_API_URL;
      const token = localStorage.getItem('auth_token');
      
      const response = await fetch(`${MANAGEMENT_API_URL}${API_ENDPOINTS.FLAGS.SUBMIT}`, {
        method: 'POST',
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: formData,
      });

      const data = await response.json();
      
      if (data?.data?.status === 'correct') {
        await Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-green-400 mb-2">[+] FLAG CORRECT</div>
              <div class="text-gray-400">> Challenge solved</div>
              <div class="text-gray-400">> +${challenge.value} points</div>
            </div>
          `,
          icon: 'success',
          iconColor: '#22c55e',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#22c55e' : '#000000',
          timer: 2000,
          showConfirmButton: false,
          customClass: {
            popup: 'rounded-lg border border-green-500/30',
          },
        });
        
        setAnswer('');
        
        // Refresh challenge data to update UI
        if (onFlagSuccess) {
          await onFlagSuccess();
        }
        
        // If challenge requires deploy and was started, stop it automatically
        if (challenge.require_deploy && isChallengeStarted && url) {
          try {
            await handleStopChallenge();
          } catch (error) {
            console.error('Error stopping challenge after solve:', error);
          }
        }
      } else if (data?.data?.status === 'incorrect') {
        const attemptsLeft = challenge.max_attempts > 0 
          ? challenge.max_attempts - (challenge.attemps || 0) - 1 
          : '∞';
        
        // Set cooldown if provided by API
        const cooldownSeconds = data.data.cooldown || 0;
        if (cooldownSeconds > 0) {
          setCooldownRemaining(cooldownSeconds);
          setCooldownTotal(cooldownSeconds);
        }
        
        await Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-red-400 mb-2">[!] INCORRECT FLAG</div>
              <div class="text-gray-400">> ${data.data.message || 'Wrong flag'}</div>
              ${challenge.max_attempts > 0 ? `<div class="text-gray-400">> ${attemptsLeft} attempts left</div>` : ''}
              ${cooldownSeconds > 0 ? `<div class="text-orange-400">> Cooldown: ${cooldownSeconds}s</div>` : ''}
            </div>
          `,
          icon: 'error',
          iconColor: '#ef4444',
          confirmButtonText: 'Retry',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#ef4444' : '#000000',
          customClass: {
            popup: 'rounded-lg border border-red-500/30',
            confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
          },
        });
        
        // Refresh to update attempt count
        if (onFlagSuccess) {
          await onFlagSuccess();
        }
      } else if (data?.data?.status === 'already_solved') {
        await Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-cyan-400 mb-2">[i] Already solved</div>
              <div class="text-gray-400">> Challenge completed</div>
            </div>
          `,
          icon: 'info',
          iconColor: '#06b6d4',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#06b6d4' : '#000000',
          timer: 1500,
          showConfirmButton: false,
          customClass: {
            popup: 'rounded-lg border border-cyan-500/30',
          },
        });
      } else if (data?.data?.status === 'ratelimited') {
        // Get cooldown directly from API response
        const cooldownSeconds = data.data.cooldown || 0;
        
        if (cooldownSeconds > 0) {
          setCooldownRemaining(cooldownSeconds);
          setCooldownTotal(cooldownSeconds);
        }
        
        await Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-orange-400 mb-2">[!] Rate limited</div>
              <div class="text-gray-400">> ${data.data.message || 'Too many submissions'}</div>
              ${cooldownSeconds > 0 ? `<div class="text-gray-400">> Please wait ${cooldownSeconds}s</div>` : ''}
            </div>
          `,
          icon: 'warning',
          iconColor: '#fb923c',
          confirmButtonText: 'OK',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#fb923c' : '#000000',
          customClass: {
            popup: 'rounded-lg border border-orange-500/30',
            confirmButton: 'bg-orange-500 hover:bg-orange-600 text-white font-mono px-4 py-2 rounded',
          },
        });
      } else if (data?.data?.status === 'paused') {
        await Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-yellow-400 mb-2">[!] Contest Paused</div>
              <div class="text-gray-400">> ${data.data.message || 'Contest is paused'}</div>
            </div>
          `,
          icon: 'warning',
          iconColor: '#fbbf24',
          confirmButtonText: 'OK',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#fbbf24' : '#000000',
          customClass: {
            popup: 'rounded-lg border border-yellow-500/30',
            confirmButton: 'bg-yellow-500 hover:bg-yellow-600 text-black font-mono px-4 py-2 rounded',
          },
        });
      } else if (data?.message && data.message.includes("don't have the permission")) {
        // Handle prerequisite not met error
        await Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-yellow-400 mb-2">[!] Challenge Locked</div>
              <div class="text-gray-400 mb-2">> Prerequisites not met</div>
              <div class="text-gray-400">> Complete required challenges first</div>
            </div>
          `,
          icon: 'warning',
          iconColor: '#fbbf24',
          confirmButtonText: 'OK',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#fbbf24' : '#000000',
          customClass: {
            popup: 'rounded-lg border border-yellow-500/30',
            confirmButton: 'bg-yellow-500 hover:bg-yellow-600 text-black font-mono px-4 py-2 rounded',
          },
        });
      }
    } catch (error) {
      console.error('Error submitting flag:', error);
      await Swal.fire({
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-red-400 mb-2">[!] Error</div>
            <div class="text-gray-400">> Connection failed</div>
          </div>
        `,
        icon: 'error',
        iconColor: '#ef4444',
        confirmButtonText: 'Retry',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        color: theme === 'dark' ? '#ef4444' : '#000000',
        customClass: {
          popup: 'rounded-lg border border-red-500/30',
          confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
        },
      });
    } finally {
      setIsSubmittingFlag(false);
    }
  };

  const formatTime = (seconds: number | string | null) => {
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
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-red-400 mb-2">[!] Download failed</div>
            <div class="text-gray-400">> File unavailable</div>
          </div>
        `,
        icon: 'error',
        iconColor: '#ef4444',
        confirmButtonText: 'OK',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        color: theme === 'dark' ? '#ef4444' : '#000000',
        customClass: {
          popup: 'rounded-lg border border-red-500/30',
          confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
        },
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
      const errorResponse = error && typeof error === 'object' && 'response' in error 
        ? (error as any).response?.data?.errors 
        : {};
      return { success: false, errors: errorResponse || {} };
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
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-red-400 mb-2">[!] Error</div>
              <div class="text-gray-400">> Failed to fetch hint</div>
            </div>
          `,
          icon: "error",
          iconColor: '#ef4444',
          confirmButtonText: "OK",
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#ef4444' : '#000000',
          customClass: {
            popup: 'rounded-lg border border-red-500/30',
            confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
          },
        });
        return;
      }

      // Check if hint is already unlocked
      if (hintDetailsResponse?.data.content) {
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-cyan-400 mb-2">[i] Already unlocked</div>
              <div class="text-gray-400 mb-2">> Content:</div>
              <div class="text-cyan-400 text-xs p-2 bg-gray-800/50 rounded border border-cyan-500/30">
                ${hintDetailsResponse.data.content || "No content"}
              </div>
            </div>
          `,
          icon: "info",
          iconColor: '#06b6d4',
          confirmButtonText: "OK",
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#06b6d4' : '#000000',
          customClass: {
            popup: 'rounded-lg border border-cyan-500/30',
            confirmButton: 'bg-cyan-500 hover:bg-cyan-600 text-white font-mono px-4 py-2 rounded',
          }
        });
        return;
      }

      // Show confirmation dialog
      const result = await Swal.fire({
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-purple-400 mb-2">[?] Unlock hint</div>
            <div class="text-gray-400">> Cost: ${hintCost} points</div>
            <div class="text-gray-400">> Confirm unlock?</div>
          </div>
        `,
        icon: "question",
        iconColor: '#a855f7',
        showCancelButton: true,
        confirmButtonText: "Unlock",
        cancelButtonText: "Cancel",
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        color: theme === 'dark' ? '#a855f7' : '#000000',
        customClass: {
          popup: 'rounded-lg border border-purple-500/30',
          confirmButton: 'bg-purple-500 hover:bg-purple-600 text-white font-mono px-4 py-2 rounded',
          cancelButton: 'bg-gray-600 hover:bg-gray-700 text-white font-mono px-4 py-2 rounded',
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
              html: `
                <div class="font-mono text-left text-sm">
                  <div class="text-green-400 mb-2">[+] Hint unlocked</div>
                  <div class="text-gray-400 mb-2">> Content:</div>
                  <div class="text-cyan-400 text-xs p-2 bg-gray-800/50 rounded border border-cyan-500/30">
                    ${updatedHintDetails.data.content || "No content"}
                  </div>
                </div>
              `,
              icon: "success",
              iconColor: '#22c55e',
              confirmButtonText: "OK",
              background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
              color: theme === 'dark' ? '#22c55e' : '#000000',
              customClass: {
                popup: 'rounded-lg border border-green-500/30',
                confirmButton: 'bg-green-500 hover:bg-green-600 text-white font-mono px-4 py-2 rounded',
              },
            });
            
            // Refresh hints list
            fetchHints();
          } else {
            Swal.fire({
              html: `
                <div class="font-mono text-left text-sm">
                  <div class="text-green-400 mb-2">[+] Hint unlocked</div>
                  <div class="text-gray-400">> No details available</div>
                </div>
              `,
              icon: "info",
              iconColor: '#06b6d4',
              confirmButtonText: "OK",
              background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
              color: theme === 'dark' ? '#06b6d4' : '#000000',
              customClass: {
                popup: 'rounded-lg border border-cyan-500/30',
                confirmButton: 'bg-cyan-500 hover:bg-cyan-600 text-white font-mono px-4 py-2 rounded',
              },
            });
          }
        } else {
          // Handle errors
          if (response.errors?.score) {
            Swal.fire({
              html: `
                <div class="font-mono text-left text-sm">
                  <div class="text-red-400 mb-2">[!] Insufficient points</div>
                  <div class="text-gray-400">> ${response.errors.score}</div>
                </div>
              `,
              icon: "error",
              iconColor: '#ef4444',
              confirmButtonText: "OK",
              background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
              color: theme === 'dark' ? '#ef4444' : '#000000',
              customClass: {
                popup: 'rounded-lg border border-red-500/30',
                confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
              },
            });
          } else if (response.errors?.target) {
            const errorMessage = response.errors.target;
            
            if (errorMessage === "You've already unlocked this this target") {
              const hintDetailsResponse = await FetchHintDetails(hintId);
              
              if (hintDetailsResponse?.data) {
                Swal.fire({
                  html: `
                    <div class="font-mono text-left text-sm">
                      <div class="text-cyan-400 mb-2">[i] Already unlocked</div>
                      <div class="text-gray-400 mb-2">> Content:</div>
                      <div class="text-cyan-400 text-xs p-2 bg-gray-800/50 rounded border border-cyan-500/30">
                        ${hintDetailsResponse.data.content || "No content"}
                      </div>
                    </div>
                  `,
                  icon: "info",
                  iconColor: '#06b6d4',
                  confirmButtonText: "OK",
                  background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
                  color: theme === 'dark' ? '#06b6d4' : '#000000',
                  customClass: {
                    popup: 'rounded-lg border border-cyan-500/30',
                    confirmButton: 'bg-cyan-500 hover:bg-cyan-600 text-white font-mono px-4 py-2 rounded',
                  },
                });
              } else {
                Swal.fire({
                  html: `
                    <div class="font-mono text-left text-sm">
                      <div class="text-cyan-400 mb-2">[i] Already unlocked</div>
                      <div class="text-gray-400">> Hint already purchased</div>
                    </div>
                  `,
                  icon: "info",
                  iconColor: '#06b6d4',
                  confirmButtonText: "OK",
                  background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
                  color: theme === 'dark' ? '#06b6d4' : '#000000',
                  customClass: {
                    popup: 'rounded-lg border border-cyan-500/30',
                    confirmButton: 'bg-cyan-500 hover:bg-cyan-600 text-white font-mono px-4 py-2 rounded',
                  },
                });
              }
            } else {
              Swal.fire({
                html: `
                  <div class="font-mono text-left text-sm">
                    <div class="text-red-400 mb-2">[!] Error</div>
                    <div class="text-gray-400">> ${errorMessage}</div>
                  </div>
                `,
                icon: "error",
                iconColor: '#ef4444',
                confirmButtonText: "OK",
                background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
                color: theme === 'dark' ? '#ef4444' : '#000000',
                customClass: {
                  popup: 'rounded-lg border border-red-500/30',
                  confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
                },
              });
            }
          } else {
            Swal.fire({
              html: `
                <div class="font-mono text-left text-sm">
                  <div class="text-red-400 mb-2">[!] Unlock failed</div>
                  <div class="text-gray-400">> Error occurred</div>
                </div>
              `,
              icon: "error",
              iconColor: '#ef4444',
              confirmButtonText: "OK",
              background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
              color: theme === 'dark' ? '#ef4444' : '#000000',
              customClass: {
                popup: 'rounded-lg border border-red-500/30',
                confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
              },
            });
          }
        }
      } else {
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-gray-400">[i] Cancelled</div>
            </div>
          `,
          icon: "info",
          iconColor: '#6b7280',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#9ca3af' : '#000000',
          timer: 1000,
          showConfirmButton: false,
          customClass: {
            popup: 'rounded-lg border border-gray-500/30',
          },
        });
      }
    } catch (error) {
      Swal.fire({
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-red-400 mb-2">[!] Error</div>
            <div class="text-gray-400">> Connection failed</div>
          </div>
        `,
        icon: "error",
        iconColor: '#ef4444',
        confirmButtonText: "OK",
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        color: theme === 'dark' ? '#ef4444' : '#000000',
        customClass: {
          popup: 'rounded-lg border border-red-500/30',
          confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
        },
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
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-red-400 mb-2">[!] PDF load failed</div>
            <div class="text-gray-400">> File unavailable</div>
          </div>
        `,
        icon: 'error',
        iconColor: '#ef4444',
        confirmButtonText: 'Close',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        color: theme === 'dark' ? '#ef4444' : '#000000',
        customClass: {
          popup: 'rounded-lg border border-red-500/30',
          confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
        },
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
        <div className={`rounded-lg border overflow-hidden transition-all duration-300 ${
          selectedPdfIndex !== null ? 'w-1/2' : 'w-full'
        } ${
          theme === 'dark'
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-300'
        }`}>
          <div className="p-6 space-y-4 h-full overflow-y-auto">
            {/* Header with Timer and Solved Status */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h2 className={`text-xl font-bold font-mono ${
                  challenge.solve_by_myteam 
                    ? 'text-green-500' 
                    : theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {challenge.solve_by_myteam && '[✓] '}
                  {challenge.name}
                </h2>
                <div className="flex items-center gap-2 mt-2 text-sm font-mono">
                  <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
                    {challenge.value} pts
                  </span>
                  {challenge.solves !== undefined && (
                    <>
                      <span className={theme === 'dark' ? 'text-gray-600' : 'text-gray-400'}>|</span>
                      <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
                        {challenge.solves} solves
                      </span>
                    </>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {/* Timer for deploy challenges */}
                {challenge.require_deploy && !challenge.solve_by_myteam && (
                  <div className={`flex items-center gap-2 px-2 py-1 rounded border text-sm font-mono ${
                    theme === 'dark' 
                      ? 'bg-gray-900 border-gray-700' 
                      : 'bg-gray-50 border-gray-300'
                  }`}>
                    <Timer sx={{ fontSize: 16 }} className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} />
                    <span className={`font-bold ${
                      isChallengeStarted 
                        ? 'text-green-500' 
                        : theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      {formatTime(timeRemaining)}
                    </span>
                  </div>
                )}
                
                {challenge.solve_by_myteam && (
                  <span className={`px-2 py-1 rounded border text-xs font-mono font-bold ${
                    theme === 'dark'
                      ? 'bg-green-500/20 text-green-400 border-green-500/30'
                      : 'bg-green-50 text-green-700 border-green-300'
                  }`}>
                    SOLVED
                  </span>
                )}
                
                <button
                  onClick={onClose}
                  className={`p-2 rounded transition-colors ${
                    theme === 'dark'
                      ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                      : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  <Close />
                </button>
              </div>
            </div>

            {/* Show solved message */}
            {challenge.solve_by_myteam && (
              <div className={`p-3 rounded border ${
                theme === 'dark'
                  ? 'bg-green-900/20 border-green-700'
                  : 'bg-green-50 border-green-300'
              }`}>
                <Typography className={`text-center font-mono text-sm ${
                  theme === 'dark' ? 'text-green-400' : 'text-green-700'
                }`}>
                  [✓] Challenge completed
                </Typography>
              </div>
            )}

            {/* Info Badges */}
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <span className={`px-2 py-1 rounded border ${
                theme === 'dark'
                  ? 'bg-gray-700 text-gray-300 border-gray-600'
                  : 'bg-gray-100 text-gray-700 border-gray-300'
              }`}>
                Time: {challenge.time_limit === -1 ? '∞' : `${challenge.time_limit}s`}
              </span>
              <span className={`px-2 py-1 rounded border ${
                theme === 'dark'
                  ? 'bg-gray-700 text-gray-300 border-gray-600'
                  : 'bg-gray-100 text-gray-700 border-gray-300'
              }`}>
                Attempts: {challenge.max_attempts === 0 ? '∞' : challenge.max_attempts}
              </span>
            </div>

            {/* Files */}
            {challenge.files && challenge.files.length > 0 && (
              <div className="space-y-2">
                <div className={`text-xs font-mono font-bold ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  [FILES]
                </div>
                <div className="flex flex-wrap gap-2">
                  {challenge.files.map((file, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        if (file.toLowerCase().includes('.pdf')) {
                          const pdfIndex = pdfFiles.indexOf(file);
                          handlePdfClick(pdfIndex);
                          setSelectedTab(hasDescription ? pdfIndex + 1 : pdfIndex);
                        } else {
                          handleDownloadFile(file);
                        }
                      }}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-mono transition-colors ${
                        file.toLowerCase().includes('.pdf')
                          ? theme === 'dark'
                            ? 'bg-red-900/20 text-red-400 border-red-700 hover:bg-red-900/30'
                            : 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
                          : theme === 'dark'
                          ? 'bg-blue-900/20 text-blue-400 border-blue-700 hover:bg-blue-900/30'
                          : 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100'
                      }`}
                    >
                      {file.toLowerCase().includes('.pdf') ? <PictureAsPdf sx={{ fontSize: 14 }} /> : <FaDownload size={12} />}
                      {getFileName(file)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Connection URL */}
            {url && (
              <div className={`p-3 rounded border ${
                theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-300'
              }`}>
                <p className="font-mono text-xs">
                  <span className={`font-bold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{'>>'} </span>
                  <span className={`break-all ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}`}>{url}</span>
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
                    const isPdfTab = hasDescription ? newValue > 0 : newValue >= 0;
                    if (!isPdfTab || (hasDescription && newValue === 0)) {
                      closePdfViewer();
                    } else {
                      const pdfIdx = hasDescription ? newValue - 1 : newValue;
                      handlePdfClick(pdfIdx);
                    }
                  }}
                  sx={{
                    minHeight: '36px',
                    '& .MuiTab-root': {
                      color: theme === 'dark' ? '#9ca3af' : '#6b7280',
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      minHeight: '36px',
                      textTransform: 'none',
                      padding: '8px 12px',
                    },
                    '& .Mui-selected': {
                      color: theme === 'dark' ? '#22c55e !important' : '#16a34a !important',
                    },
                    '& .MuiTabs-indicator': {
                      backgroundColor: theme === 'dark' ? '#22c55e' : '#16a34a',
                      height: '2px',
                    },
                  }}
                >
                  {hasDescription && (
                    <Tab 
                      icon={<Description sx={{ fontSize: 14 }} />} 
                      iconPosition="start" 
                      label="Description" 
                    />
                  )}
                  {pdfFiles.map((_, index) => (
                    <Tab
                      key={index}
                      icon={<PictureAsPdf sx={{ fontSize: 14 }} />}
                      iconPosition="start"
                      label={`PDF ${index + 1}`}
                    />
                  ))}
                </Tabs>

                {/* Tab Content */}
                <div className="mt-3">
                  {selectedTab === 0 && hasDescription && (
                    <div className={`p-3 rounded border text-sm ${
                      theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-gray-50 border-gray-300'
                    }`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {challenge.description}
                      </ReactMarkdown>
                    </div>
                  )}
                  
                  {pdfFiles.map((_, index) => {
                    const tabIndex = hasDescription ? index + 1 : index;
                    return selectedTab === tabIndex && selectedPdfIndex === null && (
                      <div key={index} className={`p-4 rounded border ${
                        theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-300'
                      }`}>
                        <div className="text-center">
                          <CircularProgress sx={{ color: theme === 'dark' ? '#22c55e' : '#16a34a' }} size={30} />
                          <Typography className={`mt-2 font-mono text-xs ${
                            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                          }`}>
                            Loading PDF...
                          </Typography>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Hints Section */}
            {hints.length > 0 && !challenge.solve_by_myteam && (
              <div className="space-y-2">
                <div className={`text-xs font-mono font-bold ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  [HINTS]
                </div>
                
                <div className="grid grid-cols-6 gap-2">
                  {hints.map((hint, index) => (
                    <button
                      key={hint.id}
                      onClick={() => handleUnlockHint(hint.id, hint.cost)}
                      disabled={unlockingHintId === hint.id}
                      className={`relative p-2 rounded border transition-colors ${
                        theme === 'dark'
                          ? 'bg-gray-900 border-purple-700 hover:border-purple-500 hover:bg-gray-800'
                          : 'bg-gray-50 border-purple-300 hover:border-purple-500 hover:bg-purple-50'
                      } ${unlockingHintId === hint.id ? 'opacity-50 cursor-wait' : ''}`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <div className={`font-bold text-xs font-mono ${
                          theme === 'dark' ? 'text-purple-400' : 'text-purple-600'
                        }`}>
                          H{index + 1}
                        </div>
                        
                        <div className={`text-xs font-mono ${
                          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          {hint.cost}
                        </div>
                      </div>
                    </button>
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
              <div className="space-y-2">
                <div className={`text-xs font-mono font-bold ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  [SUBMIT_FLAG]
                </div>

                {/* Check if max attempts reached */}
                {challenge.max_attempts > 0 && (challenge.attemps || 0) >= challenge.max_attempts ? (
                  <div className={`p-4 rounded border ${
                    theme === 'dark' 
                      ? 'bg-red-900/20 border-red-700' 
                      : 'bg-red-50 border-red-300'
                  }`}>
                    <div className={`font-mono text-sm text-center ${
                      theme === 'dark' ? 'text-red-400' : 'text-red-600'
                    }`}>
                      <div className="font-bold mb-2">[!] MAX ATTEMPTS REACHED</div>
                      <div className="text-xs">
                        You have used all {challenge.max_attempts} attempts for this challenge.
                      </div>
                      <div className="text-xs mt-1">
                        No more submissions allowed.
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      className={`w-full p-3 border rounded font-mono text-sm ${
                        theme === 'dark'
                          ? 'bg-gray-900 text-white border-gray-700'
                          : 'bg-white text-gray-900 border-gray-300'
                      }`}
                      rows={3}
                      placeholder="flag{...}"
                    />
                    
                    {/* Show attempts remaining */}
                    {challenge.max_attempts > 0 && (
                      <div className={`text-xs font-mono ${
                        theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                        <span className={
                          (challenge.max_attempts - (challenge.attemps || 0)) <= 2 
                            ? 'text-orange-500' 
                            : theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'
                        }>
                          [i]
                        </span> Attempts remaining: {challenge.max_attempts - (challenge.attemps || 0)} / {challenge.max_attempts}
                      </div>
                    )}
                    
                    <button
                      onClick={handleSubmitFlag}
                      disabled={isSubmittingFlag || !answer.trim() || cooldownRemaining > 0}
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '13px',
                        textTransform: 'none',
                        color: (isSubmittingFlag || !answer.trim() || cooldownRemaining > 0) ? '#52525b' : '#fff',
                        backgroundColor: (isSubmittingFlag || !answer.trim() || cooldownRemaining > 0) ? '#18181b' : '#22d3ee',
                        border: (isSubmittingFlag || !answer.trim() || cooldownRemaining > 0) ? '1px solid #27272a' : '1px solid #22d3ee',
                        padding: '10px',
                        borderRadius: '4px',
                        cursor: (isSubmittingFlag || !answer.trim() || cooldownRemaining > 0) ? 'not-allowed' : 'pointer',
                        width: '100%',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSubmittingFlag && answer.trim() && cooldownRemaining === 0) {
                          e.currentTarget.style.backgroundColor = '#06b6d4';
                          e.currentTarget.style.borderColor = '#06b6d4';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSubmittingFlag && answer.trim() && cooldownRemaining === 0) {
                          e.currentTarget.style.backgroundColor = '#22d3ee';
                          e.currentTarget.style.borderColor = '#22d3ee';
                        }
                      }}
                    >
                      {isSubmittingFlag 
                        ? '[SUBMITTING...]' 
                        : cooldownRemaining > 0 
                          ? `[COOLDOWN: ${cooldownRemaining}s]`
                          : '[SUBMIT]'}
                    </button>
                    
                    {/* Cooldown Progress Bar */}
                    {cooldownRemaining > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className={`text-xs font-mono ${
                          theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
                        }`}>
                          [!] Cooldown active: {cooldownRemaining}s remaining
                        </div>
                        <div className={`w-full h-1 rounded overflow-hidden ${
                          theme === 'dark' ? 'bg-gray-800' : 'bg-gray-300'
                        }`}>
                          <div 
                            className="h-full bg-orange-500 transition-all duration-1000 ease-linear"
                            style={{ 
                              width: `${cooldownTotal > 0 ? (cooldownRemaining / cooldownTotal) * 100 : 0}%`
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Start/Stop Buttons */}
            {challenge.require_deploy && !challenge.solve_by_myteam && 
             !(challenge.max_attempts > 0 && (challenge.attemps || 0) >= challenge.max_attempts) && (
              <div className="space-y-2">
                {!isChallengeStarted ? (
                  challenge.is_captain ? (
                    <>
                      <button
                        onClick={handleStartChallenge}
                        disabled={isStarting}
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '13px',
                          fontWeight: 'bold',
                          width: '100%',
                          padding: '10px 16px',
                          border: '1px solid #4ade80',
                          backgroundColor: '#4ade80',
                          color: '#000',
                          borderRadius: '4px',
                          cursor: isStarting ? 'not-allowed' : 'pointer',
                          opacity: isStarting ? 0.5 : 1,
                          transition: 'all 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                        }}
                        onMouseEnter={(e) => {
                          if (!isStarting) {
                            e.currentTarget.style.backgroundColor = '#22c55e';
                            e.currentTarget.style.borderColor = '#22c55e';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isStarting) {
                            e.currentTarget.style.backgroundColor = '#4ade80';
                            e.currentTarget.style.borderColor = '#4ade80';
                          }
                        }}
                      >
                        {isStarting && (
                          <CircularProgress 
                            size={14} 
                            sx={{ 
                              color: '#000',
                              animation: 'spin 1s linear infinite',
                              '@keyframes spin': {
                                '0%': {
                                  transform: 'rotate(0deg)',
                                },
                                '100%': {
                                  transform: 'rotate(360deg)',
                                },
                              },
                            }} 
                          />
                        )}
                        <span>{isStarting ? 'Starting...' : '[+] Start Challenge'}</span>
                      </button>
                      {isDeploymentInProgress && (
                        <p className="text-center text-xs font-mono text-red-500 animate-pulse">
                          [~] waiting for challenge deployment...
                        </p>
                      )}
                    </>
                  ) : (
                    <p className={`text-center text-xs font-mono ${
                      theme === 'dark' ? 'text-red-400' : 'text-red-600'
                    }`}>
                      [!] Only captain can start
                    </p>
                  )
                ) : (
                  <button
                    onClick={handleStopChallenge}
                    disabled={isStopping}
                    className={`w-full py-2 px-4 rounded font-mono font-bold text-sm transition-colors ${
                      theme === 'dark'
                        ? 'bg-red-600 hover:bg-red-700 text-white border border-red-500'
                        : 'bg-red-500 hover:bg-red-600 text-white border border-red-400'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isStopping ? '[...] Stopping' : '[-] Stop Challenge'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* PDF Viewer Panel */}
        <AnimatePresence>
          {selectedPdfIndex !== null && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className={`w-1/2 rounded-lg border overflow-hidden ${
                theme === 'dark'
                  ? 'bg-gray-900 border-gray-700'
                  : 'bg-gray-100 border-gray-300'
              }`}
            >
              {/* PDF Header */}
              <div className={`p-3 border-b flex items-center justify-between ${
                theme === 'dark' 
                  ? 'bg-gray-800 border-gray-700' 
                  : 'bg-white border-gray-300'
              }`}>
                <div className="flex items-center gap-2">
                  <PictureAsPdf className="text-red-500" sx={{ fontSize: 18 }} />
                  <h3 className={`font-mono text-sm ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    {getFileName(pdfFiles[selectedPdfIndex])}
                  </h3>
                </div>
                
                <div className="flex items-center gap-2">
                  {numPages && !loadingPdf && (
                    <>
                      <div className={`font-mono text-xs ${
                        theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                        {pageNumber}/{numPages}
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setPageNumber(prev => Math.max(1, prev - 1))}
                          disabled={pageNumber <= 1}
                          className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                            theme === 'dark'
                              ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600'
                              : 'bg-gray-200 hover:bg-gray-300 text-gray-700 border border-gray-300'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          ←
                        </button>
                        <button
                          onClick={() => setPageNumber(prev => Math.min(numPages, prev + 1))}
                          disabled={pageNumber >= numPages}
                          className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                            theme === 'dark'
                              ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600'
                              : 'bg-gray-200 hover:bg-gray-300 text-gray-700 border border-gray-300'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          →
                        </button>
                      </div>
                    </>
                  )}
                  
                </div>
              </div>

              {/* PDF Content */}
              <div className="h-[calc(100%-60px)] overflow-auto p-4 flex justify-center items-start">
                {loadingPdf ? (
                  <div className="flex flex-col items-center justify-center p-12">
                    <CircularProgress sx={{ color: theme === 'dark' ? '#22c55e' : '#16a34a' }} size={40} />
                    <Typography className={`mt-3 font-mono text-xs ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Loading PDF...
                    </Typography>
                  </div>
                ) : pdfBlobUrl ? (
                  <div>
                    <Document
                      file={pdfBlobUrl}
                      onLoadSuccess={onDocumentLoadSuccess}
                      onLoadError={(error) => {
                        console.error('Error loading PDF document:', error);
                        Swal.fire({
                          html: `
                            <div class="font-mono text-left text-sm">
                              <div class="text-red-400 mb-2">[!] PDF load error</div>
                              <div class="text-gray-400">> Document failed</div>
                            </div>
                          `,
                          icon: 'error',
                          iconColor: '#ef4444',
                          confirmButtonText: 'OK',
                          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
                          color: theme === 'dark' ? '#ef4444' : '#000000',
                          customClass: {
                            popup: 'rounded-lg border border-red-500/30',
                            confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
                          },
                        });
                      }}
                      loading={
                        <div className="flex flex-col items-center justify-center p-8">
                          <CircularProgress sx={{ color: theme === 'dark' ? '#22c55e' : '#16a34a' }} size={40} />
                          <Typography className={`mt-3 font-mono text-xs ${
                            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                          }`}>
                            Rendering...
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