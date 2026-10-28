import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { apiFetch } from '../config/api';

export type AppProfile = 'raw-material' | 'semi-finished-good' | 'medical-device' | 'finished-product';

const PROFILE_DATA_FOLDERS: AppProfile[] = [
  'raw-material',
  'semi-finished-good',
  'medical-device',
  'finished-product',
];

interface ProfileConfig {
  configId: string | null;
  dataFolder: string;
  repoFullName: string | null;
}

// ── Shared repo-metadata cache (module-level) ──────────────────────
// Both AppProfileContext and useSchemaFields need the same
// /api/repo-metadata response.  We cache it here so only ONE
// network request is made instead of two.
let _repoMetadataCache: { data: RepoMetadataCache | null; ts: number } = { data: null, ts: 0 };
let _repoMetadataInflight: Promise<RepoMetadataCache | null> | null = null;
const _REPO_METADATA_CACHE_TTL = 120_000; // 2 minutes

interface RepoMetadataCache {
  repos: Array<{
    config_id: string;
    full_name: string;
    data_folders: Array<{ folder: string; sample_fields?: Array<Record<string, unknown>> }>;
  }>;
}

/** Fetch repo-metadata (shared, deduplicated, cached). */
export async function fetchRepoMetadata(): Promise<RepoMetadataCache | null> {
  const now = Date.now();
  if (_repoMetadataCache.data && now - _repoMetadataCache.ts < _REPO_METADATA_CACHE_TTL) {
    return _repoMetadataCache.data;
  }
  if (_repoMetadataInflight) return _repoMetadataInflight;

  _repoMetadataInflight = (async () => {
    try {
      const res = await apiFetch('/api/repo-metadata');
      if (!res.ok) return _repoMetadataCache.data;
      const data: RepoMetadataCache = await res.json();
      _repoMetadataCache = { data, ts: Date.now() };
      return data;
    } catch {
      return _repoMetadataCache.data;
    } finally {
      _repoMetadataInflight = null;
    }
  })();

  return _repoMetadataInflight;
}

/** Force-clear the shared cache (used by invalidateSchemaCache). */
export function clearRepoMetadataCache() {
  _repoMetadataCache = { data: null, ts: 0 };
  _repoMetadataInflight = null;
}

interface AppProfileContextType {
  appProfile: AppProfile;
  setAppProfile: (profile: AppProfile) => void;
  highlightedNodeId: string | null;
  highlightedNodeIds: string[];
  setHighlightedNodeId: (nodeId: string | null) => void;
  /** GitHub config UUID for the active profile (null if not yet resolved) */
  configId: string | null;
  /** Data folder name for the active profile (e.g. "products", "quality-reports") */
  dataFolder: string;
  /** Full repo name for the active profile */
  repoFullName: string | null;
}

const AppProfileContext = createContext<AppProfileContextType | undefined>(undefined);

export function AppProfileProvider({ children }: { children: ReactNode }) {
  const [appProfile, setAppProfileState] = useState<AppProfile>(() => {
    const saved = localStorage.getItem('appProfile');
    return (saved as AppProfile) || 'raw-material';
  });

  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([]);

  // Profile → config mapping fetched from backend
  const [profileMap, setProfileMap] = useState<Record<string, ProfileConfig>>({});

  // Fetch repo-metadata once to build the profile → config mapping
  useEffect(() => {
    let cancelled = false;
    async function fetchMapping() {
      const data = await fetchRepoMetadata();
      if (!data || cancelled) return;
      const repos = data.repos || [];

      const map: Record<string, ProfileConfig> = {};
      for (const profile of PROFILE_DATA_FOLDERS) {
        const repo = repos.find((entry) => entry.data_folders?.some(
          (folder) => folder.folder.toLowerCase().includes(profile),
        ));
        const dataFolder = repo?.data_folders.find((folder) => folder.folder.toLowerCase().includes(profile));
        if (repo && dataFolder) {
          map[profile] = {
            configId: repo.config_id,
            dataFolder: dataFolder.folder,
            repoFullName: repo.full_name,
          };
        }
      }
      if (!cancelled) setProfileMap(map);
    }
    fetchMapping();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    localStorage.setItem('appProfile', appProfile);
    
    // Set highlighted nodes based on profile
    switch (appProfile) {
      case 'raw-material':
        setHighlightedNodeId('1'); // Raw Material Producer node
        setHighlightedNodeIds(['1', 'background-box']); // Include group box
        break;
      case 'semi-finished-good':
        setHighlightedNodeId('2'); // Semi-finished Good node
        setHighlightedNodeIds(['2', 'background-box-semi-finished-good']); // Include semi-finished-good group box
        break;
      default:
        setHighlightedNodeId(null);
        setHighlightedNodeIds([]);
    }
  }, [appProfile]);

  const setAppProfile = useCallback((profile: AppProfile) => {
    setAppProfileState(profile);
  }, []);

  // Derive configId / dataFolder / repoFullName from current profile
  const current = profileMap[appProfile];
  const configId = current?.configId ?? null;
  const dataFolder = current?.dataFolder ?? 'products';
  const repoFullName = current?.repoFullName ?? null;

  return (
    <AppProfileContext.Provider value={{
      appProfile, setAppProfile,
      highlightedNodeId, highlightedNodeIds, setHighlightedNodeId,
      configId, dataFolder, repoFullName,
    }}>
      {children}
    </AppProfileContext.Provider>
  );
}

export function useAppProfile() {
  const context = useContext(AppProfileContext);
  if (context === undefined) {
    throw new Error('useAppProfile must be used within an AppProfileProvider');
  }
  return context;
}
