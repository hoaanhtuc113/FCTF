import React, { useState, useEffect, useMemo, Suspense } from "react";
import { FaTrophy, FaSearch, FaSortUp, FaSortDown } from "react-icons/fa";
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
  BASE_URL,
} from "../../constants/ApiConstant";

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

const Scoreboard = () => {
  const [scores, setScores] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [searchTerm, setSearchTerm] = useState(""); // Temporary input value
  const [searchQuery, setSearchQuery] = useState(""); // Actual search term for filtering
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" }); // Track sort column and direction
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10); // Default items per page

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

  useEffect(() => {
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
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchScores();
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

  // Generate page numbers with specific range (1 2 3 ... 9 10)
  const getPageNumbers = () => {
    const pageNumbers = [];
    if (totalPages <= 4) {
      for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
      }
    } else {
      // Show first 3 pages and last 2 pages
      pageNumbers.push(1, 2, 3);
      if (totalPages > 4) {
        pageNumbers.push("...");
      }
      pageNumbers.push(totalPages - 1, totalPages);
    }
    return pageNumbers;
  };

  return (
    <div className="flex flex-col md:flex-row gap-8">
      {/* LEFT: Team list */}
      <div className="md:w-1/3 bg-white/15 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-6 text-primary text-center text-white">
          Team Scores
        </h2>

        {/* Filters and Sort Controls */}
        <div className="mb-4 space-y-2">
          <div className="flex gap-2">
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
              className="p-2 rounded-lg bg-theme-color-primary text-white hover:bg-opacity-80 transition-colors"
            >
              <FaSearch />
            </button>
          </div>
          <div className="flex gap-2 items-center">
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(+e.target.value)}
              className="p-2 rounded-lg text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-theme-color-primary"
              style={{ backgroundColor: "#2f3a4d" }}
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
            <span className="text-white">Items per page</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-theme-color-primary bg-opacity-20 text-white">
               
                <th
                  className="p-4 font-semibold cursor-pointer"
                  onClick={() => requestSort("top")}
                >
                  Top{" "}
                  {sortConfig.key === "top" && (
                    <span className="inline-block transition-transform duration-300">
                      {sortConfig.direction === "asc" ? (
                        <FaSortUp />
                      ) : (
                        <FaSortDown />
                      )}
                    </span>
                  )}
                </th>
                 <th className="p-4 font-semibold">Team Name</th>
                <th
                  className="p-4 font-semibold text-right cursor-pointer"
                  onClick={() => requestSort("score")}
                >
                  Score{" "}
                  {sortConfig.key === "score" && (
                    <span className="inline-block transition-transform duration-300">
                      {sortConfig.direction === "asc" ? (
                        <FaSortUp />
                      ) : (
                        <FaSortDown />
                      )}
                    </span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedScores.length > 0 ? (
                paginatedScores.map((team) => (
                  <tr
                    key={team.id}
                    className={`border-b border-gray-600 transition-all duration-300 ${selectedTeam === team.id
                        ? "bg-gray-50 text-black hover:bg-gray-100"
                        : "bg-theme-color-primary text-white bg-opacity-10"
                      }`}
                    onMouseEnter={() => {
                      console.log("Hovering team:", team.id);
                      setSelectedTeam(team.id);
                    }}
                    onMouseLeave={() => {
                      console.log("Leaving team:", team.id);
                      setSelectedTeam(null);
                    }}
                  >
                    
                    <td className="p-4">{team.top}</td>
                    <td className="p-4 font-semibold">{team.name}</td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <span className="font-bold">{team.score}</span>
                      
                          <FaTrophy className="text-yellow-500 animate-pulse" />
                     
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="3" className="p-4 text-center text-white">
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
              className="px-3 py-1 text-sm rounded-full text-gray-300 hover:text-white transition-colors disabled:text-gray-500"
            >
              PREV
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
              className="px-3 py-1 text-sm rounded-full text-gray-300 hover:text-white transition-colors disabled:text-gray-500"
            >
              NEXT
            </button>
          </div>
        </div>


      </div>

      {/* RIGHT: Chart */}
      <div className="md:w-2/3 bg-white/15 rounded-lg shadow-lg p-6 text-white min-w-0">
        <h2 className="text-2xl font-bold text-primary text-center mb-4">
          Score Progress
        </h2>
        <div className="h-[500px]">
          <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-12 w-12 border-t-4 border-theme-color-primary"></div></div>}>
            <ChartComponent
              key={searchQuery + sortConfig.key + sortConfig.direction + selectedTeam + currentPage}
              data={paginatedScores}
              selectedTeam={selectedTeam}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default Scoreboard;