import { Navigate, useParams } from 'react-router-dom';
import { contestService } from '../services/contestService';

interface ScoreboardRouteProps {
  children: React.ReactNode;
}

/**
 * Route guard for the Scoreboard page.
 * Blocks access when score_visibility is "admins" or "hidden".
 * The actual API also enforces this server-side; this guard provides
 * a better UX by redirecting instead of showing an error page.
 */
export function ScoreboardRoute({ children }: ScoreboardRouteProps) {
  const { contestId } = useParams<{ contestId?: string }>();
  const activeContest = contestService.getActiveContest();
  const visibility = activeContest?.score_visibility ?? 'public';

  if (visibility === 'admins' || visibility === 'hidden') {
    // Redirect to challenges page — the tab was already hidden in Layout.tsx,
    // but this blocks direct URL access too.
    const target = contestId ? `/contest/${contestId}/challenges` : '/challenges';
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
}
