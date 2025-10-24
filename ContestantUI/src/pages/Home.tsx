import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiCalendar, FiClock } from 'react-icons/fi';
import { configService } from '../services/configService';
import { Box, Typography, CircularProgress } from '@mui/material';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function Home() {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [statusMessage, setStatusMessage] = useState('Loading contest details...');
  const [isContestActive, setIsContestActive] = useState(false);
  const [isComing, setIsComing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDateConfig = async () => {
      try {
        const config = await configService.getDateConfig();
        
        if (!config) {
          setStatusMessage('Error fetching contest details.');
          setLoading(false);
          return;
        }

        const { message, start_date, end_date } = config;

        if (message === 'CTFd has not been started' && start_date) {
          const startDate = new Date(start_date * 1000);
          if (new Date() < startDate) {
            setStatusMessage('CONTEST IS COMING...');
            setIsComing(true);
            setIsContestActive(false);
            startCountdown(startDate);
          }
        } else if (message === 'CTFd has been started' && end_date) {
          const endDate = new Date(end_date * 1000);
          if (new Date() < endDate) {
            setIsContestActive(true);
            setStatusMessage('CONTEST WILL END IN');
            startCountdown(endDate);
          }
        } else {
          setStatusMessage('THE CONTEST HAS ENDED');
        }
        
        setLoading(false);
      } catch (error) {
        setStatusMessage('Error connecting to the server.');
        console.error('Fetch error:', error);
        setLoading(false);
      }
    };

    fetchDateConfig();
  }, []);

  const startCountdown = (targetDate: Date) => {
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const difference = targetDate.getTime() - now;

      if (difference <= 0) {
        clearInterval(timer);
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        setStatusMessage('The event has started!');
        setIsContestActive(true);
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setTimeLeft({ days, hours, minutes, seconds });
    }, 1000);

    return () => clearInterval(timer);
  };

  const TimeUnit = ({ value, label, icon }: { value: number; label: string; icon: JSX.Element }) => (
    <motion.div
      className="flex flex-col items-center p-6 bg-white rounded-2xl shadow-lg m-2 min-w-[140px] border border-gray-200 hover:shadow-xl transition-shadow duration-300"
      whileHover={{ scale: 1.05 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="text-orange-500 text-4xl mb-3">
        {icon}
      </div>
      <span
        className="text-5xl font-bold text-gray-800 mb-2 tabular-nums"
        aria-label={`${value} ${label}`}
      >
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-gray-600 text-sm uppercase font-semibold tracking-wide">
        {label}
      </span>
    </motion.div>
  );

  if (loading) {
    return (
      <Box className="flex items-center justify-center min-h-[60vh]">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <CircularProgress sx={{ color: '#ff6f00' }} />
        </motion.div>
      </Box>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-12"
      >
        <h1 className="text-5xl md:text-7xl font-bold bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent mb-4">
          {statusMessage}
        </h1>
        <Typography className="text-gray-600 text-lg md:text-xl font-medium">
          {isContestActive
            ? 'The competition is live! Good luck! 🚀'
            : isComing
            ? 'Get ready for an amazing CTF experience! 🔥'
            : 'Thank you for participating! 🎉'}
        </Typography>
      </motion.div>

      {(isContestActive || isComing) && (
        <div 
          className="flex flex-wrap justify-center items-center gap-4"
          role="timer"
          aria-label="Contest countdown timer"
        >
          <TimeUnit value={timeLeft.days} label="Days" icon={<FiCalendar />} />
          <TimeUnit value={timeLeft.hours} label="Hours" icon={<FiClock />} />
          <TimeUnit value={timeLeft.minutes} label="Minutes" icon={<FiClock />} />
          <TimeUnit value={timeLeft.seconds} label="Seconds" icon={<FiClock />} />
        </div>
      )}

      {!isContestActive && !isComing && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="mt-8 text-center"
        >
          <Typography className="text-gray-600 text-lg">
            Check the scoreboard to see final standings! 🏆
          </Typography>
        </motion.div>
      )}

      {isComing && (
        <motion.button
          className="mt-12 px-8 py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-full font-bold text-lg shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-opacity-50 transition-all duration-300"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Register for the contest"
        >
          Register Now
        </motion.button>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="mt-8 text-gray-600 text-center"
      >
        <p className="mb-2">Don't miss out on this opportunity!</p>
        <p>Mark your calendar and set your reminders.</p>
      </motion.div>
    </div>
  );
}