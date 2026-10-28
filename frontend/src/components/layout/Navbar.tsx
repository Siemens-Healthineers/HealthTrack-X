import { useState } from 'react';
import { Bot, LogOut, UserCircle } from 'lucide-react';
import htxLogoDark from '../../assets/htx-logo-dark-theme.png';
import htxLogoLight from '../../assets/htx-logo-light-theme.png';
import { ChatPanel } from '../ChatPanel';
import { useAuth } from '../../contexts/AuthContext';

interface NavbarProps {
  className?: string;
}

export function Navbar({ className = '' }: NavbarProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const { enabled, username, logout } = useAuth();

  return (
    <>
      <header className={`h-14 border-b bg-background flex items-center justify-between px-6 ${className}`}>
        <div className="flex items-center gap-3">
          {/* Light theme logo */}
          <img 
            src={htxLogoLight} 
            alt="HealthTrack-X Logo" 
            className="h-8 flex-shrink-0 dark:hidden"
          />
          {/* Dark theme logo */}
          <img 
            src={htxLogoDark} 
            alt="HealthTrack-X Logo" 
            className="h-8 flex-shrink-0 hidden dark:block"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Demonstrator | SimpleX</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {enabled && username && (
            <>
              <div className="hidden md:flex items-center gap-2 px-2 py-1 rounded-md bg-muted text-muted-foreground text-xs max-w-48">
                <UserCircle className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{username}</span>
              </div>
              <button
                onClick={() => void logout()}
                className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Logout</span>
              </button>
            </>
          )}
          <button
            onClick={() => setChatOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg
              bg-primary/10 hover:bg-primary/20
              text-primary text-sm font-medium
              transition-colors"
          >
            <Bot className="h-4 w-4" />
            <span className="hidden sm:inline">AI Assistant</span>
          </button>
        </div>
      </header>

      {/* Chat overlay panel */}
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </>
  );
}
