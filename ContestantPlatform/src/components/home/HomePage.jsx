import { motion } from "framer-motion";
import React, { useEffect, useState } from "react";
import { FiCalendar, FiClock } from "react-icons/fi";
import { API_GET_DATE_CONFIG, BASE_URL } from "../../constants/ApiConstant";
import ApiHelper from "../../utils/ApiHelper";

const HomePage = () => {
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  const [statusMessage, setStatusMessage] = useState(
    "Loading contest details..."
  );
  const [isContestActive, setIsContestActive] = useState(false);
  const [IsComing, setIsComming] = useState(false);

  useEffect(() => {
    const fetchDateConfig = async () => {
      const api = new ApiHelper(BASE_URL);
      try {
        const response = await api.get(`${API_GET_DATE_CONFIG}`);
        if (response.isSuccess) {
          const { message, start_date, end_date } = response;

          if (message === "CTFd has not been started" && start_date) {
            const startDate = new Date(start_date * 1000);
            if (new Date() < startDate) {
              setStatusMessage("CONTEST IS COMING...");
              setIsComming(true);
              setIsContestActive(false);
              startCountdown(startDate);
            }
          } else if (message === "CTFd has been started" && end_date) {
            const endDate = new Date(end_date * 1000);
            if (new Date() < endDate) {
              setIsContestActive(true);
              setStatusMessage("CONTEST WILL BE ENDED IN ");
              startCountdown(endDate);
            }
          } else {
            setStatusMessage("THE CONTEST HAS ENDED");
          }
        } else {
          setStatusMessage("Error fetching contest details.");
        }
      } catch (error) {
        setStatusMessage("Error connecting to the server.");
        console.error("Fetch error:", error);
      }
    };

    fetchDateConfig();
  }, []);

  const startCountdown = (targetDate) => {
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const difference = targetDate - now;

      if (difference <= 0) {
        clearInterval(timer);
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        setStatusMessage("The event has started!");
        setIsContestActive(true);
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
      );
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setTimeLeft({ days, hours, minutes, seconds });
    }, 1000);

    return () => clearInterval(timer);
  };

  const TimeUnit = ({ value, label, icon }) => (
    <div
      className="flex flex-col items-center p-4 bg-white rounded-lg shadow-lg m-2 min-w-[120px] hover:shadow-xl transition-shadow duration-300 ease-in-out"
      whilehover={{ scale: 1.05 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="text-theme-color-primary text-3xl mb-2">{icon}</div>
      <span
        key={value}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-4xl font-bold text-theme-color-primary-dark mb-2"
        aria-label={`${value} ${label}`}
      >
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-theme-color-neutral text-sm uppercase">
        {label}
      </span>
    </div>
  );

  return (
    <div className="bg-gradient-to-br from-base-medium to-neutral-medium flex flex-col items-center justify-center p-4">
      <div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <h1 className="text-4xl md:text-6xl font-bold text-theme-color-secondary-dark mb-4">
          {statusMessage}
        </h1>
        <p className="text-theme-color-secondary text-lg md:text-xl">
          {isContestActive
            ? "Get ready for an amazing experience! "
            : "Check back later for updates."}
        </p>
      </div>

      {!isContestActive && (
        <div
          className="flex flex-wrap justify-center items-center gap-4"
          role="timer"
          aria-label="Contest countdown timer"
        >
          <TimeUnit value={timeLeft.days} label="Days" icon={<FiCalendar />} />
          <TimeUnit value={timeLeft.hours} label="Hours" icon={<FiClock />} />
          <TimeUnit
            value={timeLeft.minutes}
            label="Minutes"
            icon={<FiClock />}
          />
          <TimeUnit
            value={timeLeft.seconds}
            label="Seconds"
            icon={<FiClock />}
          />
        </div>
      )}

      {isContestActive && (
        <div
          className="flex flex-wrap justify-center items-center gap-4"
          role="timer"
          aria-label="Contest countdown timer"
        >
          <TimeUnit value={timeLeft.days} label="Days" icon={<FiCalendar />} />
          <TimeUnit value={timeLeft.hours} label="Hours" icon={<FiClock />} />
          <TimeUnit
            value={timeLeft.minutes}
            label="Minutes"
            icon={<FiClock />}
          />
          <TimeUnit
            value={timeLeft.seconds}
            label="Seconds"
            icon={<FiClock />}
          />
        </div>
      )}

      {IsComing && (
        <motion.button
          className="mt-12 px-8 py-4 bg-theme-color-primary text-white rounded-full font-bold text-lg shadow-lg hover:bg-theme-color-primary-dark focus:outline-none focus:ring-2 focus:ring-theme-color-primary focus:ring-opacity-50 transition-all duration-300"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Register for the contest"
        >
          Register Now
        </motion.button>
      )}

      <div className="mt-8 text-theme-color-secondary text-center">
        <p>Don't miss out on this opportunity!</p>
        <p className="mt-2">Mark your calendar and set your reminders.</p>
      </div>
    </div>
  );
};

export default HomePage;
