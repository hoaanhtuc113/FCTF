import React, { useState, useEffect, useMemo, Suspense } from "react";
import { AnimatePresence } from "framer-motion";
import { Box, Typography } from "@mui/material";
import { useTheme } from '../context/ThemeContext';
import { scoreboardService } from '../services/scoreboardService';
import type { TeamScore, BracketInfo } from '../services/scoreboardService';
import { ScoreboardVisibilityError } from '../services/publicScoreboardService';
import {
  Search,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  Filter
} from "lucide-react";

const ChartComponent = React.lazy(() => import("../components/ChartComponent"));

interface TeamWithRank extends TeamScore {
  top: number;
}

export function Scoreboard() {
  const { theme } = useTheme();
  const [scores, setScores] = useState<Record<string, TeamScore>>({});
  const [error, setError] = useState("");
  const [visibilityError, setVisibilityError] = useState<{ status: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string | null; direction: string }>({
    key: null,
    direction: "asc"
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [brackets, setBrackets] = useState<BracketInfo[]>([]);
  const [selectedBracket, setSelectedBracket] = useState<number | undefined>(undefined);

  // Optimize filtering and sorting with useMemo
  const filteredScores = useMemo(() => {
    let result: TeamWithRank[] = Object.entries(scores).map(([key, team]) => ({
      ...team,
      top: parseInt(key)
    })).filter((team) =>
      team.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Apply sorting
    if (sortConfig.key) {
      result.sort((a, b) => {
        let aValue: number, bValue: number;
        if (sortConfig.key === "top") {
          aValue = a.top;
          bValue = b.top;
        } else if (sortConfig.key === "score") {
          aValue = a.score;
          bValue = b.score;
        } else {
          return 0;
        }

        if (sortConfig.direction === "asc") {
          return aValue - bValue;
        } else if (sortConfig.direction === "desc") {
          return bValue - aValue;
        }
        return 0;
      });
    }

    return result;
  }, [scores, searchQuery, sortConfig]);

  // Paginate the filtered scores
  const paginatedScores = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredScores.slice(startIndex, endIndex);
  }, [filteredScores, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredScores.length / itemsPerPage);

  const fetchScores = async (showRefreshing = false) => {
    try {
      if (showRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const data = await scoreboardService.getTopStandings(selectedBracket);
      setScores(data);
      setError("");
      setVisibilityError(null);
    } catch (err: any) {
      if (err instanceof ScoreboardVisibilityError) {
        setVisibilityError({ status: err.status, message: err.message });
        setError("");
      } else {
        setError(err.message || "Failed to fetch scoreboard data");
        setVisibilityError(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    await fetchScores(true);
  };

  useEffect(() => {
    scoreboardService.getBrackets().then(setBrackets);
  }, []);

  useEffect(() => {
    fetchScores();
    setCurrentPage(1);
  }, [selectedBracket]);

  if (loading) {
    return (
      <Box className="flex flex-col items-center justify-center min-h-[60vh]">
        <Typography className={`font-mono text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          {'>'} Loading scoreboard...
        </Typography>
      </Box>
    );
  }

  if (visibilityError) {
    return (
      <Box className="flex items-center justify-center min-h-[60vh]">
        <div className={`text-center font-mono p-8 rounded-lg border max-w-md ${
          theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
        }`}>
          <div className={`text-4xl mb-4 ${
            visibilityError.status === 403 ? 'text-red-500' : 'text-yellow-500'
          }`}>
            {visibilityError.status === 403 ? '[✕]' : '[🔒]'}
          </div>
          <div className={`text-lg font-bold mb-2 ${
            theme === 'dark' ? 'text-gray-200' : 'text-gray-800'
          }`}>
            {visibilityError.status === 403 ? 'SCOREBOARD HIDDEN' : 'LOGIN REQUIRED'}
          </div>
          <div className={`text-sm ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {visibilityError.message}
          </div>
        </div>
      </Box>
    );
  }

  if (error) {
    return (
      <Box className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center font-mono text-sm">
          <Typography className="text-red-500 mb-2">
            [!] Error: {error}
          </Typography>
        </div>
      </Box>
    );
  }

  // Handle search trigger
  const handleSearch = () => {
    setSearchQuery(searchTerm);
    setCurrentPage(1);
  };

  // Handle Enter key press
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  // Handle sort toggle
  const requestSort = (key: string) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    } else if (sortConfig.key === key && sortConfig.direction === "desc") {
      direction = "asc";
    }
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    const newPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(newPage);
  };

  // Generate page numbers with specific range (1 2 3 ... 9 10)
  const getPageNumbers = (totalPages: number, currentPage: number): (number | string)[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | string)[] = [];

    if (currentPage <= 4) {
      pages.push(1, 2, 3, 4, 5, "…", totalPages);
    } else if (currentPage >= totalPages - 3) {
      pages.push(1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, "…", currentPage - 1, currentPage, currentPage + 1, "…", totalPages);
    }

    return pages;
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* LEFT: Team Rankings List */}
      <div className="lg:w-2/5 xl:w-1/3">
        <div className={`rounded-lg border p-6 ${theme === 'dark'
            ? 'bg-gray-900 border-gray-700'
            : 'bg-white border-gray-300'
          }`}>
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className={`text-xl font-mono font-bold ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
                }`}>
                [LEADERBOARD]
              </h2>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono text-xs border transition-colors ${refreshing
                    ? theme === 'dark'
                      ? 'bg-gray-700 border-gray-600 text-gray-500 cursor-not-allowed'
                      : 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
                    : theme === 'dark'
                      ? 'bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/30'
                      : 'bg-orange-100 text-orange-700 border-orange-300 hover:bg-orange-200'
                  }`}
                title="Refresh scoreboard"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Refreshing' : 'Refresh'}
              </button>
            </div>
            <p className={`font-mono text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
              }`}>
              {'>'} Live rankings
            </p>
          </div>

          {/* Search & Filters */}
          <div className="mb-4 space-y-3">
            <div className="relative">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                }`} size={16} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Search teams..."
                className={`w-full pl-10 pr-16 py-2 rounded border font-mono text-sm ${theme === 'dark'
                    ? 'bg-gray-800 text-white border-gray-700 focus:border-green-500'
                    : 'bg-white text-gray-900 border-gray-300 focus:border-green-500'
                  }`}
              />

              <button
                onClick={handleSearch}
                className={`absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 rounded font-mono text-xs ${theme === 'dark'
                    ? 'bg-orange-400 hover:bg-orange-600 text-black'
                    : 'bg-orange-400 hover:bg-orange-600 text-white'
                  }`}
              >
                GO
              </button>
            </div>

            <div className="flex gap-2 items-center">
              {brackets.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Filter size={14} className={theme === 'dark' ? 'text-gray-500' : 'text-gray-400'} />
                  <select
                    value={selectedBracket ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedBracket(val ? Number(val) : undefined);
                    }}
                    className={`px-3 py-1 rounded border font-mono text-sm ${theme === 'dark'
                        ? 'bg-gray-800 text-white border-gray-700'
                        : 'bg-white text-gray-900 border-gray-300'
                      }`}
                  >
                    <option value="">All Brackets</option>
                    {brackets.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(+e.target.value);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1 rounded border font-mono text-sm ${theme === 'dark'
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                  }`}
              >
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
              <span className={`font-mono text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
                }`}>
                per page
              </span>
            </div>
          </div>

          {/* Rankings Table */}
          <div className={`overflow-x-auto rounded border ${theme === 'dark' ? 'border-gray-700' : 'border-gray-300'
            }`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${theme === 'dark'
                    ? 'bg-gray-800 border-gray-700'
                    : 'bg-gray-100 border-gray-300'
                  }`}>
                  <th
                    className={`p-3 font-mono cursor-pointer hover:bg-gray-700/50 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}
                    onClick={() => requestSort("top")}
                  >
                    <div className="flex items-center gap-1 justify-center">
                      <span>#</span>
                      {sortConfig.key === "top" && (
                        sortConfig.direction === "asc" ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )
                      )}
                    </div>
                  </th>
                  <th className={`p-3 font-mono text-left ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                    TEAM
                  </th>
                  <th
                    className={`p-3 font-mono text-right cursor-pointer hover:bg-gray-700/50 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                      }`}
                    onClick={() => requestSort("score")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>PTS</span>
                      {sortConfig.key === "score" && (
                        sortConfig.direction === "asc" ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="wait">
                  {paginatedScores.length > 0 ? (
                    paginatedScores.map((team, _index) => {
                      const isTop3 = team.top <= 3;

                      return (
                        <tr
                          key={team.id}
                          className={`border-b transition-colors cursor-pointer ${selectedTeam === team.id
                              ? theme === 'dark'
                                ? "bg-green-900/30"
                                : "bg-green-50"
                              : theme === 'dark'
                                ? "hover:bg-gray-800 border-gray-700"
                                : "hover:bg-gray-50 border-gray-200"
                            }`}
                          onMouseEnter={() => setSelectedTeam(team.id)}
                          onMouseLeave={() => setSelectedTeam(null)}
                        >
                          {/* Rank */}
                          <td className="p-3">
                            <div className="flex items-center justify-center">
                              <span className={`font-mono font-bold ${isTop3
                                  ? team.top + 1 === 1 ? 'text-yellow-500' :
                                    team.top + 1 === 2 ? 'text-gray-400' :
                                      'text-orange-600'
                                  : theme === 'dark' ? 'text-green-400' : 'text-green-600'
                                }`}>
                                {team.top + 1}
                              </span>
                            </div>
                          </td>

                          {/* Team Name */}
                          <td className={`p-3 font-mono ${theme === 'dark' ? 'text-white' : 'text-gray-900'
                            }`}>
                            <div className="flex items-center gap-2">
                              {isTop3 && <span>★</span>}
                              <span className="truncate">{team.name}</span>
                            </div>
                          </td>
                          {/* Score */}
                          <td className="p-3 text-right">
                            <span className={`font-mono font-bold ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
                              }`}>
                              {team.score}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={3} className={`p-8 text-center font-mono text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
                        }`}>
                        {'>'} No teams found
                      </td>
                    </tr>
                  )}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex justify-center">
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className={`px-3 py-1 rounded font-mono text-xs ${currentPage === 1
                      ? theme === 'dark'
                        ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : theme === 'dark'
                        ? 'bg-green-500 hover:bg-green-600 text-black'
                        : 'bg-green-500 hover:bg-green-600 text-white'
                    }`}
                >
                  ←
                </button>

                <div className="flex gap-1">
                  {getPageNumbers(totalPages, currentPage).map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => typeof item === "number" && handlePageChange(item)}
                      disabled={item === "…"}
                      className={`w-8 h-8 flex items-center justify-center rounded font-mono text-xs ${currentPage === item
                          ? theme === 'dark'
                            ? "bg-green-500 text-black font-bold"
                            : "bg-green-500 text-white font-bold"
                          : item === "…"
                            ? theme === 'dark'
                              ? "text-gray-600"
                              : "text-gray-400"
                            : theme === 'dark'
                              ? "bg-gray-800 text-gray-400 hover:bg-gray-700"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages || totalPages === 0}
                  className={`px-3 py-1 rounded font-mono text-xs ${currentPage === totalPages || totalPages === 0
                      ? theme === 'dark'
                        ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : theme === 'dark'
                        ? 'bg-green-500 hover:bg-green-600 text-black'
                        : 'bg-green-500 hover:bg-green-600 text-white'
                    }`}
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Score Progress Chart */}
      <div className="lg:w-3/5 xl:w-2/3">
        <div className={`rounded-lg border p-6 ${theme === 'dark'
            ? 'bg-gray-900 border-gray-700'
            : 'bg-white border-gray-300'
          }`}>
          {/* Chart Header */}
          <div className="mb-6">
            <h2 className={`text-xl font-mono font-bold mb-1 ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'
              }`}>
              [SCORE_EVOLUTION]
            </h2>
            <p className={`font-mono text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
              }`}>
              {'>'} Real-time progress
            </p>
          </div>

          {/* Chart Container */}
          <div className="h-[500px]">
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full">
                  <p className={`font-mono text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                    {<span>{'>'} Loading chart...</span>}
                  </p>
                </div>
              }
            >
              <ChartComponent
                key={`${searchQuery}-${sortConfig.key}-${sortConfig.direction}-${selectedTeam}-${currentPage}`}
                data={paginatedScores}
                selectedTeam={selectedTeam}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}