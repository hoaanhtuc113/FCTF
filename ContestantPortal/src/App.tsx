import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/ToastProvider';
import { PrivateRoute } from './components/PrivateRoute';
import { PageLoader } from './components/PageLoader';
import { Layout } from './components/Layout';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { useDeploymentNotification } from './hooks/useDeploymentNotification';

// Lazy load pages
const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Challenges = lazy(() => import('./pages/Challenges').then(module => ({ default: module.Challenges })));
const Scoreboard = lazy(() => import('./pages/Scoreboard').then(module => ({ default: module.Scoreboard })));
const PublicScoreboard = lazy(() => import('./pages/PublicScoreboard').then(module => ({ default: module.PublicScoreboard })));
const Tickets = lazy(() => import('./pages/Tickets').then(module => ({ default: module.Tickets })));
const TicketDetail = lazy(() => import('./pages/TicketDetail').then(module => ({ default: module.TicketDetail })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const Instances = lazy(() => import('./pages/Instances').then(module => ({ default: module.Instances })));

// Inner component to use theme context
function AppRoutes() {
  const { theme } = useTheme();
  
  // Global deployment notification listener
  useDeploymentNotification(theme);

  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/public/scoreboard" element={<PublicScoreboard />} />
              <Route
                path="/dashboard"
                element={
                  <PrivateRoute>
                    <Layout><Dashboard /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/challenges"
                element={
                  <PrivateRoute>
                    <Layout><Challenges /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/challenge/:id"
                element={
                  <PrivateRoute>
                    <Layout><Challenges /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/scoreboard"
                element={
                  <PrivateRoute>
                    <Layout><Scoreboard /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/tickets"
                element={
                  <PrivateRoute>
                    <Layout><Tickets /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/tickets/:id"
                element={
                  <PrivateRoute>
                    <Layout><TicketDetail /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <PrivateRoute>
                    <Layout><Profile /></Layout>
                  </PrivateRoute>
                }
              />
              <Route
                path="/instances"
                element={
                  <PrivateRoute>
                    <Layout><Instances /></Layout>
                  </PrivateRoute>
                }
              />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
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