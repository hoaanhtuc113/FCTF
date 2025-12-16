import { useMemo } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Line,
  LineChart,
} from "recharts";
import { parseUTCToLocal, formatUTCToLocal } from "../utils/timezone";

interface Solve {
  date: string;
  value: number;
}

interface TeamData {
  id: number;
  name: string;
  score: number;
  solves: Solve[];
  top?: number;
}

interface PublicChartComponentProps {
  data: TeamData[];
}

// High contrast color palette - each team gets distinctly different color
const TEAM_COLORS = [
  "#ff0000", // Red
  "#00ff00", // Green
  "#0000ff", // Blue
  "#ffff00", // Yellow
  "#ff00ff", // Magenta
  "#00ffff", // Cyan
  "#ff8800", // Orange
  "#8800ff", // Purple
  "#00ff88", // Spring Green
  "#ff0088", // Hot Pink
  "#88ff00", // Chartreuse
  "#0088ff", // Azure
  "#ff6600", // Dark Orange
  "#6600ff", // Blue Violet
  "#00ff66", // Spring Green
  "#ff0066", // Rose
  "#66ff00", // Lawn Green
  "#0066ff", // Royal Blue
  "#ff3333", // Scarlet
  "#33ff33", // Lime
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-black/90 border-2 border-orange-400 rounded p-3 font-mono text-xs backdrop-blur">
        <p className="text-orange-300 mb-2 font-bold">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 mb-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-orange-400">
              {entry.name}: <span style={{ color: entry.color }} className="font-bold">{entry.value}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const CustomLegend = ({ payload }: any) => {
  return (
    <div className="flex flex-wrap justify-center gap-3 mt-4">
      {payload.map((entry: any, index: number) => (
        <div
          key={`legend-${index}`}
          className="flex items-center gap-2 px-3 py-1 rounded bg-black/60 border-2 border-orange-400/50 text-xs font-mono hover:border-orange-400 transition-colors"
        >
          <div 
            className="w-2 h-2 rounded-full" 
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-orange-300">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function PublicChartComponent({ data }: PublicChartComponentProps) {
  const chartData = useMemo(() => {
    const teams = Object.values(data);

    // Get all unique timestamps and convert to local timezone
    const allDates = [...new Set(
      teams.flatMap(team =>
        team.solves.map(solve => parseUTCToLocal(solve.date).valueOf())
      )
    )].sort((a, b) => a - b);

    // Add starting point: 5 minutes before first solve, all teams at 0
    const startingPoints = [];
    if (allDates.length > 0) {
      const firstSolveTime = allDates[0];
      const startTime = firstSolveTime - 5 * 60 * 1000; // 5 minutes before
      
      const startPoint: any = {
        time: formatUTCToLocal(startTime, "DD/MM HH:mm"),
        timestamp: startTime,
      };
      
      teams.forEach(team => {
        startPoint[team.name] = 0;
      });
      
      startingPoints.push(startPoint);
    }

    // Create data points
    const dataPoints = allDates.map(timestamp => {
      const point: any = {
        time: formatUTCToLocal(timestamp, "DD/MM HH:mm"),
        timestamp,
      };

      teams.forEach(team => {
        // Calculate cumulative score up to this timestamp
        const cumulativeScore = team.solves
          .filter(solve => parseUTCToLocal(solve.date).valueOf() <= timestamp)
          .reduce((sum, solve) => sum + solve.value, 0);
        
        point[team.name] = cumulativeScore;
      });

      return point;
    });

    // Combine starting point with actual data
    return [...startingPoints, ...dataPoints];
  }, [data]);

  const teamNames = useMemo(() => {
    return Object.values(data).map(team => team.name);
  }, [data]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="font-mono text-sm text-orange-600">
          {'>'} No data available for chart
        </p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={chartData}
        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#164e63" opacity={0.3} />
        <XAxis 
          dataKey="time" 
          stroke="#fb923c"
          style={{ fontSize: '11px', fontFamily: 'monospace' }}
          tick={{ fill: '#fb923c' }}
        />
        <YAxis 
          stroke="#fb923c"
          style={{ fontSize: '11px', fontFamily: 'monospace' }}
          tick={{ fill: '#fb923c' }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend content={<CustomLegend />} />
        {teamNames.map((name, index) => (
          <Line
            key={name}
            type="linear"
            dataKey={name}
            stroke={TEAM_COLORS[index % TEAM_COLORS.length]}
            strokeWidth={index === 0 ? 4 : 2}
            dot={{
              r: 4,
              fill: TEAM_COLORS[index % TEAM_COLORS.length],
              strokeWidth: 0
            }}
            activeDot={{
              r: 6,
              fill: TEAM_COLORS[index % TEAM_COLORS.length],
              strokeWidth: 2,
              stroke: "#000"
            }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
