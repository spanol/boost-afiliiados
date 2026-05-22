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
  Sun,
  Moon,
  Users
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '../contexts/ThemeContext';

const boostLogo = `${import.meta.env.BASE_URL}boost-home/logo.svg`;

export default function DashboardLayout() {
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
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
        {
          label: profile?.role === 'admin' ? 'Afiliados' : 'Clientes',
          path: '/affiliates',
          icon: Users
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
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div className="p-6 pb-2">
        <Link to="/" className="flex items-center gap-2 group">
          <img
            src={boostLogo}
            alt="Boost"
            className="h-[24px] w-auto"
          />
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
                    "flex items-center gap-3 px-3 py-2 rounded-md transition-all text-sm font-medium border border-transparent",
                    location.pathname === item.path 
                      ? "bg-brand/10 text-brand font-bold border-brand/20 shadow-sm" 
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-white hover:border-slate-200 dark:hover:border-slate-700 hover:shadow-sm"
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

      <div className="mt-auto border-t border-slate-100 dark:border-slate-800 p-4">
        <div className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800 mb-4">
          <div className="relative">
            <img 
              src={profile?.avatarUrl} 
              alt={profile?.name} 
              className="w-9 h-9 rounded-full object-cover bg-slate-200 border border-white dark:border-slate-700 shadow-sm"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{profile?.name}</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">
              {profile?.role === 'admin' ? 'Administrador' : 'Cliente'}
            </p>
          </div>
        </div>
        <button 
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 hover:shadow-sm transition-all text-xs font-bold border border-transparent hover:border-red-100 dark:hover:border-red-900/30"
        >
          <LogOut size={16} />
          Encerrar Sessão
        </button>
      </div>
    </div>
  );

  return (
    <div className={cn("min-h-screen bg-slate-50 dark:bg-slate-950 flex transition-colors duration-300", theme === 'dark' ? 'dark' : '')}>
      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-64 h-screen sticky top-0">
        <SidebarContent />
      </div>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 sticky top-0 z-20 transition-colors duration-300">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider dark:text-slate-200">
            {location.pathname === '/admin' ? 'Painel Administrativo' : location.pathname === '/client' ? 'Painel do Cliente' : 'Minha Conta'}
          </h2>
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleTheme}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent hover:border-slate-300 dark:hover:border-slate-600 transition-all shadow-sm"
              title={theme === 'light' ? 'Mudar para tema escuro' : 'Mudar para tema claro'}
            >
              {theme === 'light' ? (
                <>
                  <Moon size={14} className="text-slate-600" />
                  <span className="text-[10px] font-bold uppercase tracking-tight">Tema Escuro</span>
                </>
              ) : (
                <>
                  <Sun size={14} className="text-amber-500" />
                  <span className="text-[10px] font-bold uppercase tracking-tight">Tema Claro</span>
                </>
              )}
            </button>
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
              className="fixed right-0 top-0 bottom-0 w-80 bg-white dark:bg-slate-900 z-40 lg:hidden shadow-2xl"
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
