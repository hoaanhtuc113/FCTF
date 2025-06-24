import { Line } from "react-chartjs-2";
import dayjs from "dayjs";
import { color } from "framer-motion";

const ChartComponent = ({ data, selectedTeam = null }) => {
  const teams = Object.values(data);

  // Lấy danh sách tất cả các ngày và sắp xếp
  const allDates = [...new Set(teams.flatMap(team =>
    team.solves.map(solve => dayjs(solve.date).format("DD/MM HH:mm"))
  ))].sort((a, b) => dayjs(a, "DD/MM HH:mm").unix() - dayjs(b, "DD/MM HH:mm").unix());

  // Chuyển đổi dữ liệu thành định dạng cần thiết
  const scores = teams.map((team) => {
    const history = Array(allDates.length).fill(0);
    let cumulativeScore = 0;

    team.solves.forEach((solve) => {
      const dateIndex = allDates.indexOf(dayjs(solve.date).format("DD/MM HH:mm"));
      if (dateIndex !== -1) {
        cumulativeScore += solve.value;
        history[dateIndex] = cumulativeScore;
      }
    });

    // Lấp đầy các giá trị còn trống
    for (let i = 1; i < history.length; i++) {
      if (history[i] === 0) {
        history[i] = history[i - 1];
      }
    }

    return {
      id: team.id,
      teamName: team.name,
      history,
    };
  });

  // Tạo dữ liệu cho biểu đồ
  const chartData = {
    labels: allDates,
    datasets: scores.map((team) => ({
      label: team.teamName,
      data: team.history,
      borderColor: `hsl(${team.id * 60}, 70%, 50%)`,
      backgroundColor: `hsla(${team.id * 60}, 70%, 50%, 0.1)`,
      borderWidth: 2,
      tension: 0.4,
      pointRadius: 4,
      pointHoverRadius: 6,
      hidden: selectedTeam !== null && selectedTeam !== team.id,
    })),
  };

  // Cấu hình tùy chọn của biểu đồ
  const chartOptions = {
    responsive: true,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        position: "top",
        labels: {
          font: {
            family: "Roboto",
            size: 12,
            color: "rgba(255, 255, 255, 0.8)"
          },
        },
      },
      tooltip: {
        enabled: true,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        padding: 12,
        titleFont: {
          family: "Roboto",
          size: 14,
        },
        bodyFont: {
          family: "Roboto",
          size: 12,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: "rgba(255, 255, 255, 0.1)",
        },
      },
      x: {
        grid: {
          color: "rgba(255, 255, 255, 0.1)",
        },
      },
    },
  };

  return <Line data={chartData} options={chartOptions} />;
};

export default ChartComponent;
