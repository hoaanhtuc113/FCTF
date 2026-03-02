import "./main";
import CTFd from "../compat/CTFd";
import $ from "jquery";
import echarts from "echarts/dist/echarts.common";
import { colorHash } from "../compat/styles";

const analyticsEndpoint = "/api/v1/statistics/challenges/analytics";
const analyticsCacheMs = 60000;
let analyticsCache = null;
let analyticsCacheAt = 0;

const fetchChallengeAnalytics = (force = false) => {
  const now = Date.now();
  if (
    force ||
    !analyticsCache ||
    now - analyticsCacheAt > analyticsCacheMs
  ) {
    analyticsCache = CTFd.fetch(analyticsEndpoint).then((response) =>
      response.json()
    );
    analyticsCacheAt = now;
  }
  return analyticsCache;
};

const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined) {
    return "-";
  }
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const renderChallengeAnalytics = (force = false) => {
  fetchChallengeAnalytics(force).then((response) => {
    if (!response || !response.success) {
      return;
    }
    const data = response.data;
    const rows = data.challenges || [];

    const tableBody = document.querySelector(
      "#challenge-analytics-table tbody"
    );
    if (tableBody) {
      tableBody.innerHTML = "";
      if (!rows.length) {
        const emptyRow = document.createElement("tr");
        emptyRow.innerHTML =
          '<td colspan="5" class="text-center">No data</td>';
        tableBody.appendChild(emptyRow);
      } else {
        rows
          .sort((a, b) => b.solve_rate - a.solve_rate)
          .forEach((row) => {
            const tr = document.createElement("tr");
            const percent = (row.solve_rate * 100).toFixed(1);
            tr.innerHTML = `
              <td>${row.name}</td>
              <td>${percent}%</td>
              <td>${formatDuration(row.avg_solve_seconds)}</td>
              <td>${row.wrong_attempts}</td>
              <td>${row.hint_usage}</td>
            `;
            tableBody.appendChild(tr);
          });
      }
    }

    const mostSolved = document.getElementById("category-most-solved");
    const leastSolved = document.getElementById("category-least-solved");
    if (mostSolved) {
      mostSolved.textContent = data.category_most_solved?.name || "-";
    }
    if (leastSolved) {
      leastSolved.textContent = data.category_least_solved?.name || "-";
    }
  });
};

