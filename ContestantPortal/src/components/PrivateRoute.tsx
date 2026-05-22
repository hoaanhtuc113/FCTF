import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface PrivateRouteProps {
  children: React.ReactNode;
  requireContest?: boolean;
}

export function PrivateRoute({ children, requireContest = false }: PrivateRouteProps) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Intercept if contest selection is required but missing
  const { contestId } = useParams<{ contestId?: string }>();
  
  if (requireContest) {
    if (contestId) {
      localStorage.setItem('selected_contest_id', contestId);
      // We don't have the full contest object here to set in contestService, 
      // but api.ts will use selected_contest_id.
    } else {
      const selectedContest = localStorage.getItem('selected_contest_id');
      if (!selectedContest) {
        return <Navigate to="/contests" replace />;
      }
    }
  }

  return <>{children}</>;
}