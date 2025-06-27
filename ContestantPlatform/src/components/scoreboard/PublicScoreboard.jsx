import React, { useState, useEffect, useMemo, Suspense } from "react";
import { motion } from "framer-motion";
import { FiClock, FiCalendar } from "react-icons/fi";
import { FaTrophy, FaSearch, FaSortUp, FaSortDown, FaChevronLeft, FaChevronRight, FaSyncAlt } from "react-icons/fa";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import ApiHelper from "../../utils/ApiHelper";
import {
  API_SCOREBOARD_TOP_STANDINGS,
  BASE_URL,API_GET_DATE_CONFIG
} from "../../constants/ApiConstant";
import ChartPublic from "./ChartPublic";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const ChartComponent = React.lazy(() => import("./ChartComponent"));

const PublicScoreboard = () => {
  // Countdown state
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [statusMessage, setStatusMessage] = useState("Loading...");
  const [targetDate, setTargetDate] = useState(null);

  useEffect(() => {
    const fetchDate = async () => {
      const api = new ApiHelper(BASE_URL);
      try {
        const res = await api.get(API_GET_DATE_CONFIG);
        if (res.isSuccess) {
          const { start_date, end_date, message } = res;
          const start = new Date(start_date * 1000);
          const end = new Date(end_date * 1000);
          const now = new Date();
          if (message === "CTFd has not been started" && now < start) {
            setStatusMessage("🚀 Contest starts in:");
            setTargetDate(start);
          } else if (message === "CTFd has been started" && now < end) {
            setStatusMessage("⏳ Contest ends in:");
            setTargetDate(end);
          } else {
            setStatusMessage("🏁 Contest has ended");
            setTargetDate(null);
          }
        } else {
          setStatusMessage("⚠️ Error loading schedule");
        }
      } catch {
        setStatusMessage("❌ Server error");
      }
    };
    fetchDate();
  }, []);

  useEffect(() => {
    if (!targetDate) return;
    const timer = setInterval(() => {
      const now = new Date();
      const diff = targetDate - now;
      if (diff <= 0) {
        clearInterval(timer);
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft({ days, hours, minutes, seconds });
    }, 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  const timeBox = (value, label) => (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center bg-gradient-to-br from-orange-400 to-yellow-300 text-white shadow-xl rounded-xl w-20 h-20 m-1"
    >
      <span className="text-xl font-bold">{String(value).padStart(2, "0")}</span>
      <span className="text-xs uppercase">{label}</span>
    </motion.div>
  );
  const [scores, setScores] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [searchTerm, setSearchTerm] = useState(""); // Temporary input value
  const [searchQuery, setSearchQuery] = useState(""); // Actual search term for filtering
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" }); // Track sort column and direction
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10); // Default items per page is now 8
  const [contestEndTime, setContestEndTime] = useState(null);

  // Sinh màu HEX sáng từ chuỗi id (hash + HSL)
  function getColorFromId(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    // 0-359: hue, 60-80: lightness, 60-90: saturation
    const hue = Math.abs(hash) % 360;
    const sat = 70 + (Math.abs(hash) % 20); // 70-89
    const light = 55 + (Math.abs(hash) % 20); // 55-74
    return `hsl(${hue},${sat}%,${light}%)`;
  }

  // Optimize filtering and sorting with useMemo
  const filteredScores = useMemo(() => {
    let result = Object.values(scores).filter((team) =>
      team.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    console.log("Filtered Scores before sorting:", result); // Debug log

    // Apply sorting
    if (sortConfig.key) {
      result.sort((a, b) => {
        let aValue, bValue;
        if (sortConfig.key === "top") {
          aValue = parseInt(Object.keys(scores).find(key => scores[key].id === a.id));
          bValue = parseInt(Object.keys(scores).find(key => scores[key].id === b.id));
        } else if (sortConfig.key === "score") {
          aValue = a.score;
          bValue = b.score;
        }

        if (sortConfig.direction === "asc") {
          return aValue - bValue;
        } else if (sortConfig.direction === "desc") {
          return bValue - aValue;
        }
        return 0;
      });
    }

    console.log("Filtered Scores after sorting:", result); // Debug log
    return result;
  }, [scores, searchQuery, sortConfig]);

  // Paginate the filtered scores
  const paginatedScores = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredScores.slice(startIndex, endIndex);
  }, [filteredScores, currentPage, itemsPerPage]);

  const highestScore = useMemo(() => {
    return Math.max(
      0, // Default value if no valid scores
      ...filteredScores
        .map((team) => team.score)
        .filter((score) => typeof score === "number")
    );
  }, [filteredScores]);

  const totalPages = Math.ceil(filteredScores.length / itemsPerPage);

  // Định nghĩa hàm fetchScores ở ngoài render để dùng lại cho cả useEffect và nút reload
  const fetchScores = async () => {
    setLoading(true);
    try {
      const api = new ApiHelper(BASE_URL);
      const response = await api.get(`${API_SCOREBOARD_TOP_STANDINGS}`);
      if (!response.success) {
        throw new Error("Failed to fetch teams");
      }
      // Map the numeric keys to a 'top' property
      const mappedScores = Object.fromEntries(
        Object.entries(response.data).map(([key, value]) => [
          key,
          { ...value, top: parseInt(key) }
        ])
      );
      setScores(mappedScores);
      // Lấy end_date từ response nếu có (giả sử response.end_date là timestamp giây)
      if (response.end_date) {
        setContestEndTime(response.end_date);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let intervalId;
    fetchScores();
    intervalId = setInterval(fetchScores, 2 * 60 * 1000); // 2 phút
    return () => clearInterval(intervalId);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] bg-transparent rounded-lg">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-theme-color-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-100 text-red-700 rounded-lg" role="alert">
        <p>{error}</p>
      </div>
    );
  }

  // Handle search trigger
  const handleSearch = () => {
    setSearchQuery(searchTerm);
    setCurrentPage(1); // Reset to first page on new search
  };

  // Handle Enter key press
  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  // Handle sort toggle
  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    } else if (sortConfig.key === key && sortConfig.direction === "desc") {
      direction = "asc";
    }
    setSortConfig({ key, direction });
    setCurrentPage(1); // Reset to first page on new sort
  };

  // Handle page change
  const handlePageChange = (page) => {
    const newPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(newPage);
  };

  // Generate page numbers with specific range (1 2 3 ... 9 10) and always show current page
  const getPageNumbers = () => {
    const pageNumbers = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
      }
    } else {
      if (currentPage <= 4) {
        pageNumbers.push(1, 2, 3, 4, 5, '...', totalPages);
      } else if (currentPage >= totalPages - 3) {
        pageNumbers.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pageNumbers.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
      }
    }
    return pageNumbers;
  };

