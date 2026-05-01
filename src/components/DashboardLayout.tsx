import { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { 
  LayoutDashboard, 
  User, 
  Settings, 
  LogOut, 
  Menu, 
  X, 
  ChevronRight,
  TrendingUp,
  Inbox
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export default function DashboardLayout() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/');
  };

  const menuItems = [
    { 
      label: 'Geral', 
      items: [
        { 
          label: 'Dashboard', 
          path: profile?.role === 'admin' ? '/admin' : '/client', 
          icon: LayoutDashboard 
        },
        ...(profile?.role === 'admin' ? [
          { label: 'Configurações do Sistema', path: '/settings', icon: Settings }
        ] : [])
      ] 
    },
    { 
      label: 'Conta', 
      items: [
        { label: 'Meu Perfil', path: '/profile', icon: User },
      ] 
    }
  ];

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="p-6">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center text-white font-bold transition-transform group-hover:scale-105">AB</div>
          <h1 className="text-sm font-bold leading-tight text-slate-900">
            Agência<br/><span className="text-brand">Boost</span>
          </h1>
        </Link>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {menuItems.map((group, idx) => (
          <div key={idx} className="pt-4 first:pt-0">
            <h3 className="px-3 text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2">
              {group.label}
            </h3>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md transition-all text-sm font-medium",
                    location.pathname === item.path 
                      ? "bg-brand/10 text-brand font-bold" 
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <item.icon size={18} className={cn(
                    location.pathname === item.path ? "text-brand" : "text-slate-400"
                  )} />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-slate-100 p-4">
        <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg border border-slate-100 mb-4">
          <div className="relative">
            <img 
              src={profile?.avatarUrl} 
              alt={profile?.name} 
              className="w-9 h-9 rounded-full object-cover bg-slate-200 border border-white shadow-sm"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 truncate">{profile?.name}</p>
            <p className="text-[10px] text-slate-500 font-medium truncate">
              {profile?.role === 'admin' ? 'Administrador' : 'Cliente'}
            </p>
          </div>
        </div>
        <button 
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all text-xs font-bold"
        >
          <LogOut size={16} />
          Encerrar Sessão
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-64 h-screen sticky top-0">
        <SidebarContent />
      </div>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-20">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
            {location.pathname === '/admin' ? 'Painel Administrativo' : location.pathname === '/client' ? 'Painel do Cliente' : 'Minha Conta'}
          </h2>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full uppercase tracking-tight">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              Sistema Online
            </div>
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-500 hover:bg-slate-50 rounded-md"
            >
              <Menu size={20} />
            </button>
          </div>
        </header>

        <div className="p-6 lg:p-8 flex-1 overflow-x-hidden">
          <Outlet />
        </div>
      </main>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30 lg:hidden"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-80 bg-white z-40 lg:hidden shadow-2xl"
            >
              <div className="p-4 flex justify-end">
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-gray-500">
                  <X size={24} />
                </button>
              </div>
              <SidebarContent />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
