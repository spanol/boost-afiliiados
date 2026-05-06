import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import AdminDashboard from './pages/AdminDashboard';
import ClientDashboard from './pages/ClientDashboard';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import AffiliatesList from './pages/AffiliatesList';
import AffiliateDetails from './pages/AffiliateDetails';
import DashboardLayout from './components/DashboardLayout';

const ProtectedRoute = ({ children, role }: { children: React.ReactNode, role?: 'admin' | 'client' }) => {
  const { user, profile, loading } = useAuth();

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">Autenticando...</p>
      </div>
    </div>
  );

  if (!user) return <Navigate to="/login" replace />;
  
  if (role && profile && profile.role !== role) {
    return <Navigate to={profile.role === 'admin' ? '/admin' : '/client'} replace />;
  }

  // If we have a user but no profile (and not loading), something is wrong with the account
  if (user && !profile && !loading && role) {
    return <Navigate to="/profile" replace />;
  }

  return <>{children}</>;
};

export default function App() {
  return (
    <Router>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          
          <Route element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route path="/dashboard" element={<DashboardRedirect />} />
            <Route path="/admin" element={
              <ProtectedRoute role="admin">
                <AdminDashboard />
              </ProtectedRoute>
            } />
            <Route path="/client" element={
              <ProtectedRoute role="client">
                <ClientDashboard />
              </ProtectedRoute>
            } />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/affiliates" element={<AffiliatesList />} />
            <Route path="/affiliates/:id" element={<AffiliateDetails />} />
          </Route>
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  </Router>
  );
}

function DashboardRedirect() {
  const { profile, loading } = useAuth();
  
  if (loading) return null;
  
  if (profile?.role === 'admin') return <Navigate to="/admin" replace />;
  if (profile?.role === 'client') return <Navigate to="/client" replace />;
  
  // Default fallback if role is missing but user is logged in
  return <Navigate to="/profile" replace />;
}
