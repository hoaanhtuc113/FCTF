import { Typography, CircularProgress, Box, Tabs, Tab } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { challengeService } from '../services/challengeService';
import { useTheme } from '../context/ThemeContext';
import { 
  LockOpen, 
  Lock, 
  Timer, 
  Check,
  Terminal,
  Security,
  PictureAsPdf,
} from '@mui/icons-material';
import { FaDownload } from 'react-icons/fa';
import Swal from 'sweetalert2';
import { saveAs } from 'file-saver';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Document, Page, pdfjs } from 'react-pdf';
import { fetchWithAuth, downloadFile } from '../services/api';
import { API_ENDPOINTS } from '../config/endpoints';
import { 
  CategorySkeleton, 
  ChallengeListSkeleton, 
  ChallengeDetailSkeleton 
} from '../components/Skeleton';
import { authService } from '../services/authService';
import { challengeTimerService } from '../services/challengeTimerService';
import { actionLogService } from '../services/actionLogService';
import { actionType } from '../constants/ActionLogConstant';

// Setup PDF worker
// Setup PDF worker - Use jsDelivr CDN (supports CORS)
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Helper function to get team ID from localStorage
const getTeamId = (): number | null => {
  const team = authService.getTeam();
  return team?.id || null;
};

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
  captain_only_start?: boolean;
  captain_only_submit?: boolean;
  requirements?: ChallengeRequirements | null;
  pod_status?: string | null;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingChallenges, setLoadingChallenges] = useState(false);
  const [loadingChallengeDetail, setLoadingChallengeDetail] = useState(false);
  const [error, setError] = useState('');
  const [isContestActive, setIsContestActive] = useState(false);
  const [prerequisiteInfo, setPrerequisiteInfo] = useState<Map<number, PrerequisiteChallenge[]>>(new Map());
  const [showCategories, setShowCategories] = useState(false);

  // Pagination states
  const [categoryPage, setCategoryPage] = useState(1);
  const [challengePage, setChallengePage] = useState(1);
  const categoriesPerPage = 5;
  const challengesPerPage = 10;

  // Check if challenge prerequisites are met
  const checkPrerequisites = async (challenge: Challenge): Promise<{ locked: boolean; unmetPrereqs: PrerequisiteChallenge[] }> => {
    console.log(`[Prerequisites Check] Challenge ${challenge.id}:`, challenge.requirements);
    
    if (!challenge.requirements?.prerequisites || challenge.requirements.prerequisites.length === 0) {
      console.log(`[Prerequisites Check] Challenge ${challenge.id} has no prerequisites`);
      return { locked: false, unmetPrereqs: [] };
    }

    console.log(`[Prerequisites Check] Challenge ${challenge.id} prerequisites:`, challenge.requirements.prerequisites);
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
        
        // Check URL params for category
        const categoryParam = searchParams.get('category');
        
        if (data.length > 0) {
          // Use category from URL if available, otherwise use first category
          const initialCategory = categoryParam && data.find(c => c.topic_name === categoryParam)
            ? categoryParam
            : data[0].topic_name;
          
          setSelectedCategory(initialCategory);
          await fetchChallenges(initialCategory);
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
  
  // Separate effect to handle opening challenge from URL params (only on mount)
  useEffect(() => {
    const challengeParam = searchParams.get('challenge');
    if (challengeParam && challenges.length > 0 && isContestActive && !selectedChallenge) {
      const challengeId = parseInt(challengeParam, 10);
      if (!isNaN(challengeId)) {
        const challenge = challenges.find(c => c.id === challengeId);
        if (challenge) {
          // Call the click handler without updating URL to avoid loop
          handleChallengeClickInternal(challenge);
        }
      }
    }
  }, [challenges, isContestActive]);

  const fetchChallenges = async (categoryName: string) => {
    try {
      setLoadingChallenges(true);
      const data = await challengeService.getChallengesByTopic(categoryName);
      const challengeList = Array.isArray(data) ? data : [];
      
      // Parse requirements string to object if needed
      const parsedChallenges = challengeList.map(challenge => {
        if (challenge.requirements && typeof challenge.requirements === 'string') {
          try {
            challenge.requirements = JSON.parse(challenge.requirements);
          } catch (e) {
            console.error(`Failed to parse requirements for challenge ${challenge.id}:`, e);
            challenge.requirements = null;
          }
        }
        return challenge;
      });
      
      setChallenges(parsedChallenges);
      
      // Load prerequisites info for challenges with requirements
      await loadPrerequisitesInfo(parsedChallenges);
      
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
    setShowCategories(false); // Hide category overlay after selection
    await fetchChallenges(categoryName);
  };

  // Internal function to load challenge details without updating URL
  const handleChallengeClickInternal = async (challenge: Challenge) => {
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
            <div class="text-orange-400 text-xs p-2 bg-gray-800/50 rounded border border-yellow-500/30">
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
      // Set loading state and show skeleton
      // Don't set selectedChallenge to null to prevent category panel from flickering
      setLoadingChallengeDetail(true);
      
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.DETAIL(challenge.id), {
        method: 'GET'
      });
      const data = await response.json();
      
      // Log access challenge action
      actionLogService.logAction(
        actionType.ACCESS_CHALLENGE, 
        `Tiếp cận thử thách ${challenge.name}`,
        challenge.id
      );
      
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
    } finally {
      setLoadingChallengeDetail(false);
    }
  };

  // Public function called by UI - updates URL and calls internal function
  const handleChallengeClick = async (challenge: Challenge) => {
    // Update URL with category and challenge (only when user clicks, not from URL param)
    setSearchParams({
      category: selectedCategory,
      challenge: challenge.id.toString()
    }, { replace: true }); // Use replace to avoid adding to history stack
    
    // Call internal function to load challenge
    await handleChallengeClickInternal(challenge);
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
    <div className="flex gap-4 min-h-[70vh]">
      {/* Column 1: Categories - Always show, control via opacity */}
      <motion.div
        initial={false}
        animate={{ 
          opacity: (!selectedChallenge || showCategories) ? 1 : 0,
          width: (!selectedChallenge || showCategories) ? 'auto' : 0,
          marginRight: (!selectedChallenge || showCategories) ? '1rem' : 0
        }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex-shrink-0 overflow-hidden"
      >
            <div className={`w-48 rounded-lg border p-3 ${
              theme === 'dark'
                ? 'bg-gray-800 border-gray-700'
                : 'bg-white border-gray-300'
            }`}>
              <div className={`mb-3 pb-2 border-b ${
                theme === 'dark' ? 'border-gray-700' : 'border-gray-300'
              }`}>
                <Typography variant="h6" className={`font-bold font-mono text-xs ${
                  theme === 'dark' ? 'text-orange-300' : 'text-orange-600'
                }`}>
                  [CATEGORIES]
                </Typography>
              </div>
          
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {loading ? (
                  <>
                    <CategorySkeleton />
                    <CategorySkeleton />
                    <CategorySkeleton />
                    <CategorySkeleton />
                    <CategorySkeleton />
                  </>
                ) : (
                  categories
                    .slice((categoryPage - 1) * categoriesPerPage, categoryPage * categoriesPerPage)
                    .map((category) => (
                  <button
                    key={category.topic_name}
                    onClick={() => handleCategoryClick(category.topic_name)}
                    className={`w-full text-left px-2 py-1.5 rounded transition-colors flex items-center justify-between text-xs ${
                      selectedCategory === category.topic_name
                        ? theme === 'dark'
                          ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                          : 'bg-orange-50 text-orange-700 border border-orange-300'
                        : theme === 'dark'
                        ? 'bg-gray-700/50 hover:bg-gray-700 text-gray-300 border border-gray-600'
                        : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {getCategoryIcon(category.topic_name)}
                      <div className="flex-1">
                        <div className="font-bold text-xs font-mono">
                          {category.topic_name.toUpperCase()}
                        </div>
                        <div className={`text-xs font-mono ${
                          selectedCategory === category.topic_name
                            ? theme === 'dark' ? 'text-orange-300' : 'text-orange-600'
                            : theme === 'dark' ? 'text-gray-500' : 'text-gray-500'
                        }`}>
                          {category.challenge_count} challs
                        </div>
                      </div>
                    </div>
                    
                    {selectedCategory === category.topic_name && (
                      <span className="text-orange-500 text-xs">●</span>
                    )}
                  </button>
                ))
                )}
              </div>

              {categories.length > categoriesPerPage && (
                <div className="mt-3 pt-2 border-t border-gray-700">
                  <TerminalPagination
                    currentPage={categoryPage}
                    totalPages={Math.ceil(categories.length / categoriesPerPage)}
                    onPageChange={setCategoryPage}
                    theme={theme}
                  />
                </div>
              )}
            </div>
          </motion.div>

      {/* Column 2: Challenge List */}
      <div 
        className={`transition-all duration-300 ${
          selectedChallenge 
            ? (showCategories ? 'w-72' : 'w-80')
            : 'flex-1'
        }`}
      >
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
            <div className={`mb-4 pb-3 border-b ${
              selectedChallenge ? 'flex items-center justify-between' : ''
            } ${
              theme === 'dark' ? 'border-gray-700' : 'border-gray-300'
            }`}>
              {selectedChallenge && (
                <button
                  onClick={() => setShowCategories(!showCategories)}
                  className={`p-1.5 rounded transition-colors border ${
                    theme === 'dark'
                      ? 'text-orange-400 border-orange-500/50 hover:bg-orange-500/20 hover:border-orange-400'
                      : 'text-orange-600 border-orange-300 hover:bg-orange-50 hover:border-orange-500'
                  }`}
                  title={showCategories ? "Hide Categories" : "Show Categories"}
                >
                  BACK
                </button>
              )}
              <h1 className={`text-xl font-bold font-mono ${
                selectedChallenge ? 'flex-1 text-center' : ''
              } ${
                theme === 'dark' ? 'text-orange-300' : 'text-orange-600'
              }`}>
                [{selectedCategory.toUpperCase()}]
              </h1>
            </div>

            {loadingChallenges ? (
              // Show skeleton while loading challenges
              <div className="space-y-2">
                <ChallengeListSkeleton />
                <ChallengeListSkeleton />
                <ChallengeListSkeleton />
                <ChallengeListSkeleton />
                <ChallengeListSkeleton />
                <ChallengeListSkeleton />
                <ChallengeListSkeleton />
                <ChallengeListSkeleton />
              </div>
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
        {loadingChallengeDetail ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex-1"
          >
            <ChallengeDetailSkeleton />
          </motion.div>
        ) : selectedChallenge ? (
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
              onClose={() => {
                setSelectedChallenge(null);
                // Clear challenge param from URL, keep category (use replace to avoid history entry)
                setSearchParams({ category: selectedCategory }, { replace: true });
              }}
              onFlagSuccess={refreshChallengeData} // Pass refresh function
            />
          </motion.div>
        ) : null}
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
              ? 'bg-gray-700 border-gray-600 text-orange-400 hover:bg-orange-500/20 hover:border-orange-500/50'
              : 'bg-white border-gray-300 text-orange-600 hover:bg-orange-50 hover:border-orange-400'
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
                      ? 'bg-orange-500/20 border-orange-500 text-orange-400'
                      : 'bg-orange-50 border-orange-400 text-orange-600'
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
              ? 'bg-gray-700 border-gray-600 text-orange-400 hover:bg-orange-500/20 hover:border-orange-500/50'
              : 'bg-white border-gray-300 text-orange-600 hover:bg-orange-50 hover:border-orange-400'
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
            ? 'border-orange-500 bg-orange-900/20' 
            : 'border-orange-500 bg-orange-50'
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
                <Check className="text-green-500 flex-shrink-0" sx={{ fontSize: 18 }} />
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
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                    : 'bg-orange-100 text-orange-700 border border-orange-300'
                }`}>
                  [~] deploying...
                </span>
              )}
              
              {/* Pod status badge */}
              {challenge.pod_status && (
                <span className={`px-2 py-0.5 rounded ${
                  challenge.pod_status === 'Running'
                    ? theme === 'dark'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-green-100 text-green-700 border border-green-300'
                    : challenge.pod_status === 'Pending'
                    ? theme === 'dark'
                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                      : 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                    : challenge.pod_status === 'Failed'
                    ? theme === 'dark'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-red-100 text-red-700 border border-red-300'
                    : challenge.pod_status === 'Succeeded'
                    ? theme === 'dark'
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-blue-100 text-blue-700 border border-blue-300'
                    : theme === 'dark'
                    ? 'bg-gray-700 text-gray-400 border border-gray-600'
                    : 'bg-gray-100 text-gray-600 border border-gray-300'
                }`}>
                  [⚡] {challenge.pod_status}
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
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [isPodHealthy, setIsPodHealthy] = useState(false);
  const [selectedPdfIndex, setSelectedPdfIndex] = useState<number | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [unlockingHintId, setUnlockingHintId] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [cooldownTotal, setCooldownTotal] = useState<number>(0);
  const [pdfScale, setPdfScale] = useState<number>(1.0);
  const timerRef = useRef<number | null>(null);
  const cooldownTimerRef = useRef<number | null>(null);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const healthCheckRunningRef = useRef<boolean>(false);
  const stopChallengeRunningRef = useRef<boolean>(false);

  // Filter PDF files
  const pdfFiles = challenge.files?.filter(file => file.toLowerCase().includes('.pdf')) || [];
  const hasDescription = !!challenge.description;
  const hasPdfFiles = pdfFiles.length > 0;

  // Handle mouse wheel zoom for PDF
  const handlePdfWheel = (e: WheelEvent) => {
    // Check if Ctrl key is pressed (standard zoom modifier)
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      
      // Determine zoom direction
      const delta = -e.deltaY;
      const zoomStep = 0.1;
      
      setPdfScale(prev => {
        if (delta > 0) {
          // Zoom in
          return Math.min(2.0, prev + zoomStep);
        } else {
          // Zoom out
          return Math.max(0.5, prev - zoomStep);
        }
      });
    }
  };

  // Attach wheel event listener to PDF container
  useEffect(() => {
    const container = pdfContainerRef.current;
    if (container && selectedPdfIndex !== null) {
      container.addEventListener('wheel', handlePdfWheel, { passive: false });
      
      return () => {
        container.removeEventListener('wheel', handlePdfWheel);
      };
    }
  }, [selectedPdfIndex]);

  // Auto-open first PDF when challenge has PDF files
  useEffect(() => {
    if (hasPdfFiles && selectedPdfIndex === null) {
      handlePdfClick(0);
    }
  }, [challenge.id, hasPdfFiles]);

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

    // Note: Removed loadDeploymentState() - fetchChallengeStatus() handles this by checking is_healthy

    loadCooldown();
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
            
            // Auto stop challenge when time runs out - no confirmation needed
            if (challenge.require_deploy && url) {
              // Show toast notification
              Swal.fire({
                html: `
                  <div class="font-mono text-left text-sm">
                    <div class="text-orange-400 mb-2">[⏱] Time's Up!</div>
                    <div class="text-gray-400 mb-2">> Challenge: ${challenge.name}</div>
                    <div class="text-gray-400">> Stopping instance automatically...</div>
                  </div>
                `,
                icon: 'info',
                iconColor: '#fb923c',
                background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
                color: theme === 'dark' ? '#fb923c' : '#000000',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                timerProgressBar: true,
              });

              // Auto stop without confirmation
              autoStopChallengeOnTimeout();
            }
            
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

  // Listen for global auto-stop events from other pages
  useEffect(() => {
    const handleAutoStop = (event: any) => {
      const { challengeId } = event.detail;
      
      // If this is the challenge that was auto-stopped, update UI
      if (challengeId === challenge.id) {
        console.log('[Global Auto-Stop Event] Updating UI for challenge:', challenge.name);
        setIsChallengeStarted(false);
        setUrl(null);
        setTimeRemaining(null);
        setIsPodHealthy(false);
        setIsHealthChecking(false);
        setIsDeploymentInProgress(false);
        
        // Clear timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        // Refresh challenge data
        if (onFlagSuccess) {
          onFlagSuccess();
        }
      }
    };

    window.addEventListener('challengeAutoStopped', handleAutoStop);
    
    return () => {
      window.removeEventListener('challengeAutoStopped', handleAutoStop);
    };
  }, [challenge.id, challenge.name, onFlagSuccess]);

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
        // Log pod_status for debugging
        console.log('[fetchChallengeStatus] Challenge:', challenge.name, 'pod_status:', data.data.pod_status);
        
        // Set challenge started status from API
        setIsChallengeStarted(data.is_started || false);
        
        // Set URL if challenge was already started
        setUrl(data.challenge_url || null);
        
        // Only set time remaining if we have URL (challenge is deployed)
        if (data.challenge_url && data.time_remaining) {
          setTimeRemaining(data.time_remaining);
          
          // Start global timer for cross-page auto-stop (if not already running)
          challengeTimerService.startTimer(
            challenge.id,
            challenge.name,
            data.time_remaining,
            challenge.require_deploy || false
          );
        } else {
          setTimeRemaining(null); // Show --:-- when no URL
        }
        
        // If pod_status is not Running and challenge was started, reset state
        if (data.data.pod_status && data.data.pod_status !== 'Running' && isChallengeStarted) {
          console.log('[fetchChallengeStatus] Pod is not running anymore, resetting challenge state');
          setIsChallengeStarted(false);
          setUrl(null);
          setTimeRemaining(null);
          setIsPodHealthy(false);
          setIsHealthChecking(false);
          setIsDeploymentInProgress(false);
          
          // Clear timer
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          
          // Stop global timer
          challengeTimerService.stopTimer(challenge.id);
          
          return; // Exit early since pod is not running
        }
        
        // If challenge is started and has URL
        if (data.is_started && data.challenge_url) {
          const deploymentKey = `deployment_${challenge.id}`;
          const healthCheckKey = `healthcheck_${challenge.id}`;
          const savedDeployment = localStorage.getItem(deploymentKey);
          const savedHealthCheck = localStorage.getItem(healthCheckKey);
          
          // Check if pod is healthy
          if (data.data.is_healthy) {
            // Pod is healthy - clean up and stop health checking
            localStorage.removeItem(deploymentKey);
            localStorage.removeItem(healthCheckKey);
            setIsHealthChecking(false);
            setIsPodHealthy(true);
            setIsDeploymentInProgress(false);
            setIsStarting(false);
          } else if (savedHealthCheck || savedDeployment) {
            // Health check is running OR deployment in progress - continue checking
            const healthCheckData = savedHealthCheck ? JSON.parse(savedHealthCheck) : null;
            
            // Check if health check hasn't timed out (5 minutes = 300 seconds)
            if (healthCheckData) {
              const elapsed = (Date.now() - healthCheckData.startTime) / 1000;
              if (elapsed < 300) {
                // Health check still valid - resume it
                console.log('[fetchChallengeStatus] Resuming health check from savedHealthCheck...');
                setIsHealthChecking(true);
                setIsDeploymentInProgress(true);
                setIsStarting(false);
                setIsPodHealthy(false);
                
                // Resume health check loop if not already running
                if (!healthCheckRunningRef.current) {
                  setTimeout(() => {
                    startHealthCheckLoop();
                  }, 100);
                }
              } else {
                // Health check timed out - clean up
                console.log('[fetchChallengeStatus] Health check timed out');
                localStorage.removeItem(deploymentKey);
                localStorage.removeItem(healthCheckKey);
                setIsHealthChecking(false);
                setIsPodHealthy(false);
                setIsDeploymentInProgress(false);
                setIsStarting(false);
              }
            } else if (savedDeployment) {
              // Old deployment state - start health check
              const deploymentData = JSON.parse(savedDeployment);
              const elapsed = (Date.now() - deploymentData.startTime) / 1000;
              
              if (elapsed < 300) {
                console.log('[fetchChallengeStatus] Starting health check from old deployment state...');
                
                // Save health check state
                localStorage.setItem(healthCheckKey, JSON.stringify({
                  startTime: deploymentData.startTime,
                  challengeId: challenge.id,
                  attempts: 0
                }));
                
                setIsHealthChecking(true);
                setIsDeploymentInProgress(true);
                setIsStarting(false);
                setIsPodHealthy(false);
                
                if (!healthCheckRunningRef.current) {
                  setTimeout(() => {
                    startHealthCheckLoop();
                  }, 100);
                }
              } else {
                // Deployment timed out
                localStorage.removeItem(deploymentKey);
                localStorage.removeItem(healthCheckKey);
                setIsHealthChecking(false);
                setIsPodHealthy(false);
                setIsDeploymentInProgress(false);
                setIsStarting(false);
              }
            }
          } else {
            // No deployment state, assume it's an old challenge that was started before
            setIsHealthChecking(false);
            setIsPodHealthy(true);
            setIsDeploymentInProgress(false);
            setIsStarting(false);
          }
        } else if (data.is_started && !data.challenge_url) {
          // Challenge started but no URL yet (still deploying)
          const deploymentKey = `deployment_${challenge.id}`;
          const healthCheckKey = `healthcheck_${challenge.id}`;
          const savedDeployment = localStorage.getItem(deploymentKey);
          const savedHealthCheck = localStorage.getItem(healthCheckKey);
          
          // If we have health check or deployment state, resume checking
          if (savedHealthCheck || savedDeployment) {
            const healthCheckData = savedHealthCheck ? JSON.parse(savedHealthCheck) : (savedDeployment ? JSON.parse(savedDeployment) : null);
            
            if (healthCheckData) {
              const elapsed = (Date.now() - healthCheckData.startTime) / 1000;
              
              if (elapsed < 300) {
                console.log('[fetchChallengeStatus] Resuming health check - no URL yet. Setting UI to health checking state...');
                
                // Ensure health check state is saved
                if (!savedHealthCheck) {
                  localStorage.setItem(healthCheckKey, JSON.stringify({
                    startTime: healthCheckData.startTime,
                    challengeId: challenge.id,
                    attempts: 0
                  }));
                }
                
                // Set UI to show health checking state (like image 2)
                setIsChallengeStarted(false);  // Challenge not fully started yet (no URL)
                setUrl(null);                  // No URL available yet
                setIsHealthChecking(true);     // Show "Health checking..." message
                setIsDeploymentInProgress(true);
                setIsStarting(false);
                setIsPodHealthy(false);
                
                // Resume health check loop if not already running
                if (!healthCheckRunningRef.current) {
                  setTimeout(() => {
                    startHealthCheckLoop();
                  }, 100);
                }
              } else {
                // Timed out
                console.log('[fetchChallengeStatus] Deployment timed out - no URL');
                localStorage.removeItem(deploymentKey);
                localStorage.removeItem(healthCheckKey);
                setIsChallengeStarted(false);
                setUrl(null);
                setIsHealthChecking(false);
                setIsPodHealthy(false);
                setIsDeploymentInProgress(false);
                setIsStarting(false);
              }
            }
          }
        } else {
          // Not started - but check if we have deployment state before cleaning up
          const deploymentKey = `deployment_${challenge.id}`;
          const healthCheckKey = `healthcheck_${challenge.id}`;
          const savedDeployment = localStorage.getItem(deploymentKey);
          const savedHealthCheck = localStorage.getItem(healthCheckKey);
          
          // If we have saved deployment/health check state, it means we're in the middle of deploying
          // Don't clean up - the deployment might just not be reflected in API yet
          if (savedHealthCheck || savedDeployment) {
            const stateData = savedHealthCheck 
              ? JSON.parse(savedHealthCheck) 
              : (savedDeployment ? JSON.parse(savedDeployment) : null);
            
            if (stateData) {
              const elapsed = (Date.now() - stateData.startTime) / 1000;
              
              // If within timeout, keep the state and resume health checking
              if (elapsed < 100) {
                console.log('[fetchChallengeStatus] API says not started, but we have saved state. Resuming health check...');
                
                // Ensure both keys exist
                if (!savedHealthCheck) {
                  localStorage.setItem(healthCheckKey, JSON.stringify({
                    startTime: stateData.startTime,
                    challengeId: challenge.id,
                    attempts: 0
                  }));
                }
                
                setIsHealthChecking(true);
                setIsDeploymentInProgress(true);
                setIsStarting(false);
                setIsPodHealthy(false);
                setIsChallengeStarted(false);
                setUrl(null);
                
                // Resume health check if not running
                if (!healthCheckRunningRef.current) {
                  setTimeout(() => {
                    startHealthCheckLoop();
                  }, 100);
                }
                
                return; // Don't clean up
              } else {
                // Timed out - clean up
                console.log('[fetchChallengeStatus] Deployment state timed out');
                localStorage.removeItem(deploymentKey);
                localStorage.removeItem(healthCheckKey);
              }
            }
          }
          
          // No saved state or timed out - clean up UI
          setIsDeploymentInProgress(false);
          setIsStarting(false);
          setIsHealthChecking(false);
          setIsPodHealthy(false);
        }
      }
    } catch (error) {
      console.error('Error fetching challenge status:', error);
    }
  };

  const handleStartChallenge = async () => {
    setIsStarting(true);
    
    const deploymentKey = `deployment_${challenge.id}`;
    const healthCheckKey = `healthcheck_${challenge.id}`;
    
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.START, {
        method: 'POST',
        body: JSON.stringify({
          challengeId: challenge.id,
        })
      });
      const data = await response.json();

      // Case 1: URL is ready immediately
      if (response.status === 200 && data.success === true && data.challenge_url != null) {
        setIsDeploymentInProgress(true);
        // Save deployment state AFTER successful response
        localStorage.setItem(deploymentKey, JSON.stringify({
          isDeploying: true,
          startTime: Date.now()
        }));
        
        // Save health check state AFTER successful response
        localStorage.setItem(healthCheckKey, JSON.stringify({
          startTime: Date.now(),
          challengeId: challenge.id,
          attempts: 0
        }));
        
        // Set URL immediately
        setIsChallengeStarted(true);
        setUrl(data.challenge_url);
        setIsStarting(false);
        setIsDeploymentInProgress(false);
        
        // Set health checking state to show spinner
        setIsHealthChecking(true);
        
        // Start health check in background
        startHealthCheckLoop();
        
        // Log start challenge action
        actionLogService.logAction(
          actionType.START_CHALLENGE,
          `Khởi động thử thách ${challenge.name}`,
          challenge.id
        );
        
        // Show success message with URL - this is the ONLY popup users see
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-green-400 mb-2">[✓] Challenge Ready!</div>
              <div class="text-gray-400 mb-2">> URL: ${data.challenge_url}</div>
              <div class="text-yellow-400 mt-2">> Health check in progress...</div>
            </div>
          `,
          icon: 'success',
          iconColor: '#22c55e',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#22c55e' : '#000000',
          timer: 5000,
          showConfirmButton: false,
          customClass: {
            popup: 'rounded-lg border border-green-500/30',
          },
        });
      }
      // Case 2: Success but URL is null - deploying, need to wait
      else if (response.status === 200 && data.success === true && data.challenge_url == null) {
        setIsDeploymentInProgress(true);
        // Save deployment state AFTER successful response
        localStorage.setItem(deploymentKey, JSON.stringify({
          isDeploying: true,
          startTime: Date.now()
        }));
        
        // Save health check state AFTER successful response
        localStorage.setItem(healthCheckKey, JSON.stringify({
          startTime: Date.now(),
          challengeId: challenge.id,
          attempts: 0
        }));
        
        // Set challenge as started with message from backend
        setIsChallengeStarted(true);
        setUrl(data.message || 'Deploying challenge...');
        setIsStarting(false);
        setIsDeploymentInProgress(false);
        
        // Set health checking state to show spinner
        setIsHealthChecking(true);
        
        // Start health check in background
        startHealthCheckLoop();
        
        // Log start challenge action
        actionLogService.logAction(
          actionType.START_CHALLENGE,
          `Khởi động thử thách ${challenge.name}`,
          challenge.id
        );
        
        // Show deploying message
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-yellow-400 mb-2">[~] Deploying challenge</div>
              <div class="text-gray-400">> ${data.message || 'Please wait...'}</div>
              <div class="text-orange-400 mt-2">> Health check will start shortly...</div>
            </div>
          `,
          icon: 'info',
          iconColor: '#fbbf24',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#fbbf24' : '#000000',
          timer: 3000,
          showConfirmButton: false,
          customClass: {
            popup: 'rounded-lg border border-yellow-500/30',
          },
        });
      }
      // Case 3: Error or failure
      else {
        setIsStarting(false);
        setIsDeploymentInProgress(false);
        
        // Clear deployment state from localStorage
        const healthCheckKey = `healthcheck_${challenge.id}`;
        localStorage.removeItem(deploymentKey);
        localStorage.removeItem(healthCheckKey);
        
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-red-400 mb-2">[!] Deploy failed</div>
              <div class="text-gray-400">> ${data.message||data.error || 'Unknown error'}</div>
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
      setIsStarting(false);
      setIsDeploymentInProgress(false);
      
      // Clear deployment state from localStorage
      const deploymentKey = `deployment_${challenge.id}`;
      const healthCheckKey = `healthcheck_${challenge.id}`;
      localStorage.removeItem(deploymentKey);
      localStorage.removeItem(healthCheckKey);
      console.error('Start challenge error:', error);
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

  // Health check loop function - runs silently in background
  const startHealthCheckLoop = async () => {
    console.log('[Health Check] startHealthCheckLoop called');
    
    // Prevent duplicate health check loops
    if (healthCheckRunningRef.current) {
      console.log('[Health Check] Already running, skipping duplicate start');
      return;
    }
    
    healthCheckRunningRef.current = true;
    console.log('[Health Check] Starting new health check loop');
    const maxAttempts = 100;
    
    // Restore attempts from localStorage if exists
    const healthCheckKey = `healthcheck_${challenge.id}`;
    const savedHealthCheck = localStorage.getItem(healthCheckKey);
    let attempts = 0;
    
    if (savedHealthCheck) {
      try {
        const healthCheckData = JSON.parse(savedHealthCheck);
        attempts = healthCheckData.attempts || 0;
        console.log(`[Health Check] Restored attempts from localStorage: ${attempts}`);
      } catch (error) {
        console.error('[Health Check] Error parsing saved attempts:', error);
      }
    }
    
    const checkStatus = async (): Promise<boolean> => {
      try {
        attempts++;
        console.log(`[Health Check] Attempt ${attempts}/${maxAttempts}`);
        
        // Save current attempts to localStorage
        const healthCheckKey = `healthcheck_${challenge.id}`;
        const savedHealthCheck = localStorage.getItem(healthCheckKey);
        if (savedHealthCheck) {
          try {
            const healthCheckData = JSON.parse(savedHealthCheck);
            healthCheckData.attempts = attempts;
            localStorage.setItem(healthCheckKey, JSON.stringify(healthCheckData));
          } catch (error) {
            console.error('[Health Check] Error updating attempts:', error);
          }
        }

        const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.START_CHECKING, {
          method: 'POST',
          body: JSON.stringify({
            challengeId: challenge.id,
            teamId: getTeamId(),
          }),
        });
        const data = await response.json();
        if (data.success == true && data.challenge_url) {    
          console.log('[Health Check] Pod is healthy! Stopping health check.');
          
          // Update URL with actual challenge URL (replace message if it was set)
          setUrl(data.challenge_url);
          
          // Set time remaining when healthy (convert minutes to seconds)
          if (data.time_remaining || data.time_limit) {
            const timeInSeconds = data.time_remaining || data.time_limit * 60;
            setTimeRemaining(timeInSeconds);
            
            // Start global timer for cross-page auto-stop
            challengeTimerService.startTimer(
              challenge.id,
              challenge.name,
              timeInSeconds,
              challenge.require_deploy || false
            );
          }
          
          setIsHealthChecking(false);
          setIsPodHealthy(true);
          setIsDeploymentInProgress(false);
          healthCheckRunningRef.current = false;
          
          // Clear deployment state from localStorage
          const deploymentKey = `deployment_${challenge.id}`;
          const healthCheckKey = `healthcheck_${challenge.id}`;
          localStorage.removeItem(deploymentKey);
          localStorage.removeItem(healthCheckKey);
          
          // Refresh challenge data to update pod_status and call category refresh
          if (onFlagSuccess) {
            await onFlagSuccess();
          }
          
          // Note: No popup here - the "Challenge URL ready" popup from handleStartChallenge is already showing
          // Only store notification data for potential future use
          const notificationKey = `deployment_notification_${challenge.id}`;
          localStorage.setItem(notificationKey, JSON.stringify({
            challengeId: challenge.id,
            challengeName: challenge.name,
            status: 'success',
            url: data.challenge_url,
            message: 'Challenge is ready!',
            timestamp: Date.now()
          }));
          
          return true; // Stop loop - SUCCESS
        }
        
        // Max attempts reached
        if (attempts >= maxAttempts) {
          console.log('[Health Check] Max attempts reached. Stopping.');
          setIsHealthChecking(false);
          setIsPodHealthy(false);
          setIsDeploymentInProgress(false);
          setIsStarting(false);
          healthCheckRunningRef.current = false;
          
          // Clear URL to show Start button again
          setUrl(null);
          setIsChallengeStarted(false);
          
          // Clear deployment state from localStorage
          const deploymentKey = `deployment_${challenge.id}`;
          const healthCheckKey = `healthcheck_${challenge.id}`;
          localStorage.removeItem(deploymentKey);
          localStorage.removeItem(healthCheckKey);
          
          // Show timeout notification
          Swal.fire({
            html: `
              <div class="font-mono text-left text-sm">
                <div class="text-red-400 mb-2">[!] Health Check Timeout</div>
                <div class="text-gray-400">> Pod failed to become ready</div>
                <div class="text-gray-400">> Please try starting again</div>
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
          
          return true; // Stop loop - TIMEOUT
        }
        
        // Continue checking silently
        console.log('[Health Check] Pod not ready yet. Waiting 1s...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        return checkStatus(); // Recursive call
        
      } catch (error) {
        console.error('[Health Check] Error:', error);
        
        // Continue trying even on error
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return checkStatus();
        }
        
        // Max attempts reached even with errors
        setIsHealthChecking(false);
        setIsPodHealthy(false);
        setIsDeploymentInProgress(false);
        setIsStarting(false);
        healthCheckRunningRef.current = false;
        
        // Clear URL to show Start button again
        setUrl(null);
        setIsChallengeStarted(false);
        
        // Clear deployment state from localStorage
        const deploymentKey = `deployment_${challenge.id}`;
        const healthCheckKey = `healthcheck_${challenge.id}`;
        localStorage.removeItem(deploymentKey);
        localStorage.removeItem(healthCheckKey);
        
        // Show error notification
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-red-400 mb-2">[!] Health Check Error</div>
              <div class="text-gray-400">> Failed to check pod status</div>
              <div class="text-gray-400">> Please try starting again</div>
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
        
        return true; // Stop loop - ERROR
      }
    };
    
    // Start the check loop
    await checkStatus();
  };

  // Auto stop challenge on timeout without confirmation
  const autoStopChallengeOnTimeout = async () => {
    if (stopChallengeRunningRef.current) {
      console.log('[Auto Stop] Already stopping, ignoring duplicate request');
      return;
    }

    stopChallengeRunningRef.current = true;
    setIsStopping(true);

    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.STOP, {
        method: 'POST',
        body: JSON.stringify({
          challengeId: challenge.id,
        })
      });
      const data = await response.json();

      if (data.success) {
        setIsChallengeStarted(false);
        setUrl(null);
        setTimeRemaining(null);
        setIsPodHealthy(false);
        
        // Clear timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        // Stop global timer
        challengeTimerService.stopTimer(challenge.id);
        
        // Refresh challenge data to update pod_status and call category refresh
        if (onFlagSuccess) {
          await onFlagSuccess();
        }
        
        // Show success toast
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-green-400 mb-2">[✓] Auto Stopped</div>
              <div class="text-gray-400">> Challenge: ${challenge.name}</div>
              <div class="text-gray-400">> Time limit reached</div>
            </div>
          `,
          icon: 'success',
          iconColor: '#22c55e',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#22c55e' : '#000000',
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
        });
      }
    } catch (error) {
      console.error('Auto stop challenge error:', error);
    } finally {
      setIsStopping(false);
      stopChallengeRunningRef.current = false;
    }
  };

  const handleStopChallenge = async () => {
    // Prevent duplicate stop requests
    if (stopChallengeRunningRef.current) {
      console.log('[Stop Challenge] Already stopping, ignoring duplicate request');
      return;
    }

    // Show confirmation dialog
    const result = await Swal.fire({
      html: `
        <div class="font-mono text-left text-sm">
          <div class="text-yellow-400 mb-2">[?] Stop Challenge</div>
          <div class="text-gray-400 mb-2">> Challenge: ${challenge.name}</div>
          <div class="text-gray-400">> Confirm stop instance?</div>
        </div>
      `,
      icon: 'question',
      iconColor: '#fbbf24',
      showCancelButton: true,
      confirmButtonText: 'Stop',
      cancelButtonText: 'Cancel',
      background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
      color: theme === 'dark' ? '#fbbf24' : '#000000',
      customClass: {
        popup: 'rounded-lg border border-yellow-500/30',
        confirmButton: 'bg-orange-500 hover:bg-orange-600 text-white font-mono px-4 py-2 rounded',
        cancelButton: 'bg-gray-600 hover:bg-gray-700 text-white font-mono px-4 py-2 rounded',
      }
    });

    if (!result.isConfirmed) {
      return;
    }

    stopChallengeRunningRef.current = true;
    setIsStopping(true);
    
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.STOP, {
        method: 'POST',
        body: JSON.stringify({
          challengeId: challenge.id,
        })
      });
      const data = await response.json();

      if (data.success) {
        setIsChallengeStarted(false);
        setUrl(null);
        setTimeRemaining(null);
        setIsPodHealthy(false);
        
        // Clear timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        // Stop global timer
        challengeTimerService.stopTimer(challenge.id);
        
        // Refresh challenge data to update pod_status and call category refresh
        if (onFlagSuccess) {
          await onFlagSuccess();
        }
        
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-green-400 mb-2">[✓] Challenge Stopped</div>
              <div class="text-gray-400 mb-2">> Challenge: ${challenge.name}</div>
              <div class="text-gray-400">> Instance terminated successfully</div>
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
      } else {
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-red-400 mb-2">[!] Stop Failed</div>
              <div class="text-gray-400">> ${data.message || 'Unknown error'}</div>
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
    } catch (error) {
      console.error('Stop challenge error:', error);
      Swal.fire({
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-red-400 mb-2">[!] Connection Error</div>
            <div class="text-gray-400">> Failed to stop challenge</div>
            <div class="text-gray-400">> Please try again</div>
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
    } finally {
      setIsStopping(false);
      stopChallengeRunningRef.current = false;
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

    // Check if captain_only_submit is enabled and user is not captain
    if (challenge.captain_only_submit && !challenge.is_captain) {
      Swal.fire({
        html: `<div class="font-mono text-sm text-red-400">[!] Only team captain can submit flags</div>`,
        icon: 'error',
        iconColor: '#ef4444',
        confirmButtonText: 'OK',
        background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
        customClass: {
          popup: 'rounded-lg border border-red-500/30',
          confirmButton: 'bg-red-500 hover:bg-red-600 text-white font-mono px-4 py-2 rounded',
        },
      });
      return;
    }

    setIsSubmittingFlag(true);
    try {
      // Send as JSON instead of FormData
      const requestBody = {
        challengeId: challenge.id,
        submission: answer
      };
      
      const response = await fetchWithAuth(API_ENDPOINTS.FLAGS.SUBMIT, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      const data = await response.json();
      
      if (data?.data?.status === 'correct') {
        // Log correct flag action
        actionLogService.logAction(
          actionType.CORRECT_FLAG,
          `Nộp cờ đúng cho thử thách ${challenge.name}`,
          challenge.id
        );
        
        await Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-green-400 mb-2">[+] FLAG CORRECT</div>
              <div class="text-gray-400">> Challenge solved</div>
              <div class="text-gray-400">> +${data?.data?.value || challenge.value} points</div>
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
        
        // If challenge requires deploy and was started, stop it automatically without confirmation
        if (challenge.require_deploy && isChallengeStarted && url) {
          try {
            // Stop challenge without showing confirmation dialog
            
              // Update UI state
              setIsChallengeStarted(false);
              setUrl(null);
              setTimeRemaining(null);
              setIsPodHealthy(false);
              
              // Clear local timer
              if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
              }
              
              // Cancel global auto-stop timer
              challengeTimerService.stopTimer(challenge.id);
              
              console.log('[Auto Stop After Solve] Challenge stopped successfully');
            
          } catch (error) {
            console.error('[Auto Stop After Solve] Error stopping challenge:', error);
          }
        }
      } else if (data?.data?.status === 'incorrect') {
        // Log incorrect flag action
        actionLogService.logAction(
          actionType.INCORRECT_FLAG,
          `Nộp cờ sai cho thử thách ${challenge.name}`,
          challenge.id
        );
        
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
              <div class="text-orange-400 mb-2">[i] Already solved</div>
              <div class="text-gray-400">> Challenge completed</div>
            </div>
          `,
          icon: 'info',
          iconColor: '#f97316',
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#f97316' : '#000000',
          timer: 1500,
          showConfirmButton: false,
          customClass: {
            popup: 'rounded-lg border border-orange-500/30',
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
    
    // Convert to hours, minutes, seconds
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    
    if (hours > 0) {
      // Show hours and minutes: "Xh Ym"
      if (minutes > 0) {
        return `${hours}h ${minutes}m`;
      } else {
        return `${hours}h`;
      }
    } else if (minutes > 0) {
      // Show minutes and seconds: "Xm Ys"
      if (secs > 0) {
        return `${minutes}m ${secs}s`;
      } else {
        return `${minutes}m`;
      }
    } else {
      // Show seconds only: "Xs"
      return `${secs}s`;
    }
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
        ? (error as any).response?.error
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
              <div class="text-orange-400 mb-2">[i] Already unlocked</div>
              <div class="text-gray-400 mb-2">> Content:</div>
              <div class="text-orange-400 text-xs p-2 bg-gray-800/50 rounded border border-orange-500/30">
                ${hintDetailsResponse.data.content || "No content"}
              </div>
            </div>
          `,
          icon: "info",
          iconColor: '#f97316',
          confirmButtonText: "OK",
          background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
          color: theme === 'dark' ? '#f97316' : '#000000',
          customClass: {
            popup: 'rounded-lg border border-orange-500/30',
            confirmButton: 'bg-orange-500 hover:bg-orange-600 text-white font-mono px-4 py-2 rounded',
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
          // Log unlock hint action
          actionLogService.logAction(
            actionType.UNLOCK_HINT,
            `Mở khóa trợ giúp cho thử thách ${challenge.name}`,
            challenge.id
          );
          
          // Fetch hint details again after unlock
          const updatedHintDetails = await FetchHintDetails(hintId);
          
          if (updatedHintDetails?.data) {
            Swal.fire({
              html: `
                <div class="font-mono text-left text-sm">
                  <div class="text-green-400 mb-2">[+] Hint unlocked</div>
                  <div class="text-gray-400 mb-2">> Content:</div>
                  <div class="text-orange-400 text-xs p-2 bg-gray-800/50 rounded border border-orange-500/30">
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
              iconColor: '#f97316',
              confirmButtonText: "OK",
              background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
              color: theme === 'dark' ? '#f97316' : '#000000',
              customClass: {
                popup: 'rounded-lg border border-orange-500/30',
                confirmButton: 'bg-orange-500 hover:bg-orange-600 text-white font-mono px-4 py-2 rounded',
              },
            });
          }
        } else {
          // Handle errors
          // Check for direct error message (string format)
          if (response.error) {
            Swal.fire({
              html: `
                <div class="font-mono text-left text-sm">
                  <div class="text-yellow-400 mb-2">[!] Hint Locked</div>
                  <div class="text-gray-400">> ${response.error}</div>
                </div>
              `,
              icon: "warning",
              iconColor: '#fbbf24',
              confirmButtonText: "OK",
              background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
              color: theme === 'dark' ? '#fbbf24' : '#000000',
              customClass: {
                popup: 'rounded-lg border border-yellow-500/30',
                confirmButton: 'bg-yellow-500 hover:bg-yellow-600 text-black font-mono px-4 py-2 rounded',
              },
            });
          } else if (response.errors?.score) {
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
                      <div class="text-orange-400 mb-2">[i] Already unlocked</div>
                      <div class="text-gray-400 mb-2">> Content:</div>
                      <div class="text-orange-400 text-xs p-2 bg-gray-800/50 rounded border border-orange-500/30">
                        ${hintDetailsResponse.data.content || "No content"}
                      </div>
                    </div>
                  `,
                  icon: "info",
                  iconColor: '#f97316',
                  confirmButtonText: "OK",
                  background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
                  color: theme === 'dark' ? '#f97316' : '#000000',
                  customClass: {
                    popup: 'rounded-lg border border-orange-500/30',
                    confirmButton: 'bg-orange-500 hover:bg-orange-600 text-white font-mono px-4 py-2 rounded',
                  },
                });
              } else {
                Swal.fire({
                  html: `
                    <div class="font-mono text-left text-sm">
                      <div class="text-orange-400 mb-2">[i] Already unlocked</div>
                      <div class="text-gray-400">> Hint already purchased</div>
                    </div>
                  `,
                  icon: "info",
                  iconColor: '#f97316',
                  confirmButtonText: "OK",
                  background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
                  color: theme === 'dark' ? '#f97316' : '#000000',
                  customClass: {
                    popup: 'rounded-lg border border-orange-500/30',
                    confirmButton: 'bg-orange-500 hover:bg-orange-600 text-white font-mono px-4 py-2 rounded',
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
    // Don't reset scale here, let onDocumentLoadSuccess calculate it
    setLoadingPdf(true);
    
    try {
      // Download PDF with authentication
  const blob = await downloadFile(pdfFiles[index]);

  // Debug info: log blob type/size to help diagnose invalid responses
  console.debug('[handlePdfClick] downloaded blob:', blob.type, blob.size);

  // Store blob in state (pass Blob directly to react-pdf)
  setPdfBlob(blob);
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
    
    // Calculate optimal scale to fit PDF width in container
    setTimeout(() => {
      if (pdfContainerRef.current) {
        const container = pdfContainerRef.current;
        const containerWidth = container.clientWidth - 32; // Subtract padding (16px * 2)
        
        // Get the actual PDF page element to check its width
        const pdfPage = container.querySelector('.react-pdf__Page');
        if (pdfPage) {
          const pageWidth = (pdfPage as HTMLElement).offsetWidth;
          
          // Calculate scale to fit container width
          const optimalScale = containerWidth / pageWidth;
          
          // Clamp between 0.5 and 2.0 for reasonable limits
          const finalScale = Math.max(0.5, Math.min(2.0, optimalScale));
          setPdfScale(finalScale);
        } else {
          // Fallback to 1.0 if can't find PDF page
          setPdfScale(1.0);
        }
      }
    }, 100);
  };

  // Cleanup blob when component unmounts
  useEffect(() => {
    return () => {
      // Clear blob reference to help GC
      // (no object URL was created when using Blob directly)
      // eslint-disable-next-line no-unused-expressions
      pdfBlob && null;
    };
  }, [pdfBlob]);

  return (
    <>
      <div className={`flex gap-4 h-full ${
        selectedPdfIndex !== null ? 'w-full' : ''
      }`}>
        {/* Main Challenge Detail Panel */}
        <div className={`rounded-lg border overflow-hidden transition-all duration-300 ${
          selectedPdfIndex !== null ? 'w-[25%]' : 'w-full'
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
                  <span className="font-mono text-sm">✕</span>
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
                Time: {challenge.time_limit === -1 ? '∞' : formatTime(challenge.time_limit * 60)}
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
                  {challenge.files.map((file, index) => {
                    const isPdf = file.toLowerCase().includes('.pdf');
                    // Count PDF files before this one to get correct Detail number
                    const pdfIndex = isPdf 
                      ? challenge.files!.slice(0, index).filter(f => f.toLowerCase().includes('.pdf')).length + 1
                      : 0;
                    
                    return (
                      <button
                        key={index}
                        onClick={() => handleDownloadFile(file)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-mono transition-colors ${
                          isPdf
                            ? theme === 'dark'
                              ? 'bg-red-900/20 text-red-400 border-red-700 hover:bg-red-900/30'
                              : 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
                            : theme === 'dark'
                            ? 'bg-blue-900/20 text-blue-400 border-blue-700 hover:bg-blue-900/30'
                            : 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100'
                        }`}
                      >
                        {isPdf ? <PictureAsPdf sx={{ fontSize: 14 }} /> : <FaDownload size={12} />}
                        {isPdf ? `Detail ${pdfIndex}` : getFileName(file)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Connection URL - Show if URL exists OR if health checking */}
            {(url || isHealthChecking || isDeploymentInProgress) && (
              <div className={`p-3 rounded border ${
                theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-300'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-mono font-bold ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    [URL]
                  </span>
                  {isHealthChecking ? (
                    <div className="flex items-center gap-2">
                      <CircularProgress 
                        size={12} 
                        sx={{ 
                          color: theme === 'dark' ? '#fbbf24' : '#f59e0b',
                        }} 
                      />
                      <span className={`text-xs font-mono ${
                        theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'
                      }`}>
                        Health checking...
                      </span>
                    </div>
                  ) : isPodHealthy ? (
                    <div className="flex items-center gap-2">
                      <Check 
                        className={`text-sm ${
                          theme === 'dark' ? 'text-green-400' : 'text-green-600'
                        }`}
                      />
                      <span className={`text-xs font-mono ${
                        theme === 'dark' ? 'text-green-400' : 'text-green-600'
                      }`}>
                        Running
                      </span>
                    </div>
                  ) : null}
                </div>
                <p className="font-mono text-xs">
                  <span className={`font-bold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{'>>'} </span>
                  <span className={`break-all ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>
                    {url || 'Send to request to deploy successfully. Please wait a moment.'}
                  </span>
                </p>
              </div>
            )}

            {/* Description - Always show if exists */}
            {hasDescription && (
              <div>
                <div className={`text-xs font-mono font-bold mb-2 ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  [DESCRIPTION]
                </div>
                <div className={`p-3 rounded border text-sm ${
                  theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-gray-50 border-gray-300'
                }`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {challenge.description}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* PDF Tabs - Only for switching between PDFs when there are multiple */}
            {hasPdfFiles && pdfFiles.length > 1 && (
              <div>
                <div className={`text-xs font-mono font-bold mb-2 ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  [PDF FILES]
                </div>
                <Tabs
                  value={selectedPdfIndex !== null ? selectedPdfIndex : 0}
                  onChange={(_, newValue) => {
                    handlePdfClick(newValue);
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
                  {pdfFiles.map((_, index) => (
                    <Tab
                      key={index}
                      icon={<PictureAsPdf sx={{ fontSize: 14 }} />}
                      iconPosition="start"
                      label={`Detail ${index + 1}`}
                    />
                  ))}
                </Tabs>
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
                  <span className="text-orange-500">{'>'}</span>
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
                            : theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
                        }>
                          [i]
                        </span> Attempts remaining: {challenge.max_attempts - (challenge.attemps || 0)} / {challenge.max_attempts}
                      </div>
                    )}
                    
                    {/* Show captain-only submit warning */}
                    {challenge.captain_only_submit && !challenge.is_captain && (
                      <div className={`text-xs font-mono p-2 rounded border ${
                        theme === 'dark' 
                          ? 'bg-red-900/20 text-red-400 border-red-500/30' 
                          : 'bg-red-50 text-red-600 border-red-300'
                      }`}>
                        <span className="text-red-500">[!]</span> Only team captain can submit flags
                      </div>
                    )}
                    
                    <button
                      onClick={handleSubmitFlag}
                      disabled={isSubmittingFlag || !answer.trim() || cooldownRemaining > 0 || (challenge.captain_only_submit && !challenge.is_captain)}
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '13px',
                        textTransform: 'none',
                        color: (isSubmittingFlag || !answer.trim() || cooldownRemaining > 0 || (challenge.captain_only_submit && !challenge.is_captain)) ? '#52525b' : '#fff',
                        backgroundColor: (isSubmittingFlag || !answer.trim() || cooldownRemaining > 0 || (challenge.captain_only_submit && !challenge.is_captain)) ? '#18181b' : '#fb923c',
                        border: (isSubmittingFlag || !answer.trim() || cooldownRemaining > 0 || (challenge.captain_only_submit && !challenge.is_captain)) ? '1px solid #27272a' : '1px solid #fb923c',
                        padding: '10px',
                        borderRadius: '4px',
                        cursor: (isSubmittingFlag || !answer.trim() || cooldownRemaining > 0 || (challenge.captain_only_submit && !challenge.is_captain)) ? 'not-allowed' : 'pointer',
                        width: '100%',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSubmittingFlag && answer.trim() && cooldownRemaining === 0 && !(challenge.captain_only_submit && !challenge.is_captain)) {
                          e.currentTarget.style.backgroundColor = '#f97316';
                          e.currentTarget.style.borderColor = '#f97316';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSubmittingFlag && answer.trim() && cooldownRemaining === 0 && !(challenge.captain_only_submit && !challenge.is_captain)) {
                          e.currentTarget.style.backgroundColor = '#fb923c';
                          e.currentTarget.style.borderColor = '#fb923c';
                        }
                      }}
                    >
                      {isSubmittingFlag 
                        ? '[SUBMITTING...]' 
                        : cooldownRemaining > 0 
                          ? `[COOLDOWN: ${cooldownRemaining}s]`
                          : (challenge.captain_only_submit && !challenge.is_captain)
                            ? '[CAPTAIN ONLY]'
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
                {/* Show Health Checking state if health check is in progress */}
                {isHealthChecking || isDeploymentInProgress ? (
                  <button
                    disabled={true}
                    className={`w-full py-2 px-4 rounded font-mono font-bold text-sm transition-colors flex items-center justify-center gap-2 ${
                      theme === 'dark'
                        ? 'bg-yellow-600 text-white border border-yellow-500'
                        : 'bg-yellow-500 text-white border border-yellow-400'
                    } cursor-not-allowed`}
                  >
                    <CircularProgress 
                      size={14} 
                      sx={{ 
                        color: '#fff',
                      }} 
                    />
                    <span>[-] Health Checking...</span>
                  </button>
                ) : !url ? (
                  // Show Start button only when no URL exists and not health checking
                  (challenge.captain_only_start && !challenge.is_captain) ? (
                    <p className={`text-center text-xs font-mono ${
                      theme === 'dark' ? 'text-red-400' : 'text-red-600'
                    }`}>
                      [!] Only captain can start
                    </p>
                  ) : (
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
                          }} 
                        />
                      )}
                      <span>{isStarting ? 'Starting...' : '[+] Start Challenge'}</span>
                    </button>
                  )
                ) : (
                  // Show Stop button when URL exists (challenge is fully ready)
                  <button
                    onClick={handleStopChallenge}
                    disabled={isStopping}
                    className={`w-full py-2 px-4 rounded font-mono font-bold text-sm transition-colors flex items-center justify-center gap-2 ${
                      theme === 'dark'
                        ? 'bg-red-600 hover:bg-red-700 text-white border border-red-500'
                        : 'bg-red-500 hover:bg-red-600 text-white border border-red-400'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isStopping && (
                      <CircularProgress 
                        size={14} 
                        sx={{ 
                          color: '#fff',
                        }} 
                      />
                    )}
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
              className={`w-[75%] rounded-lg border overflow-hidden flex flex-col max-h-[85vh] ${
                theme === 'dark'
                  ? 'bg-gray-900 border-gray-700'
                  : 'bg-gray-100 border-gray-300'
              }`}
            >
              {/* PDF Header */}
              <div className={`p-3 border-b flex items-center justify-between flex-shrink-0 ${
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
                  {/* Zoom Controls - Minimal Terminal Style */}
                  {numPages && !loadingPdf && (
                    <>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setPdfScale(prev => Math.max(0.5, prev - 0.1))}
                          disabled={pdfScale <= 0.5}
                          className={`px-2 py-0.5 rounded text-xs font-mono transition-colors border ${
                            theme === 'dark'
                              ? 'bg-gray-700 hover:bg-gray-600 text-orange-400 border-gray-600'
                              : 'bg-gray-100 hover:bg-gray-200 text-orange-600 border-gray-300'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          [-]
                        </button>
                        <span className={`font-mono text-xs min-w-[45px] text-center ${
                          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          {Math.round(pdfScale * 100)}%
                        </span>
                        <button
                          onClick={() => setPdfScale(prev => Math.min(3.0, prev + 0.1))}
                          disabled={pdfScale >= 3.0}
                          className={`px-2 py-0.5 rounded text-xs font-mono transition-colors border ${
                            theme === 'dark'
                              ? 'bg-gray-700 hover:bg-gray-600 text-orange-400 border-gray-600'
                              : 'bg-gray-100 hover:bg-gray-200 text-orange-600 border-gray-300'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          [+]
                        </button>
                      </div>
                      
                      <span className={`mx-1 ${theme === 'dark' ? 'text-gray-700' : 'text-gray-400'}`}>|</span>
                    </>
                  )}
                  
                  {/* Page Navigation - Minimal Terminal Style */}
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
                          className={`px-2 py-0.5 rounded text-xs font-mono transition-colors border ${
                            theme === 'dark'
                              ? 'bg-gray-700 hover:bg-gray-600 text-green-400 border-gray-600'
                              : 'bg-gray-100 hover:bg-gray-200 text-green-600 border-gray-300'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          [&lt;]
                        </button>
                        <button
                          onClick={() => setPageNumber(prev => Math.min(numPages, prev + 1))}
                          disabled={pageNumber >= numPages}
                          className={`px-2 py-0.5 rounded text-xs font-mono transition-colors border ${
                            theme === 'dark'
                              ? 'bg-gray-700 hover:bg-gray-600 text-green-400 border-gray-600'
                              : 'bg-gray-100 hover:bg-gray-200 text-green-600 border-gray-300'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          [&gt;]
                        </button>
                      </div>
                    </>
                  )}
                  
                </div>
              </div>

              {/* PDF Content */}
              <div 
                ref={pdfContainerRef}
                className="flex-1 overflow-auto p-4 flex justify-center items-start"
              >
                {loadingPdf ? (
                  <div className="flex flex-col items-center justify-center p-12">
                    <CircularProgress sx={{ color: theme === 'dark' ? '#22c55e' : '#16a34a' }} size={40} />
                    <Typography className={`mt-3 font-mono text-xs ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      Loading PDF...
                    </Typography>
                  </div>
                ) : pdfBlob ? (
                  <div 
                    style={{ 
                      transform: `scale(${pdfScale})`,
                      transformOrigin: 'center top',
                      display: 'inline-block'
                    }}
                  >
                    <Document
                      file={pdfBlob}
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