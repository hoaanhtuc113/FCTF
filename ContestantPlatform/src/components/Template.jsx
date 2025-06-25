import { format } from "date-fns";
import { useEffect, useState, useContext } from "react";
import { FaBell, FaFlag, FaSignOutAlt, FaUser } from "react-icons/fa";
import { FaRankingStar } from "react-icons/fa6";
import { IoTicket } from "react-icons/io5";
import { useNavigate, useLocation } from "react-router-dom";
import { API_GET_NOTIFICATION, BASE_URL, API_USER_PROFILE } from "../constants/ApiConstant";
import { ACCESS_TOKEN_KEY } from "../constants/LocalStorageKey";
import ApiHelper from "../utils/ApiHelper";
import CornerBorderBox from "../components/ConnerBorderBox";
import { useParams } from "react-router-dom";
import ActionLogs from "../components/action_logs/ActionLogComponent";
import { ActionLogsContext } from "../App";
import PixiMap from "../components/map/PixiMap";
import { useUser } from '../components/contexts/UserContext';
import { io } from "socket.io-client";
import { useRef } from "react";
import FloatingSchedule from "./FloatingSchedule";
const Template = ({ children, title }) => {
  const { logout } = useUser();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [userInfo, setUserInfo] = useState({});
  const [isFetchingNotifications, setIsFetchingNotifications] = useState(false);
  const itemsPerPage = 3;
  const { categoryName } = useParams();
  const navigate = useNavigate();
  const activityLogs = useContext(ActionLogsContext);
  const location = useLocation();

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentNotifications = notifications.slice(
    indexOfFirstItem,
    indexOfLastItem
  );
  const totalPages = Math.ceil(notifications.length / itemsPerPage);

  const handleNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const markAsRead = (id) => {
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.id === id
          ? { ...notification, isRead: true }
          : notification
      )
    );
  };

  const fetchUserInfo = async () => {
    const api = new ApiHelper(BASE_URL);
    try {
      const response = await api.get(`${API_USER_PROFILE}`);
      console.log("user fetched:", response);
      if (response.data) {
        setUserInfo(response.data);
      } else {
        console.error("Failed to fetch user info:", response.error || "Unknown error");
      }
    } catch (error) {
      console.error("Error fetching UserInfo:", error);
    }
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const updateUnreadCount = () => {
    setUnreadCount(
      notifications.filter((notification) => !notification.isRead).length
    );
  };
  const notificationRef = useRef();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        notificationRef.current &&
        !notificationRef.current.contains(event.target)
      ) {
        setIsNotificationOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);
  useEffect(() => {
    updateUnreadCount();
  }, [notifications]);

  useEffect(() => {
    const fetchNotifications = async () => {
      const api = new ApiHelper(BASE_URL);
      try {
        const response = await api.get(API_GET_NOTIFICATION);
        if (response.success) {
          const sortedNotifications = response.data
            .map((notification) => ({
              ...notification,
              isRead: false,
            }))
            .sort((a, b) => new Date(b.date) - new Date(a.date));
          setNotifications(sortedNotifications);
        } else {
          console.error("Error fetching notifications");
        }
      } catch (error) {
        console.error("Error fetching notifications:", error);
      }
    };

    fetchNotifications();
  }, []);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const formatToCustomDateTime = (isoString) => {
    return format(new Date(isoString), "dd/MM/yyyy HH:mm");
  };

  const handleLogout = () => {
    console.log("Logout button clicked");
    if (typeof logout === "function") {
      logout();
      try {
        navigate("/login");
      } catch (error) {
        console.error("Navigation failed:", error);
      }
    } else {
      console.error("Logout function is not defined.");
    }
  };

  useEffect(() => {
    if (!localStorage.getItem(ACCESS_TOKEN_KEY)) {
      navigate("/login");
    } else {
      fetchUserInfo(); // Fetch user info immediately after login check
    }
  }, [navigate]);

  const handleLogoClick = () => {
    navigate("/");
  };

  useEffect(() => {
    const socket = io(BASE_URL, {
      auth: {
        token: localStorage.getItem(ACCESS_TOKEN_KEY),
      },
    });

    socket.on("connect", () => {
      console.log("Connected to server");
    });

    socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const menuItems = [
    { title: "Challenges", icon: <FaFlag />, url: "/topics" },
    { title: "Score Board", icon: <FaRankingStar />, url: "/rankings" },
    { title: "Ticket", icon: <IoTicket />, url: "/tickets" },
    { title: "Profile", icon: <FaUser />, url: "/profile" },
    {
      title:(
        <div className="relative">
          <span >Notifications</span>
          {unreadCount > 0 && (
            <span className="absolute top-0 -right-4 text-xs bg-red-500 text-white rounded-full px-1">
              {unreadCount}
            </span>
          )}
        </div>
      ),
      icon: "noti",
      onClick: () => setIsNotificationOpen(!isNotificationOpen),
    },
   
    // { title: "Logout", icon: <FaSignOutAlt />, onClick: () => handleLogout() },
  ];

  return (
    <div className="bg-gray-900 min-h-screen font-primary p-5">
      <header className="fixed top-0 left-0 w-full z-50 bg-gray-900 ">
    <div className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8">
      <div className="flex h-16 items-center justify-between">
        {/* Left: Logo */}
        <div className="flex items-center flex-shrink-0" style={{ minWidth: '160px' }}>
          <div className="cursor-pointer" onClick={handleLogoClick}>
            <img className="h-10 w-auto theme-color-primary" src="/fctf-logo.png" alt="Logo" onError={(e) => {
              e.target.onerror = null; e.target.src = "/fctf-logo.png";
            }} />
          </div>
        </div>

        {/* Center: Menu Items */}
        <div className="flex-1 flex justify-center items-center gap-2">
          {menuItems.map((item, index) => (
            <div key={index} className="relative">
              <button
                onClick={() => {
                  if (item.onClick) {
                    item.onClick();
                  } else {
                    navigate(item.url);
                  }
                }}
                className={`flex items-center px-4 py-2 text-lg rounded-md font-medium transition-all duration-300
                  ${location.pathname === `${item.url}` ? 'text-[#e45c25] bg-primary-low' : 'text-gray-200 hover:text-theme-color-primary-dark hover:bg-primary-low'}`}
                style={{ minWidth: '120px', justifyContent: 'center' }}
              >
                <span className="mr-2 text-xl">{item.icon !== 'noti' && item.icon}</span>
                <span>{item.title}</span>
              </button>
              {/* Notification Dropdown */}
              {item.icon === "noti" && isNotificationOpen && (
                <div
                  className="absolute -right-100 mt-2 w-80 bg-gray-800 rounded-md shadow-xl py-2 z-50 max-h-96 overflow-y-auto flex flex-col"
                  ref={notificationRef}
                  onScroll={async (e) => {
                    const { scrollTop, scrollHeight, clientHeight } = e.target;
                    if (scrollTop + clientHeight >= scrollHeight - 10 && !isFetchingNotifications && currentPage < totalPages) {
                      setIsFetchingNotifications(true);
                      await handleNextPage();
                      setIsFetchingNotifications(false);
                    }
                  }}
                  style={{ scrollbarWidth: 'thin' }}
                >
                  {currentNotifications.length > 0 ? (
                    currentNotifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`px-4 py-3 cursor-pointer transition-all duration-300 ${notification.isRead ? "bg-gray-600" : "hover:bg-gray-700"}`}
                        onClick={() => markAsRead(notification.id)}
                      >
                        <div className="flex justify-between items-start">
                          <p className="text-sm font-medium text-white group-hover:text-white">
                            {notification.title}
                          </p>
                          <span className="text-xs text-gray-300 group-hover:text-white">
                            {formatToCustomDateTime(notification.date)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-300 mt-1 group-hover:text-white">
                          {notification.content}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-gray-300 text-sm">
                      No notifications available
                    </div>
                  )}
                  {isFetchingNotifications && (
                    <div className="flex justify-center items-center py-4">
                      <svg className="animate-spin h-6 w-6 text-orange-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                      </svg>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700">
                    <button
                      onClick={handlePreviousPage}
                      disabled={currentPage === 1}
                      className="text-sm text-theme-color-primary hover:text-theme-color-primary-dark disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-gray-300">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={handleNextPage}
                      disabled={currentPage === totalPages}
                      className="text-sm text-theme-color-primary hover:text-theme-color-primary-dark disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right: User Info & Logout */}
        <div className="flex items-center gap-4 min-w-[120px] justify-end">
          <div className="flex flex-col items-end mr-2">
            <span className="text-sm font-semibold text-white">
              {userInfo.username || "Username"}
            </span>
            <span className="text-xs text-gray-300">
              {userInfo.team || "No team"}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-theme-color-gray hover:text-theme-color-primary-dark hover:bg-primary-low transition-all duration-300"
          >
            <span className="mr-2 text-2xl"><FaSignOutAlt /></span>
          </button>
        </div>
      </div>
    </div>
  </header>
      <main
        className="font-primary rounded-lg  flex-grow  pt-16"
        style={{ flex: 3 }}
      >
        {/* <CornerBorderBox>
          <h1 className="text-2xl font-bold italic flex flex-wrap justify-center items-center h-auto text-center uppercase text-primary">
            {title || categoryName || "Home Page"}
          </h1>
        </CornerBorderBox> */}
        <div className="bg-transparent font-primary italic w-full mx-auto text-primary flex-grow px-5">
          {location.pathname === "/actions_logs" ? <PixiMap /> : children}
        </div>
        <FloatingSchedule />
      </main>
    </div>
  );
};

export default Template;