const exportChallengeAnalytics = () => {
  fetchChallengeAnalytics().then((response) => {
    if (!response || !response.success) {
      return;
    }
    const rows = response.data?.challenges || [];
    const header = [
      "Challenge",
      "% Solve",
      "Avg Time (seconds)",
      "Wrong Attempts",
      "Hint Usage",
    ];
    const lines = [header.join(",")];
    rows.forEach((row) => {
      const percent = (row.solve_rate * 100).toFixed(2);
      const avg =
        row.avg_solve_seconds === null || row.avg_solve_seconds === undefined
          ? ""
          : Math.round(row.avg_solve_seconds);
      const name = String(row.name).replace(/"/g, '""');
      lines.push(
        [`"${name}"`, percent, avg, row.wrong_attempts, row.hint_usage].join(
          ","
        )
      );
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "challenge-analytics.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
};

const graph_configs = {
  "#solves-graph": {
    data: () => CTFd.api.get_challenge_solve_statistics(),
    format: (response) => {
      const data = response.data;
      const chals = [];
      const counts = [];
      const solves = {};
      for (let c = 0; c < data.length; c++) {
        solves[data[c]["id"]] = {
          name: data[c]["name"],
          solves: data[c]["solves"],
        };
      }

      const solves_order = Object.keys(solves).sort(function (a, b) {
        return solves[b].solves - solves[a].solves;
      });

      $.each(solves_order, function (key, value) {
        chals.push(solves[value].name);
        counts.push(solves[value].solves);
      });

      const option = {
        title: {
          left: "center",
          text: "Solve Counts",
          textStyle: {
            fontFamily: "Space Mono",
            color: "#ff5500",
          },
        },
        tooltip: {
          trigger: "item",
          textStyle: {
            fontFamily: "Space Mono",
          },
        },
        toolbox: {
          show: true,
          feature: {
            mark: { show: true },
            dataView: { show: true, readOnly: false },
            magicType: { show: true, type: ["line", "bar"] },
            restore: { show: true },
            saveAsImage: { show: true },
          },
          emphasis: {
            iconStyle: {
              borderColor: "#ff5500",
            },
          },
        },
        xAxis: {
          name: "Solve Count",
          nameLocation: "middle",
          type: "value",
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
        },
        yAxis: {
          name: "Challenge Name",
          nameLocation: "middle",
          nameGap: 60,
          type: "category",
          data: chals,
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
          axisLabel: {
            interval: 0,
            rotate: 0, //If the label names are too long you can manage this by rotating the label.
          },
        },
        dataZoom: [
          {
            show: false,
            start: 0,
            end: 100,
          },
          {
            type: "inside",
            yAxisIndex: 0,
            show: true,
            width: 20,
          },
          {
            fillerColor: "rgba(233, 236, 241, 0.4)",
            show: true,
            yAxisIndex: 0,
            width: 20,
          },
        ],
        series: [
          {
            itemStyle: { normal: { color: "#ff5500" } },
            data: counts,
            type: "bar",
          },
        ],
      };

      return option;
    },
  },

  "#keys-pie-graph": {
    data: () => CTFd.api.get_submission_property_counts({ column: "type" }),
    format: (response) => {
      const data = response.data;
      const solves = data["correct"];
      const fails = data["incorrect"];

      let option = {
        title: {
          left: "center",
          text: "Submission Percentages",
          textStyle: {
            fontFamily: "Space Mono",
            color: "#ff5500",
          },
        },
        tooltip: {
          trigger: "item",
          textStyle: {
            fontFamily: "Space Mono",
          },
        },
        toolbox: {
          show: true,
          feature: {
            dataView: { show: true, readOnly: false },
            saveAsImage: {},
          },
          emphasis: {
            iconStyle: {
              borderColor: "#ff5500",
            },
          },
        },
        legend: {
          orient: "vertical",
          top: "middle",
          right: 0,
          data: ["Fails", "Solves"],
        },
        series: [
          {
            name: "Submission Percentages",
            type: "pie",
            radius: ["30%", "50%"],
            avoidLabelOverlap: false,
            label: {
              show: false,
              position: "center",
            },
            itemStyle: {
              normal: {
                label: {
                  show: true,
                  formatter: function (data) {
                    return `${data.name} - ${data.value} (${data.percent}%)`;
                  },
                },
                labelLine: {
                  show: true,
                },
              },
              emphasis: {
                label: {
                  show: true,
                  position: "center",
                  textStyle: {
                    fontSize: "14",
                    fontWeight: "normal",
                  },
                },
              },
            },
            emphasis: {
              label: {
                show: true,
                fontSize: "30",
                fontWeight: "bold",
              },
            },
            labelLine: {
              show: false,
            },
            data: [
              {
                value: fails,
                name: "Fails",
                itemStyle: { color: "rgb(207, 38, 0)" },
              },
              {
                value: solves,
                name: "Solves",
                itemStyle: { color: "rgb(0, 209, 64)" },
              },
            ],
          },
        ],
      };

      return option;
    },
  },

  "#categories-pie-graph": {
    data: () => CTFd.api.get_challenge_property_counts({ column: "category" }),
    format: (response) => {
      const data = response.data;

      const categories = [];
      const count = [];

      for (let category in data) {
        if (Object.hasOwn(data, category)) {
          categories.push(category);
          count.push(data[category]);
        }
      }

      for (let i = 0; i < data.length; i++) {
        categories.push(data[i].category);
        count.push(data[i].count);
      }

      let option = {
        title: {
          left: "center",
          text: "Category Breakdown",
          textStyle: {
            fontFamily: "Space Mono",
            color: "#ff5500",
          },
        },
        tooltip: {
          trigger: "item",
          textStyle: {
            fontFamily: "Space Mono",
          },
        },
        toolbox: {
          show: true,
          feature: {
            dataView: { show: true, readOnly: false },
            saveAsImage: {},
          },
          emphasis: {
            iconStyle: {
              borderColor: "#ff5500",
            },
          },
        },
        legend: {
          type: "scroll",
          orient: "vertical",
          top: "middle",
          right: 10,
          data: [],
        },
        series: [
          {
            name: "Category Breakdown",
            type: "pie",
            radius: ["30%", "50%"],
            label: {
              show: false,
              position: "center",
            },
            itemStyle: {
              normal: {
                label: {
                  show: true,
                  formatter: function (data) {
                    return `${data.percent}% (${data.value})`;
                  },
                },
                labelLine: {
                  show: true,
                },
              },
              emphasis: {
                label: {
                  show: true,
                  position: "center",
                  textStyle: {
                    fontSize: "14",
                    fontWeight: "normal",
                  },
                },
              },
            },
            emphasis: {
              label: {
                show: true,
                fontSize: "30",
                fontWeight: "bold",
              },
            },
            data: [],
          },
        ],
      };

      categories.forEach((category, index) => {
        option.legend.data.push(category);
        option.series[0].data.push({
          value: count[index],
          name: category,
          itemStyle: { color: colorHash(category) },
        });
      });

      return option;
    },
  },

  "#category-solves-graph": {
    data: () => fetchChallengeAnalytics(),
    format: (response) => {
      const data = response.data?.categories || {};
      const categories = Object.keys(data);
      const values = categories.map((key) => data[key]);

      const paired = categories.map((name, index) => ({
        name,
        value: values[index],
      }));
      paired.sort((a, b) => b.value - a.value);

      const names = paired.map((item) => item.name);
      const counts = paired.map((item) => item.value);

      return {
        title: {
          left: "center",
          text: "Category Solves",
          textStyle: {
            fontFamily: "Space Mono",
            color: "#ff5500",
          },
        },
        tooltip: {
          trigger: "item",
          textStyle: {
            fontFamily: "Space Mono",
          },
        },
        toolbox: {
          show: true,
          feature: {
            dataView: { show: true, readOnly: false },
            saveAsImage: { show: true },
          },
          emphasis: {
            iconStyle: {
              borderColor: "#ff5500",
            },
          },
        },
        xAxis: {
          type: "value",
          name: "Solves",
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
        },
        yAxis: {
          type: "category",
          data: names,
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
        },
        series: [
          {
            type: "bar",
            data: counts,
            itemStyle: {
              color: (params) => colorHash(names[params.dataIndex]),
            },
          },
        ],
      };
    },
  },

  "#solve-percentages-graph": {
    layout: (annotations) => ({
      title: "Solve Percentages per Challenge",
      xaxis: {
        title: "Challenge Name",
      },
      yaxis: {
        title: `Percentage of ${CTFd.config.userMode.charAt(0).toUpperCase() +
          CTFd.config.userMode.slice(1)
          } (%)`,
        range: [0, 100],
      },
      annotations: annotations,
    }),
    data: () => CTFd.api.get_challenge_solve_percentages(),
    format: (response) => {
      const data = response.data;

      const names = [];
      const percents = [];

      const annotations = [];

      for (let key in data) {
        names.push(data[key].name);
        percents.push(data[key].percentage * 100);

        const result = {
          x: data[key].name,
          y: data[key].percentage * 100,
          text: Math.round(data[key].percentage * 100) + "%",
          xanchor: "center",
          yanchor: "bottom",
          showarrow: false,
        };
        annotations.push(result);
      }

      const option = {
        title: {
          left: "center",
          text: "Solve Percentages per Challenge",
          textStyle: {
            fontFamily: "Space Mono",
            color: "#ff5500",
          },
        },
        tooltip: {
          trigger: "item",
          formatter: function (data) {
            return `${data.name} - ${(Math.round(data.value * 10) / 10).toFixed(
              1
            )}%`;
          },
          textStyle: {
            fontFamily: "Space Mono",
          },
        },
        toolbox: {
          show: true,
          feature: {
            mark: { show: true },
            dataView: { show: true, readOnly: false },
            magicType: { show: true, type: ["line", "bar"] },
            restore: { show: true },
            saveAsImage: { show: true },
          },
          emphasis: {
            iconStyle: {
              borderColor: "#ff5500",
            },
          },
        },
        xAxis: {
          name: "Challenge Name",
          nameGap: 40,
          nameLocation: "middle",
          type: "category",
          data: names,
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
          axisLabel: {
            fontFamily: "Space Mono",
            interval: 0,
            rotate: 50,
          },
        },
        yAxis: {
          name: `Percentage of ${CTFd.config.userMode.charAt(0).toUpperCase() +
            CTFd.config.userMode.slice(1)
            } (%)`,
          nameGap: 50,
          nameLocation: "middle",
          type: "value",
          min: 0,
          max: 100,
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
          axisLabel: {
            fontFamily: "Space Mono",
            interval: 0,
            rotate: 0,
          },
        },
        dataZoom: [
          {
            show: false,
            start: 0,
            end: 100,
          },
          {
            type: "inside",
            show: true,
            start: 0,
            end: 100,
          },
          {
            fillerColor: "rgba(233, 236, 241, 0.4)",
            show: true,
            right: 60,
            yAxisIndex: 0,
            width: 20,
          },
          {
            type: "slider",
            fillerColor: "rgba(233, 236, 241, 0.4)",
            top: 35,
            height: 20,
            show: true,
            start: 0,
            end: 100,
          },
        ],
        series: [
          {
            itemStyle: { normal: { color: "#ff5500" } },
            data: percents,
            type: "bar",
          },
        ],
      };

      return option;
    },
  },

  "#avg-solve-time-graph": {
    data: () => fetchChallengeAnalytics(),
    format: (response) => {
      const rows = response.data?.challenges || [];
      const filtered = rows
        .filter((row) => row.avg_solve_seconds !== null)
        .map((row) => ({
          name: row.name,
          value: row.avg_solve_seconds,
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 20);

      const names = filtered.map((row) => row.name);
      const values = filtered.map((row) => Math.round(row.value / 60));

      return {
        title: {
          left: "center",
          text: "Avg Solve Time (minutes)",
          textStyle: {
            fontFamily: "Space Mono",
            color: "#ff5500",
          },
        },
        tooltip: {
          trigger: "item",
          formatter: function (data) {
            return `${data.name} - ${data.value}m`;
          },
          textStyle: {
            fontFamily: "Space Mono",
          },
        },
        toolbox: {
          show: true,
          feature: {
            dataView: { show: true, readOnly: false },
            saveAsImage: { show: true },
          },
          emphasis: {
            iconStyle: {
              borderColor: "#ff5500",
            },
          },
        },
        xAxis: {
          type: "value",
          name: "Minutes",
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
        },
        yAxis: {
          type: "category",
          data: names,
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
        },
        series: [
          {
            itemStyle: { normal: { color: "#ff5500" } },
            data: values,
            type: "bar",
          },
        ],
      };
    },
  },

  "#wrong-attempts-graph": {
    data: () => fetchChallengeAnalytics(),
    format: (response) => {
      const rows = response.data?.challenges || [];
      const sorted = rows
        .map((row) => ({
          name: row.name,
          value: row.wrong_attempts || 0,
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 20);

      const names = sorted.map((row) => row.name);
      const values = sorted.map((row) => row.value);

      return {
        title: {
          left: "center",
          text: "Wrong Attempts (top 20)",
          textStyle: {
            fontFamily: "Space Mono",
            color: "#ff5500",
          },
        },
        tooltip: {
          trigger: "item",
          textStyle: {
            fontFamily: "Space Mono",
          },
        },
        toolbox: {
          show: true,
          feature: {
            dataView: { show: true, readOnly: false },
            saveAsImage: { show: true },
          },
          emphasis: {
            iconStyle: {
              borderColor: "#ff5500",
            },
          },
        },
        xAxis: {
          type: "value",
          name: "Attempts",
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
        },
        yAxis: {
          type: "category",
          data: names,
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
        },
        series: [
          {
            itemStyle: { normal: { color: "#cf2600" } },
            data: values,
            type: "bar",
          },
        ],
      };
    },
  },

  "#score-distribution-graph": {
    layout: (annotations) => ({
      title: "Score Distribution",
      xaxis: {
        title: "Score Bracket",
        showticklabels: true,
        type: "category",
      },
      yaxis: {
        title: `Number of ${CTFd.config.userMode.charAt(0).toUpperCase() +
          CTFd.config.userMode.slice(1)
          }`,
      },
      annotations: annotations,
    }),
    data: () =>
      CTFd.fetch("/api/v1/statistics/scores/distribution").then(
        function (response) {
          return response.json();
        }
      ),
    format: (response) => {
      const data = response.data.brackets;
      const keys = [];
      const brackets = [];
      const sizes = [];

      for (let key in data) {
        keys.push(parseInt(key));
      }
      keys.sort((a, b) => a - b);

      let start = "<0";
      keys.map((key) => {
        brackets.push(`${start} - ${key}`);
        sizes.push(data[key]);
        start = key;
      });

      const option = {
        title: {
          left: "center",
          text: "Score Distribution",
          textStyle: {
            fontFamily: "Space Mono",
            color: "#ff5500",
          },
        },
        tooltip: {
          trigger: "item",
          textStyle: {
            fontFamily: "Space Mono",
          },
        },
        toolbox: {
          show: true,
          feature: {
            mark: { show: true },
            dataView: { show: true, readOnly: false },
            magicType: { show: true, type: ["line", "bar"] },
            restore: { show: true },
            saveAsImage: { show: true },
          },
          emphasis: {
            iconStyle: {
              borderColor: "#ff5500",
            },
          },
        },
        xAxis: {
          name: "Score Bracket",
          nameGap: 40,
          nameLocation: "middle",
          type: "category",
          data: brackets,
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
          axisLabel: {
            fontFamily: "Space Mono",
            interval: 0,
            rotate: 0,
          },
        },
        yAxis: {
          name: `Number of ${CTFd.config.userMode.charAt(0).toUpperCase() +
            CTFd.config.userMode.slice(1)
            }`,
          nameGap: 50,
          nameLocation: "middle",
          type: "value",
          nameTextStyle: {
            fontFamily: "Space Mono",
          },
          axisLabel: {
            fontFamily: "Space Mono",
            interval: 0,
            rotate: 0,
          },
        },
        dataZoom: [
          {
            show: false,
            start: 0,
            end: 100,
          },
          {
            type: "inside",
            show: true,
            start: 0,
            end: 100,
          },
          {
            fillerColor: "rgba(233, 236, 241, 0.4)",
            show: true,
            right: 60,
            yAxisIndex: 0,
            width: 20,
          },
          {
            type: "slider",
            fillerColor: "rgba(233, 236, 241, 0.4)",
            top: 35,
            height: 20,
            show: true,
            start: 0,
            end: 100,
          },
        ],
        series: [
          {
            itemStyle: { normal: { color: "#ff5500" } },
            data: sizes,
            type: "bar",
          },
        ],
      };

      return option;
    },
  },
};

const createGraphs = () => {
  for (let key in graph_configs) {
    const cfg = graph_configs[key];

    const $elem = $(key);
    $elem.empty();

    let chart = echarts.init(document.querySelector(key));

    cfg
      .data()
      .then(cfg.format)
      .then((option) => {
        chart.setOption(option);
        $(window).on("resize", function () {
          if (chart != null && chart != undefined) {
            chart.resize();
          }
        });
      });
  }
};

function updateGraphs() {
  for (let key in graph_configs) {
    const cfg = graph_configs[key];
    let chart = echarts.init(document.querySelector(key));
    cfg
      .data()
      .then(cfg.format)
      .then((option) => {
        chart.setOption(option);
      });
  }
}

$(() => {
  createGraphs();
  renderChallengeAnalytics();
  const exportBtn = document.getElementById("challenge-analytics-export");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportChallengeAnalytics);
  }
  setInterval(() => {
    updateGraphs();
    renderChallengeAnalytics(true);
  }, 300000);
});
