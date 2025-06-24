import { format } from "date-fns";
import { useEffect, useState, useContext } from "react";
import { FaBell, FaFlag, FaSignOutAlt, FaUser } from "react-icons/fa";
import { FaRankingStar } from "react-icons/fa6";
import { IoTicket } from "react-icons/io5";
import { useNavigate, useLocation } from "react-router-dom";
import { API_GET_NOTIFICATION, BASE_URL } from "../constants/ApiConstant";
import { ACCESS_TOKEN_KEY } from "../constants/LocalStorageKey";
import ApiHelper from "../utils/ApiHelper";
import CornerBorderBox from "../components/ConnerBorderBox";
import { useParams } from "react-router-dom";
import ActionLogs from "../components/action_logs/ActionLogComponent";
import { ActionLogsContext } from "../App";
import PixiMap from "../components/map/PixiMap";
import { useUser } from '../components/contexts/UserContext';
import { io } from "socket.io-client";

const Template = ({ children, title }) => {
  const { logout } = useUser();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
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

  const clearNotifications = () => {
    setNotifications([]);
  };

  const updateUnreadCount = () => {
    setUnreadCount(
      notifications.filter((notification) => !notification.isRead).length
    );
  };

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
    { title: "Activity", icon: <FaFlag />, url: "/actions_logs" },
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
    <div className="bg-white dark:bg-gray-900 h-screen  font-primary p-5">
      {/* <div className="bg-secondary h-screen flex-shrink-0" style={{ flex: 1 }}>
        <div className="h-screen max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center h-16">
            <div className="flex-shrink-0 w-full" onClick={handleLogoClick}>
              <img className="h-20 w-auto theme-color-primary" src="/fctf-logo.png" alt="Logo" onError={(e) => {
                e.target.onerror = null; e.target.src = "/fctf-logo.png";
              }}
              />
            </div>
          </div>
          <div className="flex flex-col flex-grow mt-5 flex-shrink-0" style={{ flex: 1 }} >
            <CornerBorderBox>
              <div className="relative mt-3 p-3 flex flex-wrap items-center justify-center max-w-7xl mx-auto" style={{ flex: 1 }}>
                {menuItems.map((item, index) => (
                  <div key={index} className="relative">
                    <button onClick={() => {
                      if (item.onClick) {
                        item.onClick();
                      } else {
                        navigate(item.url);
                      }
                    }}
                      className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-theme-color-gray hover:text-theme-color-primary-dark hover:bg-primary-low transition-all duration-300"
                    >
                      <span className="mr-2 text-3xl">{item.icon}</span>
                    </button>

                    {item.title === "Notifications" && isNotificationOpen && (
                      <div className=" right-0 mt-2 w-80 bg-white rounded-md shadow-lg py-1 z-50">
                        {currentNotifications.length > 0 ? (
                          currentNotifications.map((notification) => (
                            <div
                              key={notification.id}
                              className={`px-4 py-3 cursor-pointer transition-all duration-300 ${notification.isRead
                                ? "bg-gray-100"
                                : "hover:bg-gray-50"
                                }`}
                              onClick={() => markAsRead(notification.id)}
                            >
                              <div className="flex justify-between items-start">
                                <p className="text-sm font-medium text-gray-900">
                                  {notification.title}
                                </p>
                                <span className="text-xs text-gray-500">
                                  {formatToCustomDateTime(notification.date)}
                                </span>
                              </div>
                              <p className="text-xs text-gray-600 mt-1">
                                {notification.content}
                              </p>
                            </div>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-gray-500 text-sm">
                            No notifications available
                          </div>
                        )}
                        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200">
                          <button
                            onClick={handlePreviousPage}
                            disabled={currentPage === 1}
                            className="text-sm text-theme-color-primary hover:text-theme-color-primary-dark disabled:opacity-50"
                          >
                            Previous
                          </button>
                          <span className="text-xs text-gray-500">
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
            </CornerBorderBox>
            <CornerBorderBox>
              <div
                className="overflow-y-auto w-full justify-center italic text-white"
                style={{ height: "60vh" }}
              >
                <h1 className="text-2xl italic font-bold text-white text-center mt-4">
                  Activity
                </h1>
                <ActionLogs logs={activityLogs} />
              </div>
            </CornerBorderBox>

            <div className="md:hidden">
              <button
                onClick={toggleMenu}
                className="inline-flex items-center justify-center p-2 rounded-md text-theme-color-primary hover:text-theme-color-primary-dark"
              >
                <svg
                  className={`h-6 w-6 ${isMenuOpen ? "hidden" : "block"}`}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
                <svg
                  className={`h-6 w-6 ${isMenuOpen ? "block" : "hidden"}`}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div> */}
      <header className="fixed top-0 left-0 w-full z-50 bg-white dark:bg-gray-900 ">
        <div className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="md:flex md:items-center md:gap-12">
              <div className="flex-shrink-0 w-full" onClick={handleLogoClick}>
                <img className="h-10 w-auto theme-color-primary" src="/fctf-logo.png" alt="Logo" onError={(e) => {
                  e.target.onerror = null; e.target.src = "/fctf-logo.png";
                }}
                />
              </div>
            </div>

            <div className="flex">
               {menuItems.map((item, index) => (
                  <div key={index} className="relative">
                    <button onClick={() => {
                      if (item.onClick) {
                        item.onClick();
                      } else {
                        navigate(item.url);
                      }
                    }}
                      className="flex items-center px-3 py-2 text-xl rounded-md font-medium text-theme-color-gray hover:text-theme-color-primary-dark hover:bg-primary-low transition-all duration-300"
                    >
                        <span
                            className={`${
                              location.pathname === `${item.url}` ? 'text-[#e45c25]' : 'text-gray'
                            }`}
                          >
                            {item.title}
                          </span>

                    </button>

                    {item.icon === "noti" && isNotificationOpen && (
                      <div className="relative">
                        {isNotificationOpen && (
                          <div className="absolute -right-100 mt-2 w-80 dark:bg-gray-800 rounded-md shadow-xl py-2 z-50 max-h-96 overflow-y-auto">
                            {currentNotifications.length > 0 ? (
                              currentNotifications.map((notification) => (
                                <div
                                  key={notification.id}
                                  className={`px-4 py-3 cursor-pointer transition-all duration-300 ${
                                    notification.isRead ? "dark:bg-gray-600" : "hover:dark:bg-gray-700"
                                  }`}
                                  onClick={() => markAsRead(notification.id)}
                                >
                                  <div className="flex justify-between items-start">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-white">
                                      {notification.title}
                                    </p>
                                    <span className="text-xs text-gray-500 group-hover:text-white">
                                      {formatToCustomDateTime(notification.date)}
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-600 mt-1 dark:text-gray-300 group-hover:text-white">
                                    {notification.content}
                                  </p>
                                </div>
                              ))
                            ) : (
                              <div className="px-4 py-3 text-gray-500 text-sm">
                                No notifications available
                              </div>
                            )}
                            <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-700">
                              <button
                                onClick={handlePreviousPage}
                                disabled={currentPage === 1}
                                className="text-sm text-theme-color-primary hover:text-theme-color-primary-dark disabled:opacity-50"
                              >
                                Previous
                              </button>
                              <span className="text-xs text-gray-500 dark:text-gray-300">
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

                    )}
                  </div>
                ))}
            </div>

            <div className="flex items-center gap-4">
                <button onClick={() => {
                      handleLogout()
                    }}
                      className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-theme-color-gray hover:text-theme-color-primary-dark hover:bg-primary-low transition-all duration-300"
                    >
                      <span className="mr-2 text-3xl"><FaSignOutAlt /></span>
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
      </main>
    </div>
  );
};

export default Template;
