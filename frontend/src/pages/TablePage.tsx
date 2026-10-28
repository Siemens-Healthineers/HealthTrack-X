/**
 * Table Page
 * Display and manage data in a table format
 */

// Trademark notice: "Asset Administration Shell" (AAS) and the AAS logo are
// trademarks of the Industrial Digital Twin Association (IDTA), referenced here
// for identification and interoperability purposes only.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Plus, Pencil, Info, Trash2, MoreVertical, RefreshCw, Mountain, Flame, Heart, PenTool, Sparkles, Loader2, AlertTriangle, ListChecks, ArrowRight, ArrowLeft, Braces, Link2, type LucideIcon } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { useTheme } from '../contexts/ThemeContext';
import { useAppProfile } from '../contexts/AppProfileContext';
import aasLogoDark from '../assets/AAS-Logo-Dark-Theme.svg';
import aasLogoLight from '../assets/AAS-Logo-Light-Theme.svg';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Card } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { DataForm } from '../components/DataForm';
import { BomTreeTable, type BomNode } from '../components/BomTreeTable';
import { BomNodeForm, type BomFormData } from '../components/BomNodeForm';
import { EdcAssetPicker, type EdcAssetOption } from '../components/EdcAssetPicker';
import { FinishedProductBomView } from '../components/FinishedProductBomView';
import { MaterialDetailPanel, type MaterialRecord } from '../components/MaterialDetailPanel';
import { useToast } from '../components/ui/use-toast';
import { useSchemaFields, fieldLabel, fieldUnit } from '../hooks/useSchemaFields';
import { apiFetch } from '../config/api';

// Dynamic record shape driven by YAML schema metadata.
// Fields are `unknown` because the API returns mixed types (strings, numbers, nested
// objects like `chemicalComposition`).  Commonly-accessed string fields are
// explicitly typed so callers don't need casts everywhere.
type DataEntry = Record<string, unknown> & {
  productId: string;
  productName?: string;
  manufacturer?: string;
  materialName?: string;
  recycledContent?: string;
  githubUrl?: string;
  githubRawUrl?: string;
};

// Cache data at module level to persist across component mounts
let cachedData: DataEntry[] | null = null;
let cacheTimestamp: number | null = null;
let cacheProfileKey: string | null = null;
const CACHE_DURATION = 60 * 1000; // 60 seconds

