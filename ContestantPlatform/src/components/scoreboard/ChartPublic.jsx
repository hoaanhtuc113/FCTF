import { Line } from "react-chartjs-2";
import dayjs from "dayjs";
import React, { useEffect, useState } from "react";
import "chart.js/auto";

const colorPalette = [
  '#FF6384', '#FF9F40', '#FFCD56', '#4BC0C0', '#36A2EB', '#9966FF', '#00C49A', '#F67019', '#B4FF00', '#845EC2', '#00B8A9', '#FFC75F', '#0081CF', '#C34A36', '#D65DB1', '#F9F871'
];

// Countdown component (reuse HomePage logic, simplified)
const ContestCountdown = ({ endTime }) => {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    if (!endTime) return;
    const target = typeof endTime === 'number' ? new Date(endTime * 1000) : new Date(endTime);
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const diff = target - now;
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        clearInterval(timer);
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft({ days, hours, minutes, seconds });
    }, 1000);
    return () => clearInterval(timer);
  }, [endTime]);

  return (
    <div className="flex flex-wrap justify-center items-center gap-4 mb-4">
      <TimeUnit value={timeLeft.days} label="Days" />
      <TimeUnit value={timeLeft.hours} label="Hours" />
      <TimeUnit value={timeLeft.minutes} label="Minutes" />
      <TimeUnit value={timeLeft.seconds} label="Seconds" />
    </div>
  );
};

const TimeUnit = ({ value, label }) => (
  <div className="flex flex-col items-center p-2 bg-gray-800 rounded-lg min-w-[70px]">
    <span className="text-2xl font-bold text-orange-400 mb-1">{String(value).padStart(2, "0")}</span>
    <span className="text-xs text-white uppercase">{label}</span>
  </div>
);

const ChartPublic = ({ data, selectedTeam = null, contestEndTime, getColorFromId }) => {
  const teams = Array.isArray(data) ? data : Object.values(data);
  const allDates = [...new Set(
    teams.flatMap(team => (team.solves || []).map(solve => dayjs(solve.date).format("DD/MM HH:mm")))
  )].sort((a, b) => dayjs(a, "DD/MM HH:mm").unix() - dayjs(b, "DD/MM HH:mm").unix());

  const scores = teams.map((team) => {
    const history = Array(allDates.length).fill(0);
    let score = 0;
    (team.solves || []).forEach(solve => {
      const idx = allDates.indexOf(dayjs(solve.date).format("DD/MM HH:mm"));
      if (idx !== -1) {
        score += solve.value;
        history[idx] = score;
      }
    });
    for (let i = 1; i < history.length; i++) {
      if (history[i] === 0) history[i] = history[i - 1];
    }
    return {
      id: team.id,
      name: team.name,
      history
    };
  });

  const chartData = {
    labels: allDates,
    datasets: scores.map((team) => {
      const color = getColorFromId ? getColorFromId(String(team.id)) : '#36A2EB';
      return {
        label: team.name,
        data: team.history,
        borderColor: color,
        backgroundColor: color.replace('hsl', 'hsla').replace('%)', '%,0.15)'),
        tension: 0,
        borderWidth: selectedTeam === null || selectedTeam === team.id ? 3 : 1.5,
        pointRadius: selectedTeam === null || selectedTeam === team.id ? 4 : 2,
        pointHoverRadius: 6,
        hidden: selectedTeam !== null && selectedTeam !== team.id
      };
    })
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "nearest",
      intersect: false
    },
    plugins: {
      legend: {
        position: "top",
        labels: {
          color: "#fff",
          font: {
            size: 13,
            family: "Inter"
          }
        }
      },
      tooltip: {
        backgroundColor: "#1f2937",
        borderColor: "#4b5563",
        borderWidth: 1,
        titleColor: "#fff",
        bodyColor: "#d1d5db",
        padding: 10,
        titleFont: { size: 14 },
        bodyFont: { size: 13 }
      },
      title: {
        display: false
      }
    },
    scales: {
      x: {
        ticks: {
          color: "#d1d5db",
          maxRotation: 60,
          minRotation: 30,
        },
        grid: {
          color: "rgba(255, 255, 255, 0.1)"
        }
      },
      y: {
        beginAtZero: true,
        ticks: {
          color: "#d1d5db"
        },
        grid: {
          color: "rgba(255, 255, 255, 0.05)"
        }
      }
    }
  };

  return (
    <div className="relative w-full h-full p-4 bg-gray-900 rounded-lg shadow-lg">
      {contestEndTime && <ContestCountdown endTime={contestEndTime} />}
      <Line data={chartData} options={chartOptions} />
    </div>
  );
};

export default ChartPublic;
