import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import { fetchWithAuth } from '../services/api';

interface PrivateRouteProps {
  children: React.ReactNode;
  requireContest?: boolean;
}

export function PrivateRoute({ children, requireContest = false }: PrivateRouteProps) {
  const { isAuthenticated, loading } = useAuth();
  const { contestId } = useParams<{ contestId?: string }>();

  // 'pending' only when we actually need to verify contest membership
  const [contestCheck, setContestCheck] = useState<'pending' | 'ok' | 'denied'>(
    requireContest && contestId ? 'pending' : 'ok'
  );

  useEffect(() => {
    if (!requireContest || !contestId) {
      setContestCheck('ok');
      return;
    }

    setContestCheck('pending');

    // Verify the user belongs to this contest via the backend.
    // GET /api/contests/{id} already filters by membership — returns 404 if not a member.
    fetchWithAuth(`/contests/${contestId}`)
      .then(res => {
        if (res.ok) {
          localStorage.setItem('selected_contest_id', contestId);
          setContestCheck('ok');
        } else {
          setContestCheck('denied');
        }
      })
      .catch(() => setContestCheck('denied'));
  }, [contestId, requireContest]);

  if (loading) return <div>Loading...</div>;

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (contestCheck === 'pending') return <div>Loading...</div>;

  if (requireContest && contestCheck === 'denied')
    return <Navigate to="/contests" replace />;

  return <>{children}</>;
}
