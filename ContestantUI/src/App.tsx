import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/ToastProvider';
import { PrivateRoute } from './components/PrivateRoute';
import { PageLoader } from './components/PageLoader';
import { Layout } from './components/Layout';
import { ThemeProvider } from './context/ThemeContext';

// Lazy load pages
const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Challenges = lazy(() => import('./pages/Challenges').then(module => ({ default: module.Challenges })));
const Scoreboard = lazy(() => import('./pages/Scoreboard').then(module => ({ default: module.Scoreboard })));
const Tickets = lazy(() => import('./pages/Tickets').then(module => ({ default: module.Tickets })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/login" element={<Login />} />
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
                  path="/profile"
                  element={
                    <PrivateRoute>
                      <Layout><Profile /></Layout>
                    </PrivateRoute>
                  }
                />
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;