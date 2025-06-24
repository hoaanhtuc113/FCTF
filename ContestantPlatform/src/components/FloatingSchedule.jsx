import { useEffect, useState } from "react";
import { FiClock, FiCalendar } from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";
import { API_GET_DATE_CONFIG, BASE_URL } from "../constants/ApiConstant";
import ApiHelper from "../utils/ApiHelper";

const FloatingSchedule = () => {
  const [visible, setVisible] = useState(true);
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [statusMessage, setStatusMessage] = useState("Loading...");
  const [targetDate, setTargetDate] = useState(null);

  const toggleVisible = () => setVisible((prev) => !prev);

  useEffect(() => {
    const fetchDate = async () => {
      const api = new ApiHelper(BASE_URL);
      try {
        const res = await api.get(API_GET_DATE_CONFIG);
        if (res.isSuccess) {
          const { start_date, end_date, message } = res;
          const start = new Date(start_date * 1000);
          const end = new Date(end_date * 1000);
          const now = new Date();

          if (message === "CTFd has not been started" && now < start) {
            setStatusMessage("🚀 Contest starts in:");
            setTargetDate(start);
          } else if (message === "CTFd has been started" && now < end) {
            setStatusMessage("⏳ Contest ends in:");
            setTargetDate(end);
          } else {
            setStatusMessage("🏁 Contest has ended");
            setTargetDate(null);
          }
        } else {
          setStatusMessage("⚠️ Error loading schedule");
        }
      } catch {
        setStatusMessage("❌ Server error");
      }
    };

    fetchDate();
  }, []);

  useEffect(() => {
    if (!targetDate) return;
    const timer = setInterval(() => {
      const now = new Date();
      const diff = targetDate - now;
      if (diff <= 0) {
        clearInterval(timer);
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft({ days, hours, minutes, seconds });
    }, 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  const timeBox = (value, label) => (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center bg-gradient-to-br from-orange-400 to-yellow-300 text-white shadow-xl rounded-xl w-20 h-20 m-1"
    >
      <span className="text-xl font-bold">{String(value).padStart(2, "0")}</span>
      <span className="text-xs uppercase">{label}</span>
    </motion.div>
  );

  return (
    <div className="fixed bottom-6 right-6 z-[1000]">
      <div className="relative">
        <motion.button
          onClick={toggleVisible}
          whileHover={{ scale: 1.1, rotate: 5 }}
          whileTap={{ scale: 0.95 }}
          className="w-16 h-16 bg-gradient-to-tr from-orange-500 to-red-500 text-white rounded-full shadow-2xl flex items-center justify-center text-3xl animate-pulse"
          aria-label="Toggle Schedule"
        >
          <FiCalendar />
        </motion.button>

        <AnimatePresence>
          {visible && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: -10 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.3 }}
              className="absolute bottom-full right-0 mb-4 w-72 p-4 bg-white dark:bg-gray-800 border border-orange-300 dark:border-gray-700 rounded-xl shadow-2xl"
            >
              <div className="text-center text-sm font-semibold text-orange-600 dark:text-orange-300 mb-2">
                {statusMessage}
              </div>
              <div className="flex justify-between">
                {timeBox(timeLeft.days, "Days")}
                {timeBox(timeLeft.hours, "Hours")}
                {timeBox(timeLeft.minutes, "Minutes")}
                {timeBox(timeLeft.seconds, "Seconds")}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default FloatingSchedule;
