import React, { useState, useEffect } from "react";
import { FaTrophy } from "react-icons/fa";
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
import ChartComponent from "./ChartComponent";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const Scoreboard = () => {
  const [scores, setScores] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const highestScore = Math.max(
    0, // Giá trị mặc định nếu không có số hợp lệ
    ...Object.values(scores)
      .map((team) => team.score)
      .filter((score) => typeof score === "number")
  );

  useEffect(() => {
    const fetchScores = async () => {
      setLoading(true);
      try {
        const api = new ApiHelper(BASE_URL);
        const response = await api.get(`${API_SCOREBOARD_TOP_STANDINGS}`);
        if (!response.success) {
          throw new Error("Failed to fetch teams");
        }
        setScores(response.data);
        console.log(highestScore);
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

  return (
 <div className="flex flex-col md:flex-row gap-8">
  {/* LEFT: Team list */}
  <div className="md:w-1/3 bg-white/15 rounded-lg shadow-lg p-6">
    <h2 className="text-2xl font-bold mb-6 text-primary text-center text-white">
      Team Scores
    </h2>
    <div className="space-y-2">
      {Object.values(scores).map((team) => (
        <div
          key={team.id}
          className={`p-4 rounded-lg transition-all duration-300 ${
            selectedTeam === team.id
              ? "bg-gray-50 hover:text-black hover:bg-gray-100"
              : "bg-theme-color-primary text-white bg-opacity-10"
          }`}
          onMouseEnter={() => setSelectedTeam(team.id)}
          onMouseLeave={() => setSelectedTeam(null)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <span className="font-semibold">{team.name}</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-bold">{team.score}</span>
              {team.score === highestScore && (
                <FaTrophy className="text-yellow-500 animate-pulse" />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>

  {/* RIGHT: Chart */}
  <div className="md:w-2/3 bg-white/15 rounded-lg shadow-lg p-6 text-white min-w-0">
    <h2 className="text-2xl font-bold text-primary text-center mb-4">
      Score Progress
    </h2>
    <div className="h-[500px]">
      <ChartComponent data={scores} selectedTeam={selectedTeam} />
    </div>
  </div>
</div>

  );
};

export default Scoreboard;
