import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import InviteAccept from './pages/InviteAccept';
import AdminDashboard from './pages/AdminDashboard';
import ClientDashboard from './pages/ClientDashboard';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Contacts from './pages/Contacts';
import Avisos from './pages/Avisos';
import AffiliatesList from './pages/AffiliatesList';
import AffiliateDetails from './pages/AffiliateDetails';
import SpecialDashboard from './pages/SpecialDashboard';
import SpecialSubAffiliates from './pages/SpecialSubAffiliates';
import SpecialAffiliatesList from './pages/SpecialAffiliatesList';
import Financeiro from './pages/Financeiro';
import PartnerApiExplorer from './pages/PartnerApiExplorer';
import OtgRoster from './pages/OtgRoster';
import Houses from './pages/Houses';
import NotFound from './pages/NotFound';
import DashboardLayout from './components/DashboardLayout';

// Página inicial do afiliado: especial → painel da sub-rede (/network); afiliado
// comum → a própria visão de dados em /affiliates/{id}; sem affiliateId → perfil.
const clientHome = (profile: { affiliateId?: string | null; isSpecial?: boolean } | null) => {
  if (profile?.isSpecial) return '/network';
  return profile?.affiliateId ? `/affiliates/${profile.affiliateId}` : '/profile';
};

const ProtectedRoute = ({ children, role }: { children: React.ReactNode, role?: 'admin' | 'client' }) => {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-neutral-950">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-widest animate-pulse">Autenticando...</p>
      </div>
    </div>
  );

  if (!user) return <Navigate to="/login" replace />;
  
  if (role && profile && profile.role !== role) {
    return <Navigate to={profile.role === 'admin' ? '/admin' : clientHome(profile)} replace />;
  }

  // If we have a user but no profile (and not loading), something is wrong with the account
  if (user && profile?.mustChangePassword && location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />;
  }

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
          <ToastProvider>
          <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/convite/:token" element={<InviteAccept />} />
          
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
            <Route path="/network" element={
              <ProtectedRoute role="client">
                <SpecialDashboard />
              </ProtectedRoute>
            } />
            <Route path="/network/afiliados" element={
              <ProtectedRoute role="client">
                <SpecialSubAffiliates />
              </ProtectedRoute>
            } />
            <Route path="/financeiro" element={
              <ProtectedRoute role="client">
                <Financeiro />
              </ProtectedRoute>
            } />
            <Route path="/profile" element={<Profile />} />
            <Route path="/avisos" element={<Avisos />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/contacts" element={
              <ProtectedRoute role="admin">
                <Contacts />
              </ProtectedRoute>
            } />
            <Route path="/affiliates" element={<AffiliatesList />} />
            <Route path="/special-affiliates" element={
              <ProtectedRoute role="admin">
                <SpecialAffiliatesList />
              </ProtectedRoute>
            } />
            <Route path="/parceiros-api" element={
              <ProtectedRoute role="admin">
                <PartnerApiExplorer />
              </ProtectedRoute>
            } />
            <Route path="/roster-otg" element={
              <ProtectedRoute role="admin">
                <OtgRoster />
              </ProtectedRoute>
            } />
            <Route path="/casas" element={
              <ProtectedRoute role="admin">
                <Houses />
              </ProtectedRoute>
            } />
            <Route path="/affiliates/:id" element={<AffiliateDetails />} />
          </Route>

          {/* Catch-all: rotas desconhecidas do SPA caem numa 404 branded. */}
          <Route path="*" element={<NotFound />} />
          </Routes>
        </ToastProvider>
        </AuthProvider>
    </ThemeProvider>
  </Router>
  );
}

function DashboardRedirect() {
  const { profile, loading } = useAuth();
  
  if (loading) return null;
  
  if (profile?.role === 'admin') return <Navigate to="/admin" replace />;
  if (profile?.role === 'client') return <Navigate to={clientHome(profile)} replace />;

  // SECURITY (HIGH-2): fail-safe — papel desconhecido/ausente cai no MENOR
  // privilégio (perfil), nunca na área de admin. Antes ia para /admin (fail-open).
  return <Navigate to="/profile" replace />;
}
