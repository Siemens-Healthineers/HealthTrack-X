import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { AuthShell } from './AuthGate';
import { useAuth } from '../../contexts/AuthContext';

export function AuthCallbackPage() {
  const { initialized, enabled, completeSignIn, login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized || !enabled) return;
    let active = true;
    completeSignIn()
      .then((returnTo) => {
        if (!active) return;
        navigate(returnTo, { replace: true });
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Sign-in could not be completed');
      });
    return () => {
      active = false;
    };
  }, [completeSignIn, enabled, initialized, navigate]);

  return (
    <AuthShell title="Completing sign-in" icon={error ? <ShieldCheck className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}>
      <p>{error ?? 'Finishing secure session setup'}</p>
      {error && <Button className="mt-4" onClick={() => void login('/')}>Try again</Button>}
    </AuthShell>
  );
}
