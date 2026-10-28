import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { apiJson, setAccessTokenProvider } from '../config/api';

interface AuthStatusResponse {
  enabled: boolean;
  issuer?: string | null;
  client_id?: string | null;
}

interface AuthRuntimeConfig {
  enabled: boolean;
  authority: string;
  clientId: string;
}

interface AuthContextValue {
  enabled: boolean;
  initialized: boolean;
  isAuthenticated: boolean;
  approvalPending: boolean;
  user: User | null;
  username: string | null;
  error: string | null;
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  completeSignIn: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const viteAuthority = import.meta.env.VITE_OIDC_AUTHORITY?.trim() ?? '';
const viteClientId = import.meta.env.VITE_OIDC_CLIENT_ID?.trim() ?? '';

function getCurrentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function userName(user: User | null): string | null {
  if (!user) return null;
  const profile = user.profile as Record<string, unknown>;
  return (
    (typeof profile.preferred_username === 'string' && profile.preferred_username) ||
    (typeof profile.name === 'string' && profile.name) ||
    (typeof profile.email === 'string' && profile.email) ||
    null
  );
}

async function loadRuntimeConfig(): Promise<AuthRuntimeConfig> {
  if (viteAuthority && viteClientId) {
    return { enabled: true, authority: viteAuthority, clientId: viteClientId };
  }

  try {
    const status = await apiJson<AuthStatusResponse>('/api/auth/status');
    const authority = status.issuer?.trim() ?? '';
    const clientId = status.client_id?.trim() ?? '';
    return {
      enabled: Boolean(status.enabled && authority && clientId),
      authority,
      clientId,
    };
  } catch (error) {
    console.warn('Auth status could not be loaded; continuing without OIDC.', error);
    return { enabled: false, authority: '', clientId: '' };
  }
}

function createUserManager(config: AuthRuntimeConfig): UserManager | null {
  if (!config.enabled) return null;
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    silent_redirect_uri: `${window.location.origin}/silent-renew.html`,
    post_logout_redirect_uri: window.location.origin,
    response_type: 'code',
    scope: 'openid profile email',
    loadUserInfo: true,
    automaticSilentRenew: true,
    accessTokenExpiringNotificationTimeInSeconds: 60,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [runtimeConfig, setRuntimeConfig] = useState<AuthRuntimeConfig>({ enabled: false, authority: '', clientId: '' });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalPending, setApprovalPending] = useState(false);

  useEffect(() => {
    let active = true;
    loadRuntimeConfig()
      .then((config) => {
        if (!active) return;
        setRuntimeConfig(config);
        setConfigLoaded(true);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Authentication configuration failed');
        setRuntimeConfig({ enabled: false, authority: '', clientId: '' });
        setConfigLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const userManager = useMemo(() => createUserManager(runtimeConfig), [runtimeConfig]);

  const login = useCallback(async (returnTo = getCurrentPath()) => {
    if (!userManager) return;
    await userManager.signinRedirect({ state: { returnTo } });
  }, [userManager]);

  const logout = useCallback(async () => {
    if (!userManager) return;
    const currentUser = await userManager.getUser();
    await userManager.removeUser();
    await userManager.signoutRedirect({
      id_token_hint: currentUser?.id_token,
    });
  }, [userManager]);

  const completeSignIn = useCallback(async () => {
    if (!userManager) return '/';
    const signedInUser = await userManager.signinRedirectCallback();
    setUser(signedInUser);
    const state = signedInUser.state as { returnTo?: string } | undefined;
    return state?.returnTo || '/';
  }, [userManager]);

  useEffect(() => {
    if (!configLoaded) return;

    if (!userManager) {
      setAccessTokenProvider(null);
      setUser(null);
      setAuthLoaded(true);
      return;
    }

    let active = true;
    setAccessTokenProvider(async () => {
      const currentUser = await userManager.getUser();
      if (!currentUser || currentUser.expired) return null;
      return currentUser.access_token ?? null;
    });

    const handleUserLoaded = (loadedUser: User) => setUser(loadedUser);
    const handleUserUnloaded = () => setUser(null);
    const handleTokenExpired = () => {
      // Silent renew will handle this automatically.
      // Only redirect if silent renew fails.
      userManager.signinSilent().catch(() => {
        setUser(null);
        void login();
      });
    };
    const handleSilentRenewError = () => {
      setUser(null);
      void login();
    };

    userManager.events.addUserLoaded(handleUserLoaded);
    userManager.events.addUserUnloaded(handleUserUnloaded);
    userManager.events.addAccessTokenExpired(handleTokenExpired);
    userManager.events.addSilentRenewError(handleSilentRenewError);
    window.addEventListener('htx:auth-required', handleTokenExpired);
    const handleApprovalPending = () => setApprovalPending(true);
    window.addEventListener('htx:approval-pending', handleApprovalPending);

    userManager.getUser()
      .then((storedUser) => {
        if (!active) return;
        setUser(storedUser && !storedUser.expired ? storedUser : null);
        setAuthLoaded(true);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Authentication initialization failed');
        setUser(null);
        setAuthLoaded(true);
      });

    return () => {
      active = false;
      setAccessTokenProvider(null);
      userManager.events.removeUserLoaded(handleUserLoaded);
      userManager.events.removeUserUnloaded(handleUserUnloaded);
      userManager.events.removeAccessTokenExpired(handleTokenExpired);
      userManager.events.removeSilentRenewError(handleSilentRenewError);
      window.removeEventListener('htx:auth-required', handleTokenExpired);
      window.removeEventListener('htx:approval-pending', handleApprovalPending);
    };
  }, [configLoaded, login, userManager]);

  // Check approval status from token claims when user is loaded
  useEffect(() => {
    if (!runtimeConfig.enabled || !user || user.expired) {
      setApprovalPending(false);
      return;
    }
    const profile = user.profile as Record<string, unknown>;
    const realmRoles = (profile?.realm_access as { roles?: string[] })?.roles ?? [];
    const approvedRoles = ['viewer', 'admin', 'editor', 'service'];
    const hasApprovedRole = realmRoles.some((r: string) => approvedRoles.includes(r));
    setApprovalPending(!hasApprovedRole);
  }, [runtimeConfig.enabled, user]);

  const value: AuthContextValue = {
    enabled: runtimeConfig.enabled,
    initialized: configLoaded && authLoaded,
    isAuthenticated: !runtimeConfig.enabled || Boolean(user && !user.expired),
    approvalPending,
    user,
    username: userName(user),
    error,
    login,
    logout,
    completeSignIn,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
