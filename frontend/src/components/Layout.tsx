import { type ReactNode, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, KeyRound, ShieldCheck, Menu, X, LogOut } from 'lucide-react';
import { cn } from './ui';

type Props = {
  brandTitle: string;
  logoDataUrl?: string;
  username: string;
  isAdmin: boolean;
  canChangePassword: boolean;
  onLogout: () => void;
  children: ReactNode;
};

export function Layout({ brandTitle, logoDataUrl, username, isAdmin, canChangePassword, onLogout, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { label: 'API Catalog', path: '/', Icon: LayoutGrid },
    ...(canChangePassword ? [{ label: 'Change Password', path: '/change-password', Icon: KeyRound }] : []),
    ...(isAdmin ? [{ label: 'Admin Console', path: '/admin', Icon: ShieldCheck }] : []),
  ];

  function isActive(path: string) {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  }

  function handleLogout() {
    onLogout();
    navigate('/', { replace: true });
  }

  const initials = username.charAt(0).toUpperCase();

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4">
        {logoDataUrl ? (
          <img src={logoDataUrl} alt={brandTitle} className="h-7 w-7 shrink-0 rounded object-contain" />
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-blue-600 text-xs font-bold text-white">
            {initials}
          </div>
        )}
        <span className="truncate text-sm font-semibold text-white">{brandTitle || 'API Portal'}</span>
        <button
          className="ml-auto text-slate-500 hover:text-slate-300 md:hidden"
          onClick={() => setSidebarOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Menu</p>
        {navItems.map(({ label, path, Icon }) => (
          <RouterLink
            key={path}
            to={path}
            onClick={() => setSidebarOpen(false)}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive(path)
                ? 'bg-blue-600/20 text-blue-300'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </RouterLink>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-slate-800 p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-300">
            {initials}
          </div>
          <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{username}</span>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 bg-slate-900 md:flex md:flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="relative flex h-full w-60 flex-col bg-slate-900">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col md:pl-60">
        {/* Mobile topbar */}
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-600 hover:text-slate-900"
          >
            <Menu className="h-5 w-5" />
          </button>
          {logoDataUrl && (
            <img src={logoDataUrl} alt={brandTitle} className="h-6 w-6 object-contain" />
          )}
          <span className="text-sm font-semibold text-slate-800">{brandTitle || 'API Portal'}</span>
        </header>

        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
