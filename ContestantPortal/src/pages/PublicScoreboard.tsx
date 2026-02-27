import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { publicScoreboardService, type TeamScore, ScoreboardVisibilityError } from "../services/publicScoreboardService";

const PublicChartComponent = lazy(() => import("../components/PublicChartComponent"));

export function PublicScoreboard() {
  const [scores, setScores] = useState<Record<string, TeamScore>>({});
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [visibilityError, setVisibilityError] = useState<{ status: number; message: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [contestStart, setContestStart] = useState(new Date());
  const [contestEnd, setContestEnd] = useState(new Date(Date.now() + 12 * 60 * 60 * 1000));
  const [contestName, setContestName] = useState(`FCTF ${new Date().getFullYear()}`);
  const [latestSolver, setLatestSolver] = useState<string | null>(null);

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch scoreboard data
  useEffect(() => {
    const fetchScores = async () => {
      if (!initialLoad) {
        // Don't show loading spinner for subsequent fetches
        setLoading(false);
      }
      try {
        const data = await publicScoreboardService.getPublicScoreboard();
        setScores(data);
        setVisibilityError(null);
      } catch (err: any) {
        if (err instanceof ScoreboardVisibilityError) {
          setVisibilityError({ status: err.status, message: err.message });
        } else {
          console.error('Failed to fetch scoreboard:', err.message);
        }
      } finally {
        if (initialLoad) {
          setLoading(false);
          setInitialLoad(false);
        }
      }
    };

    fetchScores();
    // Refresh every 30 seconds
    const interval = setInterval(fetchScores, 30000);
    return () => clearInterval(interval);
  }, [initialLoad]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const config = await publicScoreboardService.getContestConfig();
        
        // Convert Unix timestamps (seconds) to Date objects
        // Unix timestamp is in seconds, Date expects milliseconds
        setContestStart(new Date(config.start_date * 1000));
        setContestEnd(new Date(config.end_date * 1000));
        setContestName(config.name || `FCTF ${new Date().getFullYear()}`);
        
      } catch (err) {
        console.error('Failed to fetch contest config:', err);
      }
    };

    fetchConfig();
  }, []);

  // Calculate countdown
  const getTimeRemaining = () => {
    const now = currentTime.getTime();
    const start = contestStart.getTime();
    const end = contestEnd.getTime();

    if (now < start) {
      // Contest hasn't started
      const diff = start - now;
      return {
        status: "STARTING IN",
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
        isActive: false,
        isEnded: false
      };
    } else if (now >= start && now < end) {
      // Contest is active
      const diff = end - now;
      return {
        status: "TIME REMAINING",
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
        isActive: true,
        isEnded: false
      };
    } else {
      // Contest has ended
      return {
        status: "CONTEST ENDED",
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        isActive: false,
        isEnded: true
      };
    }
  };

  const timeRemaining = getTimeRemaining();

  // Process scores
  const rankedTeams = useMemo(() => {
    return Object.entries(scores)
      .map(([key, team]) => ({
        ...team,
        top: parseInt(key)
      }))
      .sort((a, b) => a.top - b.top)
      .slice(0, 10); // Top 10
  }, [scores]);

  // Get latest solver - team with most recent solve
  useEffect(() => {
    if (rankedTeams.length > 0) {
      const allSolves = rankedTeams.flatMap(team => 
        team.solves.map(solve => ({
          teamName: team.name,
          date: new Date(solve.date).getTime()
        }))
      );
      
      if (allSolves.length > 0) {
        const latest = allSolves.sort((a, b) => b.date - a.date)[0];
        setLatestSolver(latest.teamName);
      }
    }
  }, [rankedTeams]);

  // Get rank symbol for terminal aesthetic
  const getRankSymbol = (rank: number) => {
    if (rank === 0) return "■"; // Top 1
    if (rank === 1) return "▲"; // Top 2
    if (rank === 2) return "●"; // Top 3
    return "·";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-orange-400 font-mono flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-2xl animate-pulse">[LOADING...]</div>
          <div className="text-sm opacity-60">{'>'} Initializing scoreboard system...</div>
        </div>
      </div>
    );
  }

  if (visibilityError) {
    return (
      <div className="min-h-screen bg-black text-orange-400 font-mono flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-4">
          <div className="text-4xl mb-4">
            {visibilityError.status === 401 ? '[🔒]' : '[✕]'}
          </div>
          <div className="text-2xl font-bold tracking-wider">
            {visibilityError.status === 401 ? 'ACCESS RESTRICTED' : 'SCOREBOARD HIDDEN'}
          </div>
          <div className="border border-orange-400/30 rounded p-4 text-sm text-orange-300">
            <div className="text-orange-600 mb-2">{'>'} scoreboard.status</div>
            <div>{visibilityError.message}</div>
          </div>
          {visibilityError.status === 401 && (
            <a
              href="/login"
              className="inline-block mt-4 px-6 py-2 border border-orange-400 text-orange-400 hover:bg-orange-400 hover:text-black transition-colors text-sm tracking-wider"
            >
              [LOGIN]
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-orange-400 font-mono overflow-hidden relative">
      {/* Simple border lines - minimalist */}
      <div className="fixed inset-0 pointer-events-none border-2 border-orange-400/30" />

      {/* Main content */}
      <div className="relative z-10 container mx-auto px-4 py-4 max-w-[85vw]">
        {/* Terminal prompt - Hackathon style */}
        <div className="mb-6 flex items-center gap-3 text-orange-400">
          <span className="text-sm">{'>'}</span>
          <span className="text-sm font-mono">fctf-{new Date().getFullYear()}</span>
          <span className="text-orange-600">@</span>
          <span className="text-sm font-mono">public-scoreboard</span>
          <span className="text-orange-600 ml-2 animate-pulse">█</span>
        </div>

        {/* Contest Title - Minimal */}
        <div className="text-center mb-8">
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold mb-3 tracking-widest text-orange-400">
            {contestName.split(' ')[0]} <span className="text-orange-600">/</span> {contestName.split(' ')[1] || new Date().getFullYear()}
          </h1>
          <div className="flex items-center justify-center gap-3 text-orange-600">
            <span>━━━</span>
            <span className="text-sm tracking-wider">CAPTURE THE FLAG</span>
            <span>━━━</span>
          </div>
        </div>

        {/* Countdown Timer - Minimal */}
        <div className={`mb-6 border-l-4 pl-4 ${
            timeRemaining.isActive
              ? "border-orange-400"
              : timeRemaining.isEnded
              ? "border-red-500"
              : "border-yellow-500"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`text-sm font-bold ${
                timeRemaining.isActive ? "text-orange-400" :
                timeRemaining.isEnded ? "text-red-500" :
                "text-yellow-500"
              }`}>
                {'>'} {timeRemaining.status}
              </span>
            </div>
            
            {!timeRemaining.isEnded && (
              <div className="flex items-center gap-6">
                {[
                  { label: "DAYS", value: timeRemaining.days },
                  { label: "HRS", value: timeRemaining.hours },
                  { label: "MIN", value: timeRemaining.minutes },
                  { label: "SEC", value: timeRemaining.seconds },
                ].map((item, idx) => (
                  <div key={item.label} className="flex items-center gap-2">
                    {idx > 0 && <span className="text-orange-600">|</span>}
                    <div className="text-center">
                      <div className={`text-3xl md:text-4xl font-bold tabular-nums ${
                        timeRemaining.isActive ? "text-orange-400" : "text-yellow-400"
                      }`}>
                        {String(item.value).padStart(2, "0")}
                      </div>
                      <div className="text-xs text-orange-600 mt-1">
                        {item.label}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {timeRemaining.isEnded && (
              <div className="text-xl text-red-500 font-bold">
                CONTEST ENDED
              </div>
            )}
          </div>
        </div>

        {/* Main Content Grid - Left: Leaderboard + Stats (40%), Right: Chart (60%) */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
          {/* Left Column: Leaderboard + Stats - Takes 2 columns (40%) */}
          <div className="space-y-6 lg:col-span-2 lg:order-1">
            {/* Scoreboard Table */}
            <div className="border border-orange-400 bg-black/40">
              {/* Table Header */}
              <div className="border-b border-orange-400 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-orange-400 text-sm">{'>'}</span>
                    <h2 className="text-xl md:text-2xl font-bold text-orange-400 tracking-wider">LEADERBOARD</h2>
                  </div>
                  <span className="text-xs text-orange-600 font-mono">
                    {currentTime.toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              {/* Table Content */}
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10 bg-black/90 border-b border-orange-400/30">
                    <tr>
                      <th className="p-4 text-left text-xs text-orange-600 font-mono">RANK</th>
                      <th className="p-4 text-left text-xs text-orange-600 font-mono">TEAM</th>
                      <th className="p-4 text-right text-xs text-orange-600 font-mono">POINTS</th>
                      <th className="p-4 text-right text-xs text-orange-600 font-mono">SOLVES</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence mode="popLayout">
                      {rankedTeams.map((team, index) => (
                        <motion.tr
                          key={team.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.02 }}
                          className={`border-b border-orange-400/20 hover:bg-orange-950/30 transition-colors ${
                            index < 3 ? "bg-orange-950/20" : ""
                          }`}
                        >
                          {/* Rank */}
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <span className={`text-2xl font-mono ${
                                index === 0 ? "text-yellow-400" :
                                index === 1 ? "text-gray-300" :
                                index === 2 ? "text-orange-400" :
                                "text-orange-400"
                              }`}>
                                {getRankSymbol(index)}
                              </span>
                              <span className={`text-lg font-bold font-mono ${
                                index === 0 ? "text-yellow-400" :
                                index === 1 ? "text-gray-300" :
                                index === 2 ? "text-orange-400" :
                                "text-orange-400"
                              }`}>
                                {String(team.top + 1).padStart(2, '0')}
                              </span>
                            </div>
                          </td>
                          
                          {/* Team Name */}
                          <td className="p-4">
                            <span className="text-orange-300 font-medium text-lg truncate max-w-[200px] block">{team.name}</span>
                          </td>
                          
                          {/* Score */}
                          <td className="p-4 text-right">
                            <span className="text-orange-400 font-bold text-xl font-mono tabular-nums">
                              {team.score.toLocaleString()}
                            </span>
                          </td>
                          
                          {/* Solves */}
                          <td className="p-4 text-right">
                            <span className="text-orange-600 text-base font-mono">
                              {team.solves.length}
                            </span>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="border-t border-orange-400/30 px-4 py-2 text-center">
                <span className="text-xs text-orange-600 font-mono">AUTO-REFRESH: 30s</span>
              </div>
            </div>

            {/* Stats Below Leaderboard - Minimal */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "STATUS", value: timeRemaining.isActive ? "LIVE" : timeRemaining.isEnded ? "ENDED" : "SOON", color: timeRemaining.isActive ? "text-orange-400" : "text-yellow-500" },
                { label: "TEAMS", value: rankedTeams.length, color: "text-orange-400" },
                { label: "SOLVES", value: rankedTeams.reduce((acc, t) => acc + t.solves.length, 0), color: "text-orange-400" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="border border-orange-400 bg-black/40 p-4 text-center"
                >
                  <div className="text-xs text-orange-600 font-mono mb-2">{stat.label}</div>
                  <div className={`text-3xl font-bold font-mono ${stat.color}`}>{stat.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Score Chart - Takes 3 columns (60%) */}
          <div className="border border-orange-400 bg-black/40 lg:col-span-3 lg:order-2">
            <div className="border-b border-orange-400 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-orange-400 text-sm">{'>'}</span>
                <h2 className="text-xl md:text-2xl font-bold text-orange-400 tracking-wider">SCORE_EVOLUTION</h2>
              </div>
            </div>
            <div className="p-4">
              <div className="h-[600px]">
                <Suspense 
                  fallback={
                    <div className="flex items-center justify-center h-full">
                      <p className="font-mono text-sm text-orange-600">
                        LOADING...
                      </p>
                    </div>
                  }
                >
                  <PublicChartComponent data={rankedTeams} />
                </Suspense>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Minimal */}
        <div className="text-center text-orange-600 text-xs font-mono">
          <span>━━━</span>
          <span className="mx-3">FCTF {new Date().getFullYear()}</span>
          <span>━━━</span>
        </div>
      </div>

      {/* Scanline effect - subtle */}
      <div className="fixed inset-0 pointer-events-none opacity-5">
        <div className="absolute inset-0 bg-[linear-gradient(0deg,transparent_50%,rgba(34,211,238,0.05)_50%)] bg-[length:100%_4px] animate-scan" />
      </div>

      {/* Corner markers with text - hackathon style */}
      <div className="fixed top-4 left-4 text-orange-400 text-xl">┌</div>
      <div className="fixed top-4 right-4 text-orange-400">
        <div className="flex flex-col items-end">
          <span className="text-xl mb-2">┐</span>
          <span className="text-sm font-mono">{'>'} WELCOME</span>
        </div>
      </div>
      
      {/* Bottom Left - CTF Info */}
      <div className="fixed bottom-10 left-4 text-orange-400">
        <div className="flex flex-col">
          <span className="text-sm font-mono mb-2">CAPTURE THE FLAG</span>
          <span className="text-xs text-orange-600 font-mono">GAMEPLAY: ACTIVE</span>
          <span className="text-xl mt-2">└</span>
        </div>
      </div>
      
      {/* Bottom Right */}
      <div className="fixed bottom-10 right-4 text-orange-400">
        <div className="flex flex-col items-end">
          <span className="text-sm font-mono text-orange-400">GOOD LUCK, HACKER!</span>
          <span className="text-xl mt-2">┘</span>
        </div>
      </div>

      {/* Bottom ticker - Latest solver */}
      <div className="fixed bottom-0 left-0 right-0 bg-black/90 border-t border-orange-400/30 py-2 overflow-hidden z-50">
        <motion.div
          className="whitespace-nowrap"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        >
          <span className="text-orange-400 font-mono text-sm">
            {'>'} good_luck_hacker
            {latestSolver && (
              <>
                <span className="text-orange-600 mx-4">|</span>
                <span className="text-yellow-400">LATEST SOLVE: {latestSolver}</span>
              </>
            )}
            <span className="text-orange-600 mx-4">|</span>
            <span className="text-orange-600">KEEP HACKING</span>
            <span className="text-orange-600 mx-4">|</span>
            <span className="text-orange-400">{'>'} good_luck_hacker</span>
          </span>
        </motion.div>
      </div>
    </div>
  );
}
