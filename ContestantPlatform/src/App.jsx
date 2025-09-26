import { Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { useEffect, useState, createContext } from "react";
import { io } from "socket.io-client";
import Swal from "sweetalert2";

import "./App.css";
import { BASE_URL,API_GET_ACTION_LOGS } from "./constants/ApiConstant";
import ApiHelper from "./utils/ApiHelper";
import { ACCESS_TOKEN_KEY } from "./constants/LocalStorageKey";

import Template from "./components/Template";
import HomePage from "./components/home/HomePage";
import LoginComponent from "./components/auth/LoginComponent";
import RegistrationForm from "./components/auth/RegisterComponent";
import TeamComponent from "./components/auth/TeamConfirm";
import CreateTeamComponent from "./components/team/CreateNewTeam";
import JoinTeamComponent from "./components/team/JoinTeam";
import ChallengeTopics from "./components/challenges/ChallengeTopics";
import ChallengeList from "./components/challenges/ChallengeList";
import ChallengeDetail from "./components/challenges/ChallengeDetail";
import Scoreboard from "./components/scoreboard/Scoreboard";
import TicketList from "./components/ticket/TicketListPage";
import TicketDetailPage from "./components/ticket/TicketDetailPage";
import UserProfile from "./components/user/UserProfile";
import ActionLogs from "./components/action_logs/ActionLogComponent";
import ReplayPage from "./components/action_logs/ReplayActions";
import LockScreen from "./template/Forbidden";
import { UserProvider } from './components/contexts/UserContext';
import PublicScoreboard from "./components/scoreboard/PublicScoreboard";

export const ActionLogsContext = createContext();

function App() {
  const [actionLogs, setActionLogs] = useState([]);

  useEffect(() => {
    let socket;

    const fetchInitialLogs = async () => {
      const api = new ApiHelper(BASE_URL);
      try {
        const response = await api.get(API_GET_ACTION_LOGS);
        if (response.success) {
          setActionLogs(response.data);
        } else {
          console.error("Failed to fetch initial logs:", response.error);
        }
      } catch (error) {
        console.error("Error fetching initial logs:", error);
      }
    };

    const initializeSocket = () => {
      try {
        socket = io(BASE_URL, {
          auth: {
            token: localStorage.getItem(ACCESS_TOKEN_KEY),
          },
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 2000,
        });

        // socket.on("connect", () => {
        //   console.log("Connected to server with socket ID:", socket.id);
        // });

        // socket.on("disconnect", (reason) => {
        //   if (reason === "io server disconnect") {
        //     socket.connect();
        //   }
        // });

        // socket.on("connect_error", (error) => {
        //   console.error("Socket connection error:", error);
        // });

        // socket.on("action_logs", (data) => {
        //   if (data.type === "action_logs" && data.logs) {
        //     setActionLogs(data.logs);
        //   }
        // });

        // socket.on("notify", (data) => {
        //   if (data.notif_type === "alert") {
        //     Swal.fire({
        //       title: "Thông báo từ ban quản trị </br>" + data.notif_title,
        //       text: data.notif_message,
        //       icon: "info",
        //       confirmButtonText: "OK",
        //       timer: 10000,
        //       timerProgressBar: true,
        //     });
        //   } else if (data.notif_type === "toast") {
        //     Swal.fire({
        //       toast: true,
        //       position: "top-end",
        //       icon: "info",
        //       title: "Thông báo từ ban quản trị</br>" + data.notif_title || "Thông báo!",
        //       text: data.notif_message || "Bạn có một thông báo quan trọng.",
        //       showConfirmButton: false,
        //       timer: 10000,
        //       timerProgressBar: true,
        //       showCloseButton: true,
        //     });
        //   }
        // });

        // socket.on("user-login-notification", (userData) => {
        //   Swal.fire({
        //     title: "Thí sinh mới đăng nhập",
        //     html: `
        //         <div>
        //           <p><strong>Tên:</strong> ${userData.name}</p>
        //           ${userData.team ? `<p><strong>Team:</strong> ${userData.team}</p>` : ""}
        //           <p><small>${userData.time} - ${userData.date}</small></p>
        //         </div>
        //       `,
        //     icon: "info",
        //     timer: 5000,
        //     toast: true,
        //     position: "top-end",
        //     showConfirmButton: false,
        //   });
        //   console.log("User login notification received:", userData);
        // });

        // socket.on("all-characters", (userData) => {
        //   if (localStorage) {
        //     localStorage.setItem("charactersOnMap", JSON.stringify(userData.characters));
        //   } else {
        //     console.warn("localStorage is not available.");
        //   }
        //   console.log("All characters on map:", userData.characters);
        // });
      } catch (error) {
        console.error("Failed to initialize socket connection:", error);
      }
    };

    fetchInitialLogs();
    initializeSocket();

    return () => {
      if (socket) {
        socket.off("action_logs");
        socket.off("notify");
        socket.off("all-characters");
        socket.off("user-login-notification");
        socket.disconnect();
      }
    };
  }, []);

  return (
    <Router future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        {/* <Route path="/replay" element={<ReplayPage />} /> */}

        <Route
          path="/*"
          element={
            <UserProvider>
              <Routes>
                <Route path="/public/rankings" element={<PublicScoreboard />} />
                {/* Home */}
                <Route path="/" element={<Template><HomePage /></Template>} />

                {/* Authentication */}
                <Route path="/login" element={<LoginComponent />} />
                {/* <Route path="/register" element={<RegistrationForm />} /> */}

                {/* Team */}
                <Route path="/team-confirm" element={<TeamComponent />} />
                <Route path="/team-create" element={<CreateTeamComponent />} />
                <Route path="/team-join" element={<JoinTeamComponent />} />

                {/* Ranking and Topic */}
                <Route path="/rankings" element={<Template title="Rankings"><Scoreboard /></Template>} />
                <Route path="/topics" element={<Template title="Topics"><ChallengeTopics /></Template>} />
                <Route path="/topic/:categoryName" element={<Template><ChallengeList /></Template>} />

                {/* Challenges and Ticket */}
                <Route path="/challenge/:id" element={<Template><ChallengeDetail /></Template>} />
                <Route path="/tickets" element={<Template title="Tickets"><TicketList /></Template>} />
                <Route path="/ticket/:id" element={<Template><TicketDetailPage /></Template>} />

                {/* Profile */}
                <Route path="/profile" element={<Template title="Profile"><UserProfile /></Template>} />

                {/* Logs */}
                {/* <Route path="/actions_logs" element={<Template title="Preview"><ActionLogs /></Template>} /> */}

                {/* Prohibited */}
                <Route path="/forbidden" element={<Template><LockScreen /></Template>} />
              </Routes>
            </UserProvider>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;