return (
  <div className="fixed inset-0 w-screen h-screen min-h-screen bg-gray-950 flex flex-col items-center justify-start py-8 px-2 z-50 overflow-auto">
    <div className="w-full h-full flex flex-col">
      <div className="flex flex-col lg:flex-row gap-8 w-full h-full flex-1">
        {/* LEFT: Team list */}

        <div className="w-full lg:w-1/3 bg-gray-900 rounded-lg shadow-lg p-6 flex flex-col h-full">
          {/* Countdown message above Team Scores */}
          <div className="mb-2 text-center">
            <span className="text-orange-300 text-base font-semibold">
              {statusMessage}
            </span>
            <div className="flex justify-center mt-2">
              {timeBox(timeLeft.days, "Days")}
              {timeBox(timeLeft.hours, "Hours")}
              {timeBox(timeLeft.minutes, "Minutes")}
              {timeBox(timeLeft.seconds, "Seconds")}
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-6 text-primary text-center text-white">
            Team Scores
          </h2>

          {/* Filters and Sort Controls */}
          <div className="mb-4">
            <div className="flex gap-2 w-full">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Search teams..."
                className="w-full p-2 rounded-lg bg-white/10 text-white border border-gray-300 focus:outline-none focus:ring-2 focus:ring-theme-color-primary"
              />
              <button
                onClick={handleSearch}
                className="p-2 rounded-lg bg-theme-color-primary text-white hover:bg-opacity-80 transition-colors flex items-center justify-center"
                title="Search"
              >
                <FaSearch />
              </button>
              <button
                onClick={fetchScores}
                className="p-2 rounded-lg bg-orange-400 text-white hover:bg-orange-500 font-semibold shadow transition-all flex items-center justify-center"
                title="Reload Data"
              >
                <FaSyncAlt className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-center rounded-xl overflow-hidden" style={{borderCollapse: 'separate', borderSpacing: 0}}>
              <thead>
                <tr className="bg-gray-800 text-orange-400 text-lg">
                  <th className="px-2 py-3 font-bold"> </th>
                  <th className="px-2 py-3 font-bold">Rank</th>
                  <th className="px-2 py-3 font-bold">Team Name</th>
                  <th className="px-2 py-3 font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                {paginatedScores.length > 0 ? (
                  paginatedScores.map((team) => {
                    const color = getColorFromId(String(team.id));
                    return (
                      <tr
                        key={team.id}
                        className={`transition-all duration-300 hover:bg-gray-700/80${selectedTeam === team.id ? ' ring-2 ring-orange-400' : ''}`}
                        onMouseEnter={() => setSelectedTeam(team.id)}
                        onMouseLeave={() => setSelectedTeam(null)}
                        style={{fontFamily: 'monospace'}}
                      >
                        <td className="px-2 py-2">
                          <span className="inline-block w-4 h-4 rounded-full" style={{backgroundColor: color}}></span>
                        </td>
                        <td className="px-2 py-2 font-bold text-xl text-white">{team.top}</td>
                        <td className="px-2 py-2 font-bold text-xl" style={{color}}>{team.name}</td>
                        <td className="px-2 py-2 font-bold text-xl text-orange-400 text-lg flex items-center justify-center gap-1">
                          {team.total_pts ?? team.score ?? 0}
                          {team.top === 1 && <FaTrophy className="text-yellow-400 animate-pulse ml-1" />}
                          {team.top === 2 && <FaTrophy className="text-gray-300 ml-1 animate-pulse" style={{color: "#C0C0C0"}} />}
                          {team.top === 3 && <FaTrophy className="text-orange-700 ml-1 animate-pulse" style={{color: "#cd7f32"}} />}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="7" className="p-4 text-center text-white">
                      No teams found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="mt-4 flex justify-center">
            <div className="flex gap-2 items-center">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-300 hover:text-white transition-colors disabled:text-gray-500"
                title="Previous Page"
              >
                <FaChevronLeft className="w-5 h-5" />
              </button>

              {getPageNumbers().map((page, index) => (
                <button
                  key={index}
                  onClick={() => typeof page === "number" && handlePageChange(page)}
                  disabled={typeof page !== "number"}
                  className={`w-8 h-8 text-sm rounded-full flex items-center justify-center transition-colors
            ${currentPage === page
                      ? "bg-white text-gray-900 font-bold"
                      : "text-gray-300 hover:bg-gray-600 hover:text-white"
                    }`}
                >
                  {page}
                </button>
              ))}

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages || totalPages === 0}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-300 hover:text-white transition-colors disabled:text-gray-500"
                title="Next Page"
              >
                <FaChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Chart */}
        <div className="w-full lg:w-2/3 bg-gray-900 rounded-lg shadow-lg p-6 text-white min-w-0 mt-8 lg:mt-0 h-full flex flex-col">
          <h2 className="text-2xl font-bold text-primary text-center mb-4">
            Score Progress
          </h2>
          <div className="flex-1 flex flex-col">
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-12 w-12 border-t-4 border-theme-color-primary"></div></div>}>
              <div className="w-full h-full flex-1">
                <ChartPublic
                  key={searchQuery + sortConfig.key + sortConfig.direction + selectedTeam + currentPage}
                  data={paginatedScores}
                  selectedTeam={selectedTeam}
                  contestEndTime={contestEndTime}
                  getColorFromId={getColorFromId}
                />
              </div>
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  </div>
);
};

export default PublicScoreboard;