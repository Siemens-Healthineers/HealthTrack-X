import { useState } from 'react';
import {
  Settings,
  Menu,
  X,
  Sun,
  Moon,
  Table,
  Network,
  GitBranch,
  BookOpen,
  ArrowRightLeft,
  FileText,
  Boxes,
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useSystemStatus } from '../../contexts/SystemStatusContext';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import { Navbar } from './Navbar';

interface AppLayoutProps {
  children: React.ReactNode;
  currentPage?: string;
  onNavigate?: (page: string) => void;
}

export function AppLayout({ children, currentPage = 'dashboard', onNavigate }: AppLayoutProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { isDarkMode, toggleTheme } = useTheme();
  const { status } = useSystemStatus();

  const getStatusColor = () => {
    switch (status?.overallStatus) {
      case 'online': return 'text-green-500 drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]'
      case 'warning': return 'text-yellow-500 drop-shadow-[0_0_8px_rgba(234,179,8,0.6)]'
      case 'offline': return 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]'
      case 'error': return 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]'
      case 'checking': return 'text-blue-500 animate-pulse drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]'
      default: return 'text-gray-400 animate-pulse'
    }
  };

  const navigationItems = [
    { id: 'overview', label: 'Overview', icon: Network },
    { id: 'nx-structure', label: 'Design', icon: Boxes },
    { id: 'table', label: 'Data', icon: Table },
    { id: 'catalog', label: 'Catalog', icon: BookOpen },
    { id: 'connector', label: 'EDC', icon: ArrowRightLeft },
    { id: 'docs', label: 'Docs', icon: FileText },
  ];

  const handleNavClick = (pageId: string) => {
    if (onNavigate) {
      onNavigate(pageId);
    }
    setIsMobileSidebarOpen(false);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Desktop Navbar - Full width */}
      <Navbar className="hidden lg:flex" />
      
      {/* Main container with sidebar and content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar - Narrow like Teams */}
        <aside className="hidden lg:flex flex-col w-20 bg-sidebar-background">
        {/* Navigation */}
        <div className="flex-1 overflow-y-auto">
          <TooltipProvider delayDuration={0}>
            <nav className="flex flex-col items-center py-4 space-y-2">
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentPage === item.id;
                
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleNavClick(item.id)}
                        className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg transition-colors relative group ${
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent'
                        }`}
                      >
                        <Icon className={`h-6 w-6 ${isActive ? 'text-primary-foreground' : 'text-sidebar-foreground group-hover:text-sidebar-primary'}`} />
                        <span className={`text-[10px] mt-1 font-medium truncate max-w-full px-1 ${
                          isActive ? 'text-primary-foreground' : 'text-sidebar-foreground group-hover:text-sidebar-primary'
                        }`}>
                          {item.label.length > 8 ? item.label.substring(0, 7) + '...' : item.label}
                        </span>
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full bg-[hsl(var(--sidebar-accent-indicator))]" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="bg-popover text-popover-foreground border">
                      <p className="font-medium">{item.label}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </nav>
          </TooltipProvider>
        </div>

        {/* Theme toggle and Settings buttons at bottom */}
        <div className="flex flex-col items-center py-2 border-t border-sidebar-border space-y-2">
          <TooltipProvider delayDuration={0}>
            {/* Theme Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleTheme}
                  className="flex flex-col items-center justify-center w-16 h-16 rounded-lg transition-colors relative group text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  {isDarkMode ? (
                    <Sun className="h-6 w-6 text-sidebar-foreground group-hover:text-sidebar-primary" />
                  ) : (
                    <Moon className="h-6 w-6 text-sidebar-foreground group-hover:text-sidebar-primary" />
                  )}
                  <span className="text-[10px] mt-1 font-medium text-sidebar-foreground group-hover:text-sidebar-primary">
                    {isDarkMode ? 'Light' : 'Dark'}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-popover text-popover-foreground border">
                <p className="font-medium">Toggle {isDarkMode ? 'Light' : 'Dark'} Mode</p>
              </TooltipContent>
            </Tooltip>

            {/* Repo Graph & Settings — same nav button pattern */}
            {([
              { id: 'repo-graph', icon: GitBranch, label: 'Schema', tooltip: 'Schema' },
              { id: 'settings', icon: Settings, label: 'Settings', tooltip: 'Settings' },
            ] as const).map(({ id, icon: Icon, label, tooltip }) => {
              const isActive = currentPage === id;
              return (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleNavClick(id)}
                      className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg transition-colors relative group ${
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent'
                      }`}
                    >
                      <Icon className={`h-6 w-6 ${isActive ? 'text-primary-foreground' : 'text-sidebar-foreground group-hover:text-sidebar-primary'}`} />
                      <span className={`text-[10px] mt-1 font-medium ${
                        isActive ? 'text-primary-foreground' : 'text-sidebar-foreground group-hover:text-sidebar-primary'
                      }`}>
                        {label}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-popover text-popover-foreground border">
                    <p className="font-medium">{tooltip}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </div>

        {/* Footer - Status indicator (clickable → Settings/System Status) */}
        <div className="flex flex-col items-center py-3 border-t border-sidebar-border">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleNavClick('settings-status')}
                  className="flex flex-col items-center justify-center space-y-1 cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <div className="flex items-center justify-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getStatusColor()}`}>
                      <div className="w-4 h-4 rounded-full bg-current" />
                    </div>
                  </div>
                  <span className="text-[10px] text-sidebar-foreground font-medium">App Status</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-popover text-popover-foreground border">
                <p className="font-medium">System Status: {status?.overallStatus || 'Unknown'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={`lg:hidden fixed left-0 top-0 bottom-0 w-64 bg-sidebar-background z-50 transform transition-transform ${
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Mobile Header */}
        <div className="flex items-center justify-between h-14 px-4 bg-sidebar-background">
          <svg 
            className="w-5 h-5 flex-shrink-0"
            viewBox="0 0 32 32" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="32" height="32" rx="6" fill="#CCC6FF" fillOpacity="0.2"/>
            <path 
              d="M16 8L8 12V20C8 22.21 11.58 24 16 24C20.42 24 24 22.21 24 20V12L16 8Z" 
              fill="#CCC6FF"
            />
            <path 
              d="M16 16C17.66 16 19 14.66 19 13C19 11.34 17.66 10 16 10C14.34 10 13 11.34 13 13C13 14.66 14.34 16 16 16Z" 
              fill="#3ae58b"
            />
          </svg>
          <button
            onClick={() => setIsMobileSidebarOpen(false)}
            className="p-1.5 rounded hover:bg-sidebar-accent transition-colors"
          >
            <X className="h-4 w-4 text-sidebar-foreground" />
          </button>
        </div>

        {/* Mobile Navigation */}
        <div className="flex-1 overflow-y-auto p-2">
          <nav className="space-y-1">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent'
                  }`}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-primary-foreground' : 'text-sidebar-foreground'}`} />
                  <span className={`text-sm font-medium ${isActive ? 'text-primary-foreground' : ''}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center gap-3 p-4 bg-background">
          <button
            onClick={() => setIsMobileSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-primary flex items-center justify-center">
              <Table className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">HTX Demo Application</span>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
      </div>
    </div>
  );
}
