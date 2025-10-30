import { motion } from 'framer-motion';
import { CheckCircle, Lock } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

interface Challenge {
  id: number;
  name: string;
  value: number;
  solve_by_myteam: boolean;
  solves: number;
}

interface ChallengeCardProps {
  challenge: Challenge;
  isContestActive: boolean;
}

export function ChallengeCard({ challenge, isContestActive }: ChallengeCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (isContestActive) {
      navigate(`/challenge/${challenge.id}`);
    }
  };

  return (
    <motion.div
      className={`relative p-4 rounded-xl border-2 transition-all duration-200 ${
        !isContestActive
          ? 'bg-gray-100 border-gray-300 opacity-60 cursor-not-allowed'
          : challenge.solve_by_myteam
          ? 'bg-green-50 border-green-500 cursor-pointer hover:shadow-lg hover:border-green-600'
          : 'bg-white border-gray-300 cursor-pointer hover:shadow-lg hover:border-orange-500'
      }`}
      whileHover={isContestActive ? { scale: 1.02, y: -2 } : {}}
      onClick={handleClick}
    >
      {/* Status Badge */}
      <div className="absolute top-3 right-3">
        {challenge.solve_by_myteam ? (
          <CheckCircle className="text-green-600" fontSize="small" />
        ) : !isContestActive ? (
          <Lock className="text-gray-400" fontSize="small" />
        ) : null}
      </div>

      {/* Challenge Info */}
      <div className="pr-8">
        <h3
          className={`text-lg font-bold mb-2 ${
            challenge.solve_by_myteam
              ? 'text-green-700'
              : isContestActive
              ? 'text-gray-800'
              : 'text-gray-500'
          }`}
        >
          {challenge.name}
        </h3>

        <div className="flex items-center gap-4 text-sm">
          <span
            className={`font-semibold ${
              challenge.solve_by_myteam
                ? 'text-green-600'
                : isContestActive
                ? 'text-orange-600'
                : 'text-gray-400'
            }`}
          >
            {challenge.value} pts
          </span>
          <span className="text-gray-500">{challenge.solves || 0} solves</span>
        </div>
      </div>
    </motion.div>
  );
}