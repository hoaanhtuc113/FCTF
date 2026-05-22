import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/ToastProvider';
import { PrivateRoute } from './components/PrivateRoute';
import { PageLoader } from './components/PageLoader';
import { Layout } from './components/Layout';
import { ThemeProvider } from './context/ThemeContext';
// deployment notifications hook exists but is currently disabled; import when needed
// import { useDeploymentNotification } from './hooks/useDeploymentNotification';

// Lazy load pages
const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Register = lazy(() => import('./pages/Register').then(module => ({ default: module.Register })));
// Dashboard and Home screens have been removed; users go straight to contests after login
const Contests = lazy(() => import('./pages/Contests').then(module => ({ default: module.Contests })));
const Challenges = lazy(() => import('./pages/Challenges').then(module => ({ default: module.Challenges })));
const Scoreboard = lazy(() => import('./pages/Scoreboard').then(module => ({ default: module.Scoreboard })));
const PublicScoreboard = lazy(() => import('./pages/PublicScoreboard').then(module => ({ default: module.PublicScoreboard })));
const Tickets = lazy(() => import('./pages/Tickets').then(module => ({ default: module.Tickets })));
const TicketDetail = lazy(() => import('./pages/TicketDetail').then(module => ({ default: module.TicketDetail })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const Instances = lazy(() => import('./pages/Instances').then(module => ({ default: module.Instances })));
const ActionLogsPage = lazy(() => import('./pages/ActionLogsPage').then(module => ({ default: module.ActionLogsPage })));

// Inner component to use theme context
function AppRoutes() {
  // const { theme } = useTheme(); // theme used for notifications if enabled
  // notifications disabled: useDeploymentNotification(theme); // uncomment to re-enable

  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/public/scoreboard" element={<PublicScoreboard />} />
              <Route
                path="/contests"
                element={
                  <PrivateRoute>
                    <Contests />
                  </PrivateRoute>
                }
              />
              <Route
                path="/contest/:contestId/challenges"
                element={
                  <PrivateRoute requireContest={true}>
                    <Layout><Challenges /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/contest/:contestId/challenge/:id"
                element={
                  <PrivateRoute requireContest={true}>
                    <Layout><Challenges /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/contest/:contestId/scoreboard"
                element={
                  <PrivateRoute requireContest={true}>
                    <Layout><Scoreboard /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/contest/:contestId/tickets"
                element={
                  <PrivateRoute requireContest={true}>
                    <Layout><Tickets /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/contest/:contestId/tickets/:id"
                element={
                  <PrivateRoute requireContest={true}>
                    <Layout><TicketDetail /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/contest/:contestId/profile"
                element={
                  <PrivateRoute requireContest={true}>
                    <Layout><Profile /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/contest/:contestId/instances"
                element={
                  <PrivateRoute requireContest={true}>
                    <Layout><Instances /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/contest/:contestId/action-logs"
                element={
                  <PrivateRoute requireContest={true}>
                    <Layout><ActionLogsPage /></Layout>
                  </PrivateRoute>
                }
              />
              <Route path="/" element={<Navigate to="/contests" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppRoutes />
    </ThemeProvider>
  );
}

export default App;