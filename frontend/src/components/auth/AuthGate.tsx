import { useEffect, type ReactNode } from 'react';
import { Loader2, ShieldCheck, Clock } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';

export function AuthShell({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm border bg-card text-card-foreground rounded-lg shadow-sm p-6 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          {icon ?? <ShieldCheck className="h-6 w-6" />}
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="text-sm text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { enabled, initialized, isAuthenticated, approvalPending, error, login, logout } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!enabled || !initialized || isAuthenticated || error) return;
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    void login(returnTo);
  }, [enabled, error, initialized, isAuthenticated, location.hash, location.pathname, location.search, login]);

  if (!initialized) {
    return (
      <AuthShell title="Starting secure session">
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Preparing sign-in</span>
        </div>
      </AuthShell>
    );
  }

  if (error) {
    return (
      <AuthShell title="Sign-in unavailable">
        <p>{error}</p>
        <Button className="mt-4" onClick={() => void login()}>
          Try again
        </Button>
      </AuthShell>
    );
  }

  if (approvalPending) {
    return (
      <AuthShell title="Freigabe ausstehend" icon={<Clock className="h-6 w-6" />}>
        <p>Dein Account wurde erfolgreich erstellt.</p>
        <p className="mt-2">Ein Administrator muss deinen Zugang erst freigeben, bevor du die App nutzen kannst.</p>
        <Button variant="outline" className="mt-4" onClick={() => void logout()}>
          Abmelden
        </Button>
      </AuthShell>
    );
  }

  if (enabled && !isAuthenticated) {
    return (
      <AuthShell title="Redirecting to sign-in">
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Opening Keycloak</span>
        </div>
      </AuthShell>
    );
  }

  return <>{children}</>;
}
