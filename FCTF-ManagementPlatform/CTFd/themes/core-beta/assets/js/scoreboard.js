import Alpine from "alpinejs";
import CTFd from "./index";
import { embed } from "./utils/graphs/echarts";
import { getOption } from "./utils/graphs/echarts/scoreboard";

window.Alpine = Alpine;
window.CTFd = CTFd;

Alpine.data("ScoreboardDetail", () => ({
  data: {},
  show: true,

  async init() {
    this.data = await CTFd.pages.scoreboard.getScoreboardDetail(10);

    let option = getOption(CTFd.config.userMode, this.data);
    embed(this.$refs.scoregraph, option);
    this.show = Object.keys(this.data).length > 0;
  },
}));

Alpine.data("ScoreboardList", () => ({
  standings: [],
  brackets: [],
  activeBracket: null,
  fastestSubmissions: [],

  async init() {
    let response = await CTFd.fetch(`/api/v1/brackets?type=${CTFd.config.userMode}`, {
      method: "GET",
    });
    const body = await response.json();
    this.brackets = body["data"];
    this.standings = await CTFd.pages.scoreboard.getScoreboard();
    console.log("Fetched standings:", this.standings); // Debugging line

    
    let fastestResponse = await CTFd.fetch(`/api/v1/scoreboard/fastest_submissions/5`, {
      method: "GET",
    });
    const fastestBody = await fastestResponse.json();
    this.fastestSubmissions = fastestBody["data"].filter(submission => submission !== null);
    console.log("Fetched fastest submissions:", this.fastestSubmissions);
    console.log("Fastest submissions length:", this.fastestSubmissions.length);

    if (this.fastestSubmissions.length === 0) {
      console.warn("No fastest submissions found."); // Debugging line
    } else {
      console.log("Fastest submissions loaded successfully."); // Debugging line
    }
  },
}));

Alpine.start();
