import  { useMemo } from "react";
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
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

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

interface ChartComponentProps {
  data: TeamData[];
  selectedTeam: number | null;
}

// Minimal color palette
const COLORS = [
  "#00ff9f", // Green
  "#00d4ff", // Cyan
  "#ff00ff", // Magenta
  "#ffff00", // Yellow
  "#ff3864", // Pink
  "#7b2cbf", // Purple
  "#06ffa5", // Light Green
  "#ff006e", // Hot Pink
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded p-3 font-mono text-xs">
        <p className="text-green-400 mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 mb-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-white">
              {entry.name}: <span style={{ color: entry.color }}>{entry.value}</span>
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
          className="flex items-center gap-2 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs font-mono"
        >
          <div 
            className="w-2 h-2 rounded-full" 
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-white">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

const ChartComponent = ({ data, selectedTeam = null }: ChartComponentProps) => {
  const chartData = useMemo(() => {
    const teams = Object.values(data);

    // Get all unique timestamps and convert to local time
    // Parse UTC time from DB and convert to local timezone
    const allDates = [...new Set(
      teams.flatMap(team =>
        team.solves.map(solve => dayjs.utc(solve.date).local().valueOf())
      )
    )].sort((a, b) => a - b);

    // Create data points
    return allDates.map(timestamp => {
      const point: any = {
        time: dayjs(timestamp).format("DD/MM HH:mm"),
        timestamp,
      };

      teams.forEach(team => {
        // Calculate cumulative score up to this timestamp
        const score = team.solves
          .filter(solve => dayjs.utc(solve.date).local().valueOf() <= timestamp)
          .reduce((sum, solve) => sum + solve.value, 0);
        point[team.name] = score;
      });

      return point;
    });
  }, [data]);

  const teams = Object.values(data);
  const teamNames = teams.map(t => t.name);

  // Filter teams based on selection
  const visibleTeams = selectedTeam
    ? teamNames.filter(name => teams.find(t => t.name === name)?.id === selectedTeam)
    : teamNames;

  if (chartData.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center font-mono text-sm text-gray-400">
          <p>No data yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 0, bottom: 60 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255, 255, 255, 0.1)"
          />

          <XAxis
            dataKey="time"
            stroke="#6b7280"
            tick={{ fill: '#9ca3af', fontFamily: 'monospace', fontSize: 11 }}
            angle={-45}
            textAnchor="end"
            height={80}
          />

          <YAxis
            stroke="#6b7280"
            tick={{ fill: '#9ca3af', fontFamily: 'monospace', fontSize: 12 }}
            label={{
              value: 'Score',
              angle: -90,
              position: 'insideLeft',
              style: { fill: '#00ff9f', fontFamily: 'monospace', fontSize: 14 },
            }}
          />

          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} wrapperStyle={{ paddingTop: 20 }} />

          {visibleTeams.map((teamName, index) => {
            const color = COLORS[index % COLORS.length];
            const isHighlighted = selectedTeam
              ? teams.find(t => t.name === teamName)?.id === selectedTeam
              : true;

            return (
              <Line
                key={teamName}
                type="linear"
                dataKey={teamName}
                stroke={color}
                strokeWidth={isHighlighted ? 3 : 2}
                dot={{
                  r: 4,
                  fill: color,
                  strokeWidth: 0
                }}
                activeDot={{
                  r: 6,
                  fill: color,
                  strokeWidth: 2,
                  stroke: "#1f2937"
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ChartComponent;
