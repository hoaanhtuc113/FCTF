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
import dayjs from "dayjs";

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

// Cyan-themed color palette for public scoreboard
// Top 1 team gets the brightest orange, others get varied colors
const TEAM_COLORS = [
  "#fb923c", // orange-400 - TOP 1 (brightest)
  "#f59e0b", // amber-500
  "#ef4444", // red-500
  "#8b5cf6", // violet-500
  "#10b981", // emerald-500
  "#ec4899", // pink-500
  "#f97316", // orange-500
  "#f97316", // orange-500
  "#6366f1", // indigo-500
  "#14b8a6", // teal-500
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

    // Get all unique timestamps
    const allDates = [...new Set(
      teams.flatMap(team =>
        team.solves.map(solve => dayjs(solve.date).unix())
      )
    )].sort((a, b) => a - b);

    // Create data points
    return allDates.map(timestamp => {
      const point: any = {
        time: dayjs.unix(timestamp).format("DD/MM HH:mm"),
        timestamp,
      };

      teams.forEach(team => {
        // Calculate cumulative score up to this timestamp
        const cumulativeScore = team.solves
          .filter(solve => dayjs(solve.date).unix() <= timestamp)
          .reduce((sum, solve) => sum + solve.value, 0);
        
        point[team.name] = cumulativeScore;
      });

      return point;
    });
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
          tick={{ fill: '#67e8f9' }}
        />
        <YAxis 
          stroke="#fb923c"
          style={{ fontSize: '11px', fontFamily: 'monospace' }}
          tick={{ fill: '#67e8f9' }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend content={<CustomLegend />} />
        {teamNames.map((name, index) => (
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            stroke={TEAM_COLORS[index % TEAM_COLORS.length]}
            strokeWidth={index === 0 ? 4 : 2}
            dot={index === 0 ? { r: 4, fill: TEAM_COLORS[0] } : false}
            activeDot={index === 0 ? { r: 6 } : { r: 4 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