// Profile configuration (hoisted out of component – immutable)
const PROFILE_CONFIGS: Record<string, { name: string; icon: typeof Mountain; description: string; color: string; iconColor: string }> = {
  'raw-material': {
    name: 'Raw Material (ROH)', icon: Mountain,
    description: 'Raw Material Production Data',
    color: 'bg-amber-500/10 dark:bg-amber-500/20 border-amber-500/30',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  'semi-finished-good': {
    name: 'Semi-finished Good (HALB)', icon: Flame,
    description: 'Semi-finished Good Material Data (VDA 231-301)',
    color: 'bg-orange-500/10 dark:bg-orange-500/20 border-orange-500/30',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
  'medical-device': {
    name: 'Medical Device (END)', icon: Heart,
    description: 'Medical Device Registry Data',
    color: 'bg-red-500/10 dark:bg-red-500/20 border-red-500/30',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  'finished-product': {
    name: 'Finished Product (FERT)', icon: PenTool,
    description: 'Finished Product BOM Data',
    color: 'bg-indigo-500/10 dark:bg-indigo-500/20 border-indigo-500/30',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
  },
} as const;

const DEFAULT_PROFILE = {
  name: 'Unknown Profile', icon: Mountain,
  description: 'Data Overview',
  color: 'bg-gray-500/10 dark:bg-gray-500/20 border-gray-500/30',
  iconColor: 'text-gray-600 dark:text-gray-400',
} as const;

/** Persist table data to sessionStorage for instant subsequent loads within the same session */
function persistToStorage(profileKey: string, items: DataEntry[]) {
  try {
    const payload = { data: items, ts: Date.now(), profile: profileKey };
    sessionStorage.setItem('tableCache', JSON.stringify(payload));
  } catch { /* storage full – ignore */ }
}

/** Read cached table data from sessionStorage (keyed by profile) */
function readFromStorage(profileKey: string): DataEntry[] | null {
  try {
    const raw = sessionStorage.getItem('tableCache');
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (payload.profile !== profileKey) return null;
    // Accept sessionStorage cache up to 5 min
    if (Date.now() - payload.ts > 5 * 60 * 1000) return null;
    return payload.data as DataEntry[];
  } catch { return null; }
}

/** Schema field names shown in the semi-finished-good table (VDA 231-301 subset). */
const SEMI_FINISHED_TABLE_FIELDS = ['materialNumber', 'alloyGroup', 'classificationSubclass', 'crmaStatus'] as const;

// Pure material-type helpers – module-scope so they are never recreated between renders
function getMaterialTypeBadgeVariant(materialType: string): 'default' | 'secondary' | 'outline' {
  if (materialType === 'ROH') return 'default';
  if (materialType === 'HALB') return 'secondary';
  return 'outline';
}

function getMaterialTypeLabel(materialType: string): string {
  const LABELS: Record<string, string> = {
    ROH: 'Raw Material', HALB: 'Semi-Finished', FERT: 'Finished Product',
    HAWA: 'Trading Goods', NVAL: 'Non-Valuated',
  };
  return LABELS[materialType] ?? materialType;
}

type ProfileConfig = {
  name: string;
  icon: LucideIcon;
  description: string;
  color: string;
  iconColor: string;
};

type TablePageContentProps = {
  appProfile: string;
  configId: string | null;
  dataFolder: string;
  profileConfig: ProfileConfig;
};

export function TablePage() {
  const { appProfile, configId, dataFolder } = useAppProfile();
  const profileConfig = PROFILE_CONFIGS[appProfile] || DEFAULT_PROFILE;

  // ── Medical-Device BOM view ──────────────────────────────────
  if (appProfile === 'medical-device') {
    return <MedicalDeviceBomView profileConfig={profileConfig} configId={configId} dataFolder={dataFolder} />;
  }

  // ── Finished-Product BOM view ──────────────────────────────────
  if (appProfile === 'finished-product') {
    return <FinishedProductBomView profileConfig={profileConfig} configId={configId} dataFolder={dataFolder} />;
  }

  return <TablePageContent appProfile={appProfile} configId={configId} dataFolder={dataFolder} profileConfig={profileConfig} />;
}

function TablePageContent({ appProfile, configId, dataFolder, profileConfig }: TablePageContentProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // ── Instant render: pre-fill from module cache → sessionStorage ──
  const [data, setData] = useState<DataEntry[]>(() => {
    if (cachedData) return cachedData;
    const pk = `${appProfile}:${configId || 'default'}:${dataFolder || 'products'}`;
    const stored = readFromStorage(pk);
    if (stored && stored.length > 0) {
      cachedData = stored;
      cacheTimestamp = Date.now();
      cacheProfileKey = pk;
      return stored;
    }
    return [];
  });
  // loadDataRef keeps the invalidation interval from capturing a stale loadData closure
  const loadDataRef = useRef<(force?: boolean) => Promise<void>>(() => Promise.resolve());
  const loadSequenceRef = useRef(0);
  const activeProfileKeyRef = useRef('');
  // Precompute profile key once per dependency change (used by loadData + useEffect)
  const profileKey = useMemo(
    () => `${appProfile}:${configId || 'default'}:${dataFolder || 'products'}`,
    [appProfile, configId, dataFolder],
  );
  activeProfileKeyRef.current = profileKey;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<DataEntry | null>(null);
  const [loading, setLoading] = useState(() => !cachedData || cachedData.length === 0);
  const [loadingTime, setLoadingTime] = useState<number | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<DataEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialRecord | null>(null);
  const [materialClassifications, setMaterialClassifications] = useState<Record<string, { material_type: string; confidence: number; reason: string; source: string; loading?: boolean }>>({});
  // materialClassificationsRef lets async callbacks see fresh materialClassifications without stale closures
  const materialClassificationsRef = useRef(materialClassifications);
  materialClassificationsRef.current = materialClassifications;
  const { toast } = useToast();
  const { isDarkMode } = useTheme();

  // Dynamic schema fields from YAML metadata
  const { schemaFields, loading: schemaLoading } = useSchemaFields();
  // Schema fields for table columns (skip productId and productName – they have their own static columns)
  const dynamicFields = useMemo(() => {
    const base = schemaFields.filter(f => {
      if (f.field === 'productId' || f.field === 'productName') return false;
      if (appProfile === 'semi-finished-good') return (SEMI_FINISHED_TABLE_FIELDS as readonly string[]).includes(f.field);
      return true;
    });
    // Inject computed crmaStatus column for semi-finished-good profile
    if (appProfile === 'semi-finished-good' && !base.some(f => f.field === 'crmaStatus')) {
      base.push({ field: 'crmaStatus', type: 'str', source: 'rule-based', description: 'EU Critical Raw Materials Act status' });
    }
    return base;
  }, [schemaFields, appProfile]);

  // Clear selected material when switching profiles (prevents stale side-panel state)
  useEffect(() => {
    setSelectedMaterial(null);
  }, [appProfile]);

  const loadData = async (forceRefresh = false) => {
    const startTime = performance.now();
    const requestSequence = ++loadSequenceRef.current;
    const requestProfileKey = profileKey;
    const isCurrentRequest = () => (
      requestSequence === loadSequenceRef.current &&
      activeProfileKeyRef.current === requestProfileKey
    );
    try {
      // Check if data was invalidated by another component (e.g., DataForm submit)
      const lastInvalidated = sessionStorage.getItem('dataInvalidated');
      const cacheNeedsRefresh = lastInvalidated && cacheTimestamp && 
        parseInt(lastInvalidated) > cacheTimestamp;
      
      // ── Tier 1: module-level memory cache ──
      const now = Date.now();
      if (!forceRefresh && !cacheNeedsRefresh && cachedData && cacheTimestamp && 
          cacheProfileKey === profileKey &&
          (now - cacheTimestamp < CACHE_DURATION)) {
        setData(cachedData);
        setLoading(false);
        setIsCached(true);
        const duration = performance.now() - startTime;
        setLoadingTime(duration);
        return;
      }

      // ── Tier 2: sessionStorage cache (survives page reload within session) ──
      if (!forceRefresh && !cacheNeedsRefresh) {
        const stored = readFromStorage(profileKey);
        if (stored && stored.length > 0) {
          if (!isCurrentRequest()) return;
          setData(stored);
          cachedData = stored;
          cacheTimestamp = Date.now();
          cacheProfileKey = profileKey;
          setLoading(false);
          setIsCached(true);
          setLoadingTime(performance.now() - startTime);
          return;
        }
      }
      
      // If cache was just updated (< 2 seconds ago), wait a bit before reloading
      // This gives handleSuccess time to add final data to the list
      if (cacheTimestamp && (now - cacheTimestamp < 2000)) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setLoading(true);
      setIsCached(false);
      
      const params = new URLSearchParams();
      if (forceRefresh) params.set('force', 'true');
      if (configId) params.set('config_id', configId);
      if (dataFolder) params.set('folder', dataFolder);
      const url = `/api/list-products${params.toString() ? '?' + params.toString() : ''}`;
      

      
      const response = await apiFetch(url);
      if (!isCurrentRequest()) return;
      
      if (response.ok) {
        const result = await response.json();
        if (!isCurrentRequest()) return;
        let newData = Array.isArray(result.data) ? result.data : [];
        
        // Merge with optimistic updates from sessionStorage
        const optimisticData = sessionStorage.getItem('optimisticProducts');
        if (optimisticData) {
          try {
            const optimisticItems: DataEntry[] = JSON.parse(optimisticData);
            const now = Date.now();
            
            // Create lookup for server products by productId AND by name+manufacturer
            const serverProductIds = new Set(newData.map((item: DataEntry) => item.productId).filter(Boolean));
            const serverProductKeys = new Set(newData.map((item: DataEntry) => {
              const key = `${item.productName}|||${item.manufacturer}`.toLowerCase().trim();
              return key;
            }));
            
            const stillPending = optimisticItems.filter((item: any) => {
              // Remove if older than 3 minutes (jobs should complete faster, but give more time)
              const age = now - (item._timestamp || 0);
              if (age > 180000) { // Increased from 90s to 180s (3 minutes)
                return false;
              }
              
              // Remove if productId now exists on server (even if it was a temp-ID)
              if (item.productId && serverProductIds.has(item.productId)) {
                return false;
              }
              
              // Remove if same product exists on server (by name+manufacturer)
              const key = `${item.productName}|||${item.manufacturer}`.toLowerCase().trim();
              if (serverProductKeys.has(key)) {
                return false;
              }
              
              // Remove if not pending anymore (has real URL)
              if (item.githubUrl && item.githubUrl !== 'pending') {
                return false;
              }
              
              return true;
            });
            
            // Merge: optimistic items first (so they appear at top)
            newData = [...stillPending, ...newData];
            
            // DEDUPLICATE: Remove any duplicates by productId (keep first occurrence - from stillPending)
            const seen = new Set<string>();
            newData = newData.filter((item: DataEntry) => {
              if (!item.productId) return true; // Keep items without productId
              if (seen.has(item.productId)) {

                return false;
              }
              seen.add(item.productId);
              return true;
            });
            
            // Clean up sessionStorage
            if (stillPending.length !== optimisticItems.length) {
              if (stillPending.length === 0) {
                sessionStorage.removeItem('optimisticProducts');
              } else {
                sessionStorage.setItem('optimisticProducts', JSON.stringify(stillPending));
              }
            }
          } catch (e) {
            console.error('Error parsing optimistic data:', e);
            sessionStorage.removeItem('optimisticProducts');
          }
        }
        
        // Merge with pending edits from sessionStorage (edits that haven't synced yet)
        const pendingEditsData = sessionStorage.getItem('pendingEdits');
        if (pendingEditsData) {
          try {
            const pendingEdits: DataEntry[] = JSON.parse(pendingEditsData);
            const now = Date.now();
            
            // Filter out old edits (older than 30 seconds)
            const recentEdits = pendingEdits.filter((edit: any) => {
              const age = now - (edit._editTimestamp || 0);
              return age < 30000;
            });
            
            // Apply pending edits to server data – Map for O(1) lookup instead of O(n) find
            if (recentEdits.length > 0) {
              const editMap = new Map<string, DataEntry>(recentEdits.map((e: any) => [e.productId, e]));
              newData = newData.map((item: DataEntry) => {
                const edit = editMap.get(item.productId);
                return edit ? { ...edit } : item;
              });
            }
            
            // Clean up old edits
            if (recentEdits.length !== pendingEdits.length) {
              if (recentEdits.length === 0) {
                sessionStorage.removeItem('pendingEdits');
              } else {
                sessionStorage.setItem('pendingEdits', JSON.stringify(recentEdits));
              }
            }
          } catch (e) {
            console.error('Error parsing pending edits:', e);
            sessionStorage.removeItem('pendingEdits');
          }
        }
        
        // Note: Legacy githubUrl generation removed — individual product files
        // are no longer written to GitHub (only the aggregated JSON).  A proper
        // URL can only be constructed once we know the aggregated file path +
        // anchor scheme.  Until then, entries without githubUrl keep it empty.
        
        // Only call setData ONCE to prevent multiple useEffect triggers
        setData(newData);
        setIsCached(result.cached || false);
        cachedData = newData;
        cacheTimestamp = Date.now();
        cacheProfileKey = profileKey;
        persistToStorage(profileKey, newData);
      } else if (response.status === 404) {
        // No products yet, show empty table
        if (!isCurrentRequest()) return;
        setData([]);
        cachedData = [];
        cacheTimestamp = Date.now();
        cacheProfileKey = profileKey;
      } else {
        throw new Error('Failed to load data');
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      console.error('Error loading data:', error);
      toast({
        title: "Error",
        description: "Failed to load data from repository",
        variant: "destructive",
      });
      setData([]);
    } finally {
      if (!isCurrentRequest()) return;
      const duration = performance.now() - startTime;
      setLoadingTime(duration);
      setLoading(false);
    }
  };
  // Keep the ref current so the invalidation interval always calls the fresh version
  loadDataRef.current = loadData;

  useEffect(() => {
    // For non-default profiles, wait until configId is resolved from the backend
    const isDefault = appProfile === 'raw-material';
    if (!isDefault && !configId) {
      setLoading(true);
      return;
    }

    // If module cache matches this profile, skip network entirely
    if (cachedData && cacheProfileKey === profileKey && cacheTimestamp &&
        Date.now() - cacheTimestamp < CACHE_DURATION) {
      setData(cachedData);
      setLoading(false);
      setIsCached(true);
      return;
    }

    // Profile switched → clear stale module cache
    cachedData = null;
    cacheTimestamp = null;

    // Instant show from sessionStorage (stale-while-revalidate)
    const stored = readFromStorage(profileKey);
    if (stored && stored.length > 0) {
      setData(stored);
      cachedData = stored;
      cacheTimestamp = Date.now();
      cacheProfileKey = profileKey;
      setIsCached(true);
      setLoading(false);
      // Background refresh — will silently update if data changed
      loadData();
      return;
    }

    // No cache at all — show spinner & fetch
    setData([]);
    loadData();
  }, [appProfile, configId, dataFolder]);

  // Fallback: Check if dataInvalidated was set (e.g., by pollJobStatus timeout)
  // This only runs once when needed, not continuously
  useEffect(() => {
    const checkInvalidation = () => {
      const invalidated = sessionStorage.getItem('dataInvalidated');
      if (invalidated && cacheTimestamp && parseInt(invalidated) > cacheTimestamp) {
        sessionStorage.removeItem('dataInvalidated');
        loadDataRef.current(true);
      }
    };
    
    // Check every 5 seconds for invalidation flag
    const interval = setInterval(checkInvalidation, 5000);
    return () => clearInterval(interval);
  }, []); // intentionally empty – loadDataRef always points to the current loadData

  const handleDialogClose = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditItem(null);
    }
  };

  const handleSuccess = (savedData: DataEntry) => {
    
    // ============================================
    // HANDLE EDITS (existing items being updated)
    // ============================================
    if (editItem) {

      
      // Replace the old item with the updated data
      const newData = data.map(item => 
        item.productId === editItem.productId ? savedData : item
      );
      

      setData(newData);
      cachedData = newData;
      cacheTimestamp = Date.now();
      if (cacheProfileKey) persistToStorage(cacheProfileKey, newData);
      
      // Mark that we just did an edit (prevent auto-refresh from interfering)
      const editTimestamp = Date.now();
      sessionStorage.setItem('lastEditTimestamp', editTimestamp.toString());
      
      // Store pending edit in sessionStorage so it persists within the session
      // This ensures the user sees their edit even if server hasn't synced yet
      const pendingEdits = JSON.parse(sessionStorage.getItem('pendingEdits') || '[]');
      const existingIndex = pendingEdits.findIndex((e: any) => e.productId === savedData.productId);
      const pendingEdit = { ...savedData, _editTimestamp: editTimestamp };
      if (existingIndex >= 0) {
        pendingEdits[existingIndex] = pendingEdit;
      } else {
        pendingEdits.push(pendingEdit);
      }
      sessionStorage.setItem('pendingEdits', JSON.stringify(pendingEdits));

      
      // Clear pending edit after 30 seconds (worker should be done by then)
      setTimeout(() => {
        const edits = JSON.parse(sessionStorage.getItem('pendingEdits') || '[]');
        const filtered = edits.filter((e: any) => e._editTimestamp !== editTimestamp);
        sessionStorage.setItem('pendingEdits', JSON.stringify(filtered));

      }, 30000);
      

      
      // Clear edit timestamp after 15 seconds
      setTimeout(() => {
        const recentEdit = sessionStorage.getItem('lastEditTimestamp');
        if (recentEdit && parseInt(recentEdit) === editTimestamp) {
          sessionStorage.removeItem('lastEditTimestamp');

        }
      }, 15000);
      
      setIsDialogOpen(false);
      return;
    }
    
    // ============================================
    // HANDLE NEW ITEMS with final GitHub URL
    // ============================================
    const isFinal = savedData.githubUrl && savedData.githubUrl !== 'pending' && savedData.githubUrl.startsWith('http');
    
    if (isFinal) {

      
      // Remove any temp/pending entries that match
      const filteredData = data.filter(item => {
        if (item.githubUrl === 'pending') {
          if (item.productName === savedData.productName && item.manufacturer === savedData.manufacturer) {

            return false;
          }
          if (item.productId && item.productId.startsWith('temp-')) {

            return false;
          }
        }
        return true;
      });
      
      // Add final data
      const newData = [...filteredData, savedData];

      setData(newData);
      cachedData = newData;
      cacheTimestamp = Date.now();
      if (cacheProfileKey) persistToStorage(cacheProfileKey, newData);
      
      // DON'T set dataInvalidated - data is already inserted locally!
      // Setting it would trigger a second reload from auto-refresh

      
      setIsDialogOpen(false);
      return;
    }
    
    // ============================================
    // HANDLE NEW ITEMS with temp/pending status
    // ============================================

    const newData = [...data, savedData];
    
    setData(newData);
    cachedData = newData;
    cacheTimestamp = Date.now();
    if (cacheProfileKey) persistToStorage(cacheProfileKey, newData);
    
    // pollJobStatus will call onSuccess again with final data when job completes

    setIsDialogOpen(false);
  };

  const handleEdit = (item: DataEntry) => {
    setEditItem(item);
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (item: DataEntry) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;

    setIsDeleting(true);
    
    // Save the product ID before clearing itemToDelete
    const productIdToDelete = itemToDelete.productId;
    
    // Optimistic update: remove from UI immediately
    const newData = data.filter(item => item.productId !== productIdToDelete);
    setData(newData);
    
    // Update in-memory cache (but NOT persistent storage yet)
    cachedData = newData;
    cacheTimestamp = Date.now();
    
    // Close dialog immediately for better UX
    setDeleteDialogOpen(false);
    setItemToDelete(null);
    setIsDeleting(false);
    
    // Show optimistic success
    toast({
      title: "Deleted",
      description: "Removing from GitHub in background...",
    });
    
    // Perform actual delete in background
    try {
      const delParams = new URLSearchParams();
      if (configId) delParams.set('config_id', configId);
      if (dataFolder) delParams.set('folder', dataFolder);
      const delUrl = `/api/delete-product/${encodeURIComponent(productIdToDelete)}${delParams.toString() ? '?' + delParams.toString() : ''}`;
      const response = await apiFetch(delUrl, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete product');
      }

      // GitHub delete succeeded — now persist cache
      if (cacheProfileKey) persistToStorage(cacheProfileKey, newData);
      
    } catch (error) {
      console.error('Error deleting product:', error);
      
      // Rollback: add the item back to UI and restore cache
      const restored = [...newData, itemToDelete].sort((a, b) =>
        a.productId.localeCompare(b.productId)
      );
      setData(restored);
      cachedData = restored;
      cacheTimestamp = Date.now();
      if (cacheProfileKey) persistToStorage(cacheProfileKey, restored);
      
      toast({
        title: "Delete failed",
        description: "Product restored - could not remove from GitHub",
        variant: "destructive",
      });
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setItemToDelete(null);
  };

  const handlePublishToEdc = async (item: DataEntry) => {
    try {
      const response = await apiFetch('/api/edc/publish-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            ...item,
            productName: item.productName || item.productId,
            githubUrl: item.githubUrl || '',
          },
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(err.detail || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const isPending = result.status === 'pending';

      toast({
        title: isPending ? 'Registered (pending)' : 'Published to EDC',
        description: isPending
          ? `${item.productName || item.productId} registered locally — will sync when EDC is connected`
          : `${item.productName || item.productId} is now available in the dataspace`,
      });
    } catch (error) {
      toast({
        title: 'Registration failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleDownload = async (productId: string, format: 'standard' | 'aas') => {
    try {
      // On-demand export: backend generates JSON-LD / AAS from aggregated data
      const endpoint = format === 'aas'
        ? `/api/export/aas/${encodeURIComponent(productId)}`
        : `/api/export/jsonld/${encodeURIComponent(productId)}`;
      
      const params = new URLSearchParams();
      if (configId) params.set('config_id', configId);
      if (dataFolder) params.set('folder', dataFolder);
      const url = params.toString() ? `${endpoint}?${params}` : endpoint;

      const response = await apiFetch(url);
      
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(err.detail || 'Download failed');
      }
      
      const jsonData = await response.json();
      const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = format === 'aas' ? `${productId}-aas.json` : `${productId}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
      
      toast({
        title: "Download successful",
        description: `Downloaded ${format === 'aas' ? 'AAS' : 'JSON-LD'} file`,
      });
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Could not download file",
        variant: "destructive",
      });
    }
  };

  const filteredData = useMemo(() => data.filter((item) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    if ((item.productId || '').toLowerCase().includes(q)) return true;
    if ((item.productName || '').toLowerCase().includes(q)) return true;
    // Search all schema fields (not just visible dynamicFields)
    for (const f of schemaFields) {
      const raw = item[f.field] || '';
      const val = (typeof raw === 'object' ? JSON.stringify(raw) : String(raw)).toLowerCase();
      if (val.includes(q)) return true;
      const unit = fieldUnit(f);
      if (unit && `${val}${unit === '%' ? '%' : ` ${unit}`}`.includes(q)) return true;
    }
    return false;
  }), [data, searchQuery, schemaFields]);

  const highlightText = useCallback((text: string, query: string) => {
    if (!query.trim()) return text;
    
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    const parts = text.split(regex);
    const lowerQuery = query.toLowerCase();
    
    return (
      <>
        {parts.map((part, index) => {
          const isMatch = part.toLowerCase() === lowerQuery;
          return isMatch ? (
            <mark key={index} className="bg-yellow-200 dark:bg-yellow-900 dark:text-yellow-100 px-0.5 rounded">
              {part}
            </mark>
          ) : (
            <span key={index}>{part}</span>
          );
        })}
      </>
    );
  }, []);

  // Fetch persistent material classifications from server cache on mount
  useEffect(() => {
    apiFetch('/api/material-classifications')
      .then(res => res.ok ? res.json() : {})
      .then(cached => {
        if (Object.keys(cached).length > 0) {
          setMaterialClassifications(prev => ({ ...cached, ...prev }));
        }
      })
      .catch(() => { /* server cache unavailable — will classify on demand */ });
  }, []);

  // Material type classification
  const classifyProduct = async (item: DataEntry) => {
    const key = item.productId;

    setMaterialClassifications(prev => {
      // Skip if already classified (cached) or currently loading
      if (prev[key] && !prev[key].loading && prev[key].material_type !== '...' && prev[key].material_type !== '–') return prev;
      return {
        ...prev,
        [key]: { material_type: '...', confidence: 0, reason: '', source: '', loading: true },
      };
    });

    // Double-check via ref (avoids stale closure over materialClassifications state)
    const existing = materialClassificationsRef.current[key];
    if (existing && !existing.loading && existing.material_type !== '...' && existing.material_type !== '–') return;

    try {
      const response = await apiFetch('/api/classify-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: item.productId,
          productName: item.productName,
          materialName: item.materialName,
          manufacturer: item.manufacturer,
          recycledContent: item.recycledContent,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setMaterialClassifications(prev => ({
          ...prev,
          [key]: { ...result, loading: false },
        }));
      }
    } catch (error) {
      console.warn('Material classification failed for', key, error);
      setMaterialClassifications(prev => ({
        ...prev,
        [key]: { material_type: '–', confidence: 0, reason: 'Classification failed', source: 'error', loading: false },
      }));
    }
  };

  // Auto-classify products that have no cached result (batched to improve speed)
  useEffect(() => {
    if (data.length > 0) {
      const unclassified = data.filter(
        item => item.productId && (
          !materialClassifications[item.productId] ||
          materialClassifications[item.productId].material_type === '–' // retry errors
        )
      );

      if (unclassified.length === 0) return;

      let cancelled = false;
      const BATCH_SIZE = 3; // Classify 3 products in parallel

      const classifyInBatches = async () => {
        for (let i = 0; i < unclassified.length; i += BATCH_SIZE) {
          if (cancelled) break;
          const batch = unclassified.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(item => classifyProduct(item)));
        }
      };
      classifyInBatches();

      return () => { cancelled = true; };
    }
  }, [data]);

  // While schema fields are loading, show the full header chrome with a loading indicator
  // in the table area to avoid layout shift and keep UX consistent across profiles
  if (schemaLoading && dynamicFields.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b bg-background px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <profileConfig.icon className={`h-6 w-6 ${profileConfig.iconColor}`} />
                <h1 className="text-2xl font-bold tracking-tight">{profileConfig.name}</h1>
              </div>
            </div>
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={appProfile === 'semi-finished-good' ? 'Search by material ID, name or alloy...' : 'Search by product ID, name or material...'}
                disabled
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-2" disabled>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button size="sm" className="gap-2" disabled>
                <Plus className="h-4 w-4" />
                Add Data
              </Button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <Card>
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading data...
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header Section */}
        <div className="border-b bg-background px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <profileConfig.icon className={`h-6 w-6 ${profileConfig.iconColor}`} />
                <h1 className="text-2xl font-bold tracking-tight">{profileConfig.name}</h1>
              </div>
              {loadingTime !== null && (
                <span className="text-sm text-muted-foreground">
                  Loaded in {loadingTime.toFixed(0)}ms
                  {isCached && " (cached)"}
                </span>
              )}
            </div>
            
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={appProfile === 'semi-finished-good' ? 'Search by material ID, name or alloy...' : 'Search by product ID, name or material...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex gap-2">
              <Button 
                size="sm" 
                variant="outline" 
                className="gap-2" 
                onClick={() => {

                  cachedData = null;
                  cacheTimestamp = null;
                  // Clear session cache too
                  sessionStorage.removeItem('tableCache');
                  loadData(true);
                }}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              
              <Button size="sm" className="gap-2" onClick={() => {
                setEditItem(null);
                setIsDialogOpen(true);
              }}>
                <Plus className="h-4 w-4" />
                Add Data
              </Button>
            </div>
          </div>
        </div>

        {/* Table Section + Material Detail Panel */}
        <div className="flex-1 overflow-hidden flex">
        <div className={`flex-1 overflow-auto p-6 transition-[padding-right] duration-200 ${selectedMaterial ? 'pr-0' : ''}`}>
          <Card>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-muted-foreground">Loading data...</div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {appProfile === 'semi-finished-good' ? 'Material Name' : 'Product Name'}
                    </TableHead>
                    {appProfile !== 'semi-finished-good' && <TableHead>
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-purple-500" />
                        Material Type
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="inline-flex items-center">
                              <Info className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-foreground" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80">
                            <div className="space-y-2">
                              <h4 className="font-medium leading-none">AI-Based Material Classification</h4>
                              <p className="text-sm text-muted-foreground">
                                Automatically classified using local AI (Ollama). The material type determines how a material is managed in an ERP system (procurement, inventory, valuation).
                              </p>
                              <div className="text-xs text-muted-foreground pt-2 border-t space-y-1">
                                <div><strong>ROH</strong> – Raw Material (Rohstoff)</div>
                                <div><strong>HALB</strong> – Semi-Finished (Halbfabrikat)</div>
                                <div><strong>FERT</strong> – Finished Product (Fertigerzeugnis)</div>
                                <div><strong>HAWA</strong> – Trading Goods (Handelsware)</div>
                                <div><strong>NVAL</strong> – Non-Valuated Material</div>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>}
                    {/* Dynamic schema-driven column headers */}
                    {dynamicFields.map((f) => {
                      const label = fieldLabel(f.field);
                      const unit = fieldUnit(f);
                      const headerText = unit ? `${label} [${unit}]` : label;
                      return (
                        <TableHead key={f.field}>
                          <div className="flex items-center gap-2">
                            {headerText}
                            {f.description && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="inline-flex items-center">
                                    <Info className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-foreground" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80">
                                  <div className="space-y-2">
                                    <h4 className="font-medium leading-none">{label}</h4>
                                    <p className="text-sm text-muted-foreground">{f.description}</p>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                        </TableHead>
                      );
                    })}
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.length > 0 ? (
                    filteredData.map((item) => (
                      <TableRow
                        key={item.productId}
                        className={
                          appProfile === 'semi-finished-good'
                            ? `cursor-pointer transition-colors ${
                                selectedMaterial?.productId === item.productId
                                  ? 'bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-950/40'
                                  : 'hover:bg-muted/50'
                              }`
                            : undefined
                        }
                        onClick={
                          appProfile === 'semi-finished-good'
                            ? () => setSelectedMaterial(
                                selectedMaterial?.productId === item.productId
                                  ? null
                                  : (item as MaterialRecord)
                              )
                            : undefined
                        }
                      >
                        {/* Product Name (first column) */}
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {item.githubUrl && item.githubUrl !== 'pending' && item.githubUrl.startsWith('http') ? (
                                <a
                                  href={item.githubUrl.replace(/[^/]+$/, 'products.json')}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium truncate max-w-[240px] inline-block text-blue-600 dark:text-blue-400 hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {item.productName ? highlightText(String(item.productName), searchQuery) : <span className="text-muted-foreground text-xs">—</span>}
                                </a>
                              ) : (
                                <span className="font-medium cursor-help truncate max-w-[240px] inline-block">
                                  {item.productName ? highlightText(String(item.productName), searchQuery) : <span className="text-muted-foreground text-xs">—</span>}
                                </span>
                              )}
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs font-mono">Product ID: {item.productId}</p>
                              {item.githubUrl && typeof item.githubUrl === 'string' && item.githubUrl.startsWith('http') && (
                                <p className="text-xs text-blue-400 mt-1 break-all">{item.githubUrl.replace(/[^/]+$/, 'products.json')}</p>
                              )}
                              {item.githubUrl === 'pending' && <p className="text-xs text-yellow-400 mt-1">GitHub sync in progress</p>}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        {/* Material Type */}
                        {appProfile !== 'semi-finished-good' && <TableCell>
                          {(() => {
                            const classification = materialClassifications[item.productId];
                            if (!classification || classification.loading) {
                              return (
                                <div className="flex items-center gap-1.5">
                                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">Classifying...</span>
                                </div>
                              );
                            }
                            return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1.5 cursor-help">
                                      {classification.source?.startsWith('local-ai') ? (
                                        <Sparkles className="h-3 w-3 text-purple-400" />
                                      ) : (
                                        <ListChecks className="h-3 w-3 text-sky-400" />
                                      )}
                                      <Badge variant={getMaterialTypeBadgeVariant(classification.material_type)} className="text-xs font-mono">
                                        {classification.material_type}
                                      </Badge>
                                      {classification.confidence < 0.9 && (
                                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                                      )}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="space-y-1">
                                      <p className="font-medium text-xs">{getMaterialTypeLabel(classification.material_type)}</p>
                                      <p className="text-xs">{classification.reason}</p>
                                      <p className="text-xs text-muted-foreground">
                                        Confidence: {(classification.confidence * 100).toFixed(0)}% · Source: {classification.source}
                                      </p>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                            );
                          })()}
                        </TableCell>}
                        {/* Dynamic schema-driven cells */}
                        {dynamicFields.map((f) => {
                          const raw = item[f.field] ?? '';

                          /* ── EU CRMA status badge rendering ── */
                          if (f.field === 'crmaStatus') {
                            const status = typeof raw === 'string' ? raw : '';
                            const details = (item as Record<string, unknown>).crmaDetails as { element: string; cas: string; critical: boolean; strategic: boolean; materialName: string }[] | undefined;
                            return (
                              <TableCell key={f.field}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1">
                                      {(status === 'critical' || status === 'critical+strategic') && (
                                        <Badge className="text-[10px] font-normal border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 hover:bg-red-100">
                                          Critical
                                        </Badge>
                                      )}
                                      {(status === 'strategic' || status === 'critical+strategic') && (
                                        <Badge className="text-[10px] font-normal border-transparent bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300 hover:bg-orange-100">
                                          Strategic
                                        </Badge>
                                      )}
                                      {(!status || status === 'none') && (
                                        <Badge className="text-[10px] font-normal border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
                                          None
                                        </Badge>
                                      )}
                                    </div>
                                  </TooltipTrigger>
                                  {details && details.length > 0 && (
                                    <TooltipContent>
                                      <div className="space-y-1">
                                        <p className="text-xs font-semibold">EU CRMA Matches</p>
                                        {details.map((d, i) => (
                                          <div key={i} className="flex items-center gap-1.5">
                                            <span className="text-xs">{d.element} ({d.materialName}) — CAS {d.cas}</span>
                                            {d.critical && (
                                              <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-red-100 dark:bg-red-950 text-[9px] font-bold text-red-700 dark:text-red-300 shrink-0">c</span>
                                            )}
                                            {d.strategic && (
                                              <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-orange-100 dark:bg-orange-950 text-[9px] font-bold text-orange-700 dark:text-orange-300 shrink-0">s</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              </TableCell>
                            );
                          }

                          const val: string = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
                          const unit = fieldUnit(f);
                          const display = val
                            ? unit
                              ? unit === '%' ? `${val}%` : `${val} ${unit}`
                              : val
                            : '';
                          return (
                            <TableCell key={f.field}>
                              {display ? highlightText(display, searchQuery) : <span className="text-muted-foreground text-xs">—</span>}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-blue-50 dark:hover:bg-blue-950"
                                    onClick={() => handleDownload(item.productId, 'standard')}
                                  >
                                    <Braces className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs font-semibold">Download JSON-LD</p>
                                  <p className="text-xs text-muted-foreground">Linked Data Format</p>
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 hover:bg-green-50 dark:hover:bg-green-950"
                                    onClick={() => handleDownload(item.productId, 'aas')}
                                  >
                                    <img 
                                      src={isDarkMode ? aasLogoDark : aasLogoLight} 
                                      alt="AAS" 
                                      className="h-6 w-6 object-contain"
                                    />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs font-semibold">Download AAS JSON</p>
                                  <p className="text-xs text-muted-foreground">Asset Administration Shell</p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Submodel:{' '}
                                    {appProfile === 'semi-finished-good'
                                      ? 'MaterialComposition (based on VDA 231-301)'
                                      : 'MaterialInformation + SustainabilityInformation'}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                  <span className="sr-only">Open menu</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleEdit(item)}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handlePublishToEdc(item)}>
                                  <ArrowRight className="mr-2 h-4 w-4" />
                                  Provide to EDC
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled>
                                  <ArrowLeft className="mr-2 h-4 w-4" />
                                  Consume from EDC
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onClick={() => handleDeleteClick(item)}
                                  className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-300 focus:bg-red-50 dark:focus:bg-red-950/50"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={dynamicFields.length + (appProfile === 'semi-finished-good' ? 2 : 3)} className="text-center py-8 text-muted-foreground">
                        {searchQuery ? 'No data found matching your search' : appProfile === 'semi-finished-good' ? 'No materials available. Click "Add Data" to create entries.' : 'No products available. Click "Add Data" to create entries.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        {/* Material Detail Side Panel (semi-finished-good only) */}
        {appProfile === 'semi-finished-good' && (
          <MaterialDetailPanel
            material={selectedMaterial}
            onClose={() => setSelectedMaterial(null)}
          />
        )}
        </div>
      </div>

      {/* Add/Edit Data Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto top-[5%] translate-y-0" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Material Data' : 'Add Material Data'}</DialogTitle>
          </DialogHeader>
          {isDialogOpen && (
            <DataForm 
              key={editItem ? editItem.productId : 'new'} 
              editData={editItem as import('../components/DataForm').FormData | null}
              onSuccess={handleSuccess} 
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{appProfile === 'semi-finished-good' ? 'Delete Material' : 'Delete Product'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete this {appProfile === 'semi-finished-good' ? 'material' : 'product'}? This action cannot be undone.
            </p>
            {itemToDelete && (
              <div className="rounded-lg border p-4 space-y-2 bg-muted/50">
                <div className="font-medium text-sm">{appProfile === 'semi-finished-good' ? 'Material Details:' : 'Product Details:'}</div>
                <div className="text-sm space-y-1">
                  <div><span className="text-muted-foreground">ID:</span> {itemToDelete.productId}</div>
                  <div><span className="text-muted-foreground">Name:</span> {itemToDelete.productName}</div>
                  <div><span className="text-muted-foreground">Manufacturer:</span> {itemToDelete.manufacturer}</div>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={handleDeleteCancel}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


// ── Medical-Device BOM sub-view ──────────────────────────────────
// Extracted as a separate component to keep TablePage's hook rules
// clean (the early-return for medical-device must not skip hooks).

interface MedicalDeviceBomViewProps {
  profileConfig: (typeof PROFILE_CONFIGS)[string];
  configId: string | null;
  dataFolder: string;
}

function MedicalDeviceBomView({ profileConfig, configId, dataFolder }: MedicalDeviceBomViewProps) {
  const { isDarkMode } = useTheme();
  const { toast } = useToast();
  const { schemaFields } = useSchemaFields();

  // Derive assembly type from modelType metadata (first possible_value, or fallback)
  const assemblyType = useMemo(() => {
    const mtField = schemaFields.find(f => f.field === 'modelType');
    return mtField?.possible_values?.[0] || 'Assembly';
  }, [schemaFields]);

  // Data
  const [bomNodes, setBomNodes] = useState<BomNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Dialogs
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEdcPickerOpen, setIsEdcPickerOpen] = useState(false);
  const [editNode, setEditNode] = useState<BomNode | null>(null);
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);
  const [defaultEdcAsset, setDefaultEdcAsset] = useState<EdcAssetOption | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<BomNode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Track recent edits/deletes so refreshes don't overwrite them
  const pendingBomChangesRef = useRef<Map<string, { action: 'edit' | 'delete'; timestamp: number; data?: BomNode }>>(new Map());

  const cleanupPendingChanges = () => {
    const now = Date.now();
    for (const [id, entry] of pendingBomChangesRef.current) {
      if (now - entry.timestamp > 30000) pendingBomChangesRef.current.delete(id);
    }
  };

  // Load BOM data — merges with pending local changes
  const loadBomData = useCallback(async (force = false) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (force) params.set('force', 'true');
      if (configId) params.set('config_id', configId);
      const folder = dataFolder && dataFolder !== 'products' ? dataFolder : 'bom';
      if (folder !== 'products') params.set('folder', folder);
      const url = `/api/list-products${params.toString() ? '?' + params.toString() : ''}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const result = await res.json();
        const serverData: BomNode[] = Array.isArray(result.data) ? result.data : [];
        cleanupPendingChanges();
        const pending = pendingBomChangesRef.current;
        setBomNodes(prev => {
          const localMap = new Map(prev.map(n => [n.productId, n]));
          const merged = serverData
            .filter(sn => {
              const change = pending.get(sn.productId);
              return !(change && change.action === 'delete');
            })
            .map(sn => {
              const change = pending.get(sn.productId);
              if (change && change.action === 'edit') return localMap.get(sn.productId) || sn;
              return sn;
            });
          // Keep optimistic nodes not yet on server
          const serverIds = new Set(serverData.map(n => n.productId));
          const extraLocal = prev.filter(n => !serverIds.has(n.productId) && !(pending.get(n.productId)?.action === 'delete'));
          return [...merged, ...extraLocal];
        });
      }
    } catch (e) {
      console.error('Failed to load BOM data', e);
    } finally {
      setLoading(false);
    }
  }, [configId, dataFolder]);

  useEffect(() => { loadBomData(); }, [loadBomData]);

  // Auto-refresh when job completes — reuse loadBomData which already merges
  useEffect(() => {
    const interval = setInterval(() => {
      if (sessionStorage.getItem('jobJustCompleted')) {
        sessionStorage.removeItem('jobJustCompleted');
        loadBomData(true);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [loadBomData]);

  // ── Handlers ────────────────────────────────────────────────
  const handleEdit = (node: BomNode) => {
    setEditNode(node);
    setDefaultParentId(null);
    setDefaultEdcAsset(null);
    setIsAddOpen(true);
  };

  const handleDelete = (node: BomNode) => {
    setNodeToDelete(node);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!nodeToDelete) return;
    setIsDeleting(true);
    try {
      const params = new URLSearchParams();
      if (configId) params.set('config_id', configId);
      const folder = dataFolder && dataFolder !== 'products' ? dataFolder : 'bom';
      if (folder !== 'products') params.set('folder', folder);
      const delUrl = `/api/delete-product/${encodeURIComponent(nodeToDelete.productId)}${params.toString() ? '?' + params.toString() : ''}`;
      const res = await apiFetch(delUrl, { method: 'DELETE' });
      if (res.ok) {
        toast({ title: 'Deleted', description: `Node "${nodeToDelete.name}" removed` });
        // Track deletion so refresh doesn't bring it back
        pendingBomChangesRef.current.set(nodeToDelete.productId, { action: 'delete', timestamp: Date.now() });
        // Check for children that will become orphaned
        const childCount = bomNodes.filter(n => (n.parentId === nodeToDelete.nodeId) || (n.parentId === nodeToDelete.productId)).length;
        if (childCount > 0) {
          toast({ title: 'Note', description: `${childCount} child node(s) are now orphaned (moved to root level)` });
        }
        setBomNodes(prev => prev.filter(n => n.productId !== nodeToDelete.productId));
      } else {
        const err = await res.json();
        throw new Error(err.detail || 'Delete failed');
      }
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Delete failed', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setNodeToDelete(null);
    }
  };

  const handleAddChild = (parentNode: BomNode | null) => {
    setEditNode(null);
    setDefaultParentId(parentNode ? (parentNode.nodeId || parentNode.productId) : null);
    setDefaultEdcAsset(null);
    setIsAddOpen(true);
  };

  const handleAddEdcAsset = (parentNode: BomNode | null) => {
    setDefaultParentId(parentNode ? (parentNode.nodeId || parentNode.productId) : null);
    setIsEdcPickerOpen(true);
  };

  const handleEdcSelect = (asset: EdcAssetOption) => {
    setIsEdcPickerOpen(false);
    setEditNode(null);
    setDefaultEdcAsset(asset);
    setIsAddOpen(true);
  };

  const handleFormSuccess = (saved: BomFormData) => {
    setIsAddOpen(false);
    setEditNode(null);
    setDefaultParentId(null);
    setDefaultEdcAsset(null);
    // Track this edit so refreshes don't overwrite it
    pendingBomChangesRef.current.set(saved.productId, { action: 'edit', timestamp: Date.now() });
    // Optimistic update
    setBomNodes(prev => {
      const exists = prev.findIndex(n => n.productId === saved.productId);
      if (exists >= 0) {
        const updated = [...prev];
        updated[exists] = saved as unknown as BomNode;
        return updated;
      }
      return [...prev, saved as unknown as BomNode];
    });
  };

  const handleExportAas = async () => {
    try {
      const params = new URLSearchParams();
      if (configId) params.set('config_id', configId);
      const folder = dataFolder && dataFolder !== 'products' ? dataFolder : 'bom';
      params.set('folder', folder);
      const res = await apiFetch(`/api/export/bom-aas?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BillOfMaterial-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Exported', description: 'BOM exported as IDTA 02011-1-0 AAS JSON' });
    } catch (e) {
      toast({ title: 'Export failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <profileConfig.icon className={`h-6 w-6 ${profileConfig.iconColor}`} />
            <h1 className="text-2xl font-bold tracking-tight">{profileConfig.name}</h1>
            <Badge variant="secondary" className="text-xs ml-2">
              IDTA 02011-1-0
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search nodes…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            {/* Refresh */}
            <Button variant="outline" size="sm" onClick={() => loadBomData(true)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {/* Export AAS */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportAas}>
                    <img
                      src={isDarkMode ? aasLogoDark : aasLogoLight}
                      alt="AAS"
                      className="h-4 w-4"
                    />
                    Export AAS
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export Bill of Material as IDTA 02011-1-0 Hierarchical Structures JSON</TooltipContent>
              </Tooltip>
            {/* Add EDC Asset */}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleAddEdcAsset(null)}>
              <Link2 className="h-4 w-4" />
              EDC Asset
            </Button>
            {/* Add Data */}
            <Button size="sm" className="gap-1.5" onClick={() => handleAddChild(null)}>
              <Plus className="h-4 w-4" />
              Add Data
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading && bomNodes.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Loading BOM data…
          </div>
        ) : (
          <BomTreeTable
            nodes={bomNodes}
            searchQuery={searchQuery}
            assemblyType={assemblyType}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onAddChild={handleAddChild}
            onAddEdcAsset={handleAddEdcAsset}
          />
        )}
      </div>

      {/* Add / Edit BOM Node Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editNode ? 'Edit BOM Node' : 'Add BOM Node'}</DialogTitle>
          </DialogHeader>
          <BomNodeForm
            editData={
              editNode
                ? {
                    productId: editNode.productId,
                    nodeId: editNode.nodeId,
                    name: editNode.name,
                    parentId: editNode.parentId || '',
                    modelType: editNode.modelType,
                    quantity: String(editNode.quantity ?? '1'),
                    manufacturer: (editNode.manufacturer as string) || '',
                    materialName: (editNode.materialName as string) || '',
                    weight: (editNode.weight as string) || '',
                    valueType: editNode.valueType || '',
                    propertyValue: editNode.propertyValue || '',
                    description: editNode.description || '',
                    edcAssetId: editNode.edcAssetId || '',
                    edcAssetName: editNode.edcAssetName || '',
                  }
                : null
            }
            defaultParentId={defaultParentId}
            defaultEdcAsset={defaultEdcAsset ? { assetId: defaultEdcAsset.assetId, name: defaultEdcAsset.name } : null}
            existingNodes={bomNodes}
            onSuccess={handleFormSuccess}
          />
        </DialogContent>
      </Dialog>

      {/* EDC Asset Picker Dialog */}
      <Dialog open={isEdcPickerOpen} onOpenChange={setIsEdcPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select EDC Connector Asset</DialogTitle>
          </DialogHeader>
          <EdcAssetPicker
            onSelect={handleEdcSelect}
            onCancel={() => setIsEdcPickerOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete BOM Node</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{nodeToDelete?.name}</strong>?
              {nodeToDelete && bomNodes.some(n => n.parentId === (nodeToDelete.nodeId || nodeToDelete.productId)) && (
                <span className="block mt-2 text-amber-600 dark:text-amber-400">
                  ⚠ This node has children. They will become root-level nodes.
                </span>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteConfirm} disabled={isDeleting}>
                {isDeleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
