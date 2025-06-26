import { Line } from "react-chartjs-2";
import dayjs from "dayjs";
import "chart.js/auto";

const ChartComponent = ({ data, selectedTeam = null }) => {
  const teams = Object.values(data);

  // Lấy mốc thời gian duy nhất và sắp xếp
  const allDates = [...new Set(
    teams.flatMap(team =>
      team.solves.map(solve => dayjs(solve.date).format("DD/MM HH:mm"))
    )
  )].sort((a, b) =>
    dayjs(a, "DD/MM HH:mm").unix() - dayjs(b, "DD/MM HH:mm").unix()
  );

  // Tạo điểm theo thời gian cho từng team
  const scores = teams.map(team => {
    const history = Array(allDates.length).fill(0);
    let score = 0;

    team.solves.forEach(solve => {
      const idx = allDates.indexOf(dayjs(solve.date).format("DD/MM HH:mm"));
      if (idx !== -1) {
        score += solve.value;
        history[idx] = score;
      }
    });

    // Lấp đầy khoảng trống
    for (let i = 1; i < history.length; i++) {
      if (history[i] === 0) history[i] = history[i - 1];
    }

    return {
      id: team.id,
      name: team.name,
      history
    };
  });

  // Gradient color generator
  const getColor = (id, alpha = 1) => `hsla(${(id * 75) % 360}, 100%, 60%, ${alpha})`;

  const chartData = {
    labels: allDates,
    datasets: scores.map(team => ({
      label: team.name,
      data: team.history,
      borderColor: getColor(team.id),
      backgroundColor: getColor(team.id, 0.1),
      tension: 0.4,
      borderWidth: selectedTeam === null || selectedTeam === team.id ? 3 : 1.5,
      pointRadius: selectedTeam === null || selectedTeam === team.id ? 4 : 2,
      pointHoverRadius: 6,
      hidden: selectedTeam !== null && selectedTeam !== team.id
    }))
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
        display: true,
        text: "Biểu đồ điểm theo thời gian",
        color: "#fff",
        font: {
          size: 16,
          family: "Inter",
          weight: "bold"
        },
        padding: {
          top: 10,
          bottom: 30
        }
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
    <div className="w-full h-[500px]">
      <Line data={chartData} options={chartOptions} />
    </div>
  );
};

export default ChartComponent;
