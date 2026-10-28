/**
 * FinishedProductBomView — BOM tree table (left) + detail side-panel (right).
 *
 * Renders the Finished Product (FERT) use-case with:
 *   Table columns:  Product ID | Product Name | Material Name | Weight
 *   Side-panel:     Schema-derived identifiers, Material ID, Model Type, BoM-Information
 *
 * The side-panel slides in when a row is clicked.
 */

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import {
  Search,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronDown,
  X,
  PenTool,
  MoreVertical,
  Pencil,
  Trash2,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip';
import { useToast } from './ui/use-toast';
import { useSchemaFields, identifierFields, fieldLabel } from '../hooks/useSchemaFields';
import { apiFetch } from '../config/api';
import { fetchRepoMetadata } from '../contexts/AppProfileContext';
import { buildTree, flattenTree, countDescendantsById, modelTypeBadge } from '../lib/bomTree';
import { getIecClass, buildRdsProduct, computeIecNumbers, IEC_CLASS_DESCRIPTIONS } from '../lib/iec81346';
import { QRCodeSVG } from 'qrcode.react';
import { FinishedProductEditForm } from './FinishedProductEditForm';
import { MaterialCompositionContent } from './MaterialCompositionContent';
import type { BomNode } from './BomTreeTable';

// ── Props ──────────────────────────────────────────────────────

interface FinishedProductBomViewProps {
  profileConfig: { name: string; icon: React.ComponentType<{ className?: string }>; description: string; color: string; iconColor: string };
  configId: string | null;
  dataFolder: string;
}

const DETAIL_GRID_CLASS = 'grid grid-cols-[110px_1fr] gap-y-2.5 gap-x-3 items-baseline';

// ── HALB Material Data (from Semi-finished Good) ───────────────

interface HalbChemicalEntry {
  element: string;
  cas?: string;
  avg?: number;
  min?: number;
  max?: number;
}

interface HalbCrmaEntry {
  element: string;
  cas?: string;
  critical?: boolean;
  strategic?: boolean;
}

interface HalbMaterialData {
  productId?: string;
  productName?: string;
  materialName?: string;
  materialId?: string;
  designation?: string;
  materialNumber?: string;
  alloyGroup?: string;
  nomenclatureStandard?: string;
  classificationStandard?: string;
  classificationCategory?: string;
  classificationClass?: string;
  classificationSubclass?: string;
  compositionStandard?: string;
  compositionUnit?: string;
  chemicalComposition?: HalbChemicalEntry[];
  crmaStatus?: string;
  crmaDetails?: HalbCrmaEntry[];
}

const HALB_PRODUCTS_CACHE_TTL_MS = 2 * 60 * 1000;
const halbProductsCache = new Map<string, { ts: number; entries: HalbMaterialData[] }>();

// ── Component ──────────────────────────────────────────────────

export function FinishedProductBomView({ profileConfig, configId, dataFolder }: FinishedProductBomViewProps) {
  const { schemaFields: _schemaFields } = useSchemaFields(); // trigger metadata fetch
  void _schemaFields;
  const { toast } = useToast();

  // Data
  const [bomNodes, setBomNodes] = useState<BomNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Side panel
  const [selectedNode, setSelectedNode] = useState<BomNode | null>(null);

  useEffect(() => {
    setSelectedNode(null);
  }, [configId, dataFolder]);

  // Tree state
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Edit dialog
  const [editNode, setEditNode] = useState<BomNode | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Delete dialog
  const [nodeToDelete, setNodeToDelete] = useState<BomNode | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Refresh counter for side panel (HALB lookup)
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Load data ───────────────────────────────────────────────
  const loadBomData = useCallback(async (force = false) => {
    try {
      setLoading(true);
      if (force) setRefreshKey(k => k + 1);
      const params = new URLSearchParams();
      if (force) params.set('force', 'true');
      if (configId) params.set('config_id', configId);
      const folder = dataFolder || 'products';
      if (folder !== 'products') params.set('folder', folder);
      const url = `/api/list-products${params.toString() ? '?' + params.toString() : ''}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const result = await res.json();
        const serverData: BomNode[] = Array.isArray(result.data) ? result.data : [];
        setBomNodes(serverData);
        const nodeIds = new Set(serverData.map(n => n.nodeId || n.productId));
        const rootIds = serverData
          .filter(n => !n.parentId || !nodeIds.has(n.parentId))
          .map(n => n.nodeId || n.productId);
        setExpanded(prev =>
          prev.size === 0 ? new Set(rootIds) : prev,
        );
      }
    } catch (e) {
      console.error('Failed to load BOM data', e);
    } finally {
      setLoading(false);
    }
  }, [configId, dataFolder]);

  useEffect(() => {
    // Wait until configId is resolved to avoid fetching another profile's data
    if (!configId) {
      setLoading(true);
      return;
    }
    loadBomData();
  }, [loadBomData, configId]);

  // Auto-refresh on job completion
  useEffect(() => {
    const interval = setInterval(() => {
      if (sessionStorage.getItem('jobJustCompleted')) {
        sessionStorage.removeItem('jobJustCompleted');
        loadBomData(true);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [loadBomData]);

  // ── Tree computations ───────────────────────────────────────
  const tree = useMemo(() => buildTree(bomNodes), [bomNodes]);
  const descendantCounts = useMemo(() => countDescendantsById(tree), [tree]);
  const visibleRows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);

  const filteredRows = useMemo(() => {
    if (!searchQuery?.trim()) return visibleRows;
    const q = searchQuery.toLowerCase();
    const allRows = flattenTree(tree, new Set(bomNodes.map(n => n.nodeId || n.productId)));
    return allRows.filter(
      (n) =>
        n.name?.toLowerCase().includes(q) ||
        (n.nodeId || n.productId)?.toLowerCase().includes(q) ||
        n.modelType?.toLowerCase().includes(q) ||
        n.materialName?.toLowerCase().includes(q),
    );
  }, [visibleRows, searchQuery, tree, bomNodes]);

  const toggleExpand = useCallback((nodeId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(bomNodes.map(n => n.nodeId || n.productId)));
  }, [bomNodes]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  // Combined material coverage + BOM stats in a single O(n) pass over bomNodes
  const { materialCoverage, bomStats } = useMemo(() => {
    if (bomNodes.length === 0) return { materialCoverage: null, bomStats: null };
    let assemblies = 0, components = 0, stdParts = 0, electronicParts = 0;
    let leafTotal = 0, leafAssigned = 0;
    for (const n of bomNodes) {
      const isAssembly = n.hasChildren === 'True';
      if (isAssembly) assemblies++; else components++;
      if (n.modelType === 'SH StdPart') stdParts++;
      else if (n.modelType === 'SH PCB Comp') electronicParts++;
      else if (!isAssembly) {
        leafTotal++;
        if (n.materialName && n.materialName.trim() !== '') leafAssigned++;
      }
    }
    return {
      bomStats: { assemblies, components, stdParts, electronicParts },
      materialCoverage: leafTotal === 0 ? null
        : { assigned: leafAssigned, total: leafTotal, pct: Math.round((leafAssigned / leafTotal) * 100) },
    };
  }, [bomNodes]);

  // IEC 81346 computed numbering + node lookup map
  const iecNumbers = useMemo(() => computeIecNumbers(bomNodes), [bomNodes]);
  const nodeById = useMemo(() => {
    const map = new Map<string, BomNode>();
    for (const n of bomNodes) map.set(n.nodeId || n.productId, n);
    return map;
  }, [bomNodes]);

  const highlightRegex = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return null;
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(${escapedQuery})`, 'gi');
  }, [searchQuery]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const highlightText = useCallback((text: string) => {
    if (!highlightRegex || !normalizedSearchQuery) return text;
    const parts = text.split(highlightRegex);
    return (
      <>
        {parts.map((part, index) => {
          const isMatch = part.toLowerCase() === normalizedSearchQuery;
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
  }, [highlightRegex, normalizedSearchQuery]);

  const handleRowClick = useCallback((node: BomNode) => {
    setSelectedNode(prev => (prev?.productId === node.productId ? null : node));
  }, []);

  // ── Action handlers ─────────────────────────────────────────
  const handleEdit = useCallback((node: BomNode) => {
    setEditNode(node);
    setIsEditOpen(true);
  }, []);

  const handleEditSuccess = useCallback((updatedNode: BomNode) => {
    setBomNodes(prev => prev.map(n => n.productId === updatedNode.productId ? { ...n, ...updatedNode } : n));
    setIsEditOpen(false);
    setEditNode(null);
  }, []);

  const handleProvideToEdc = useCallback(async (node: BomNode) => {
    try {
      const response = await apiFetch('/api/edc/publish-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: {
            productId: node.productId,
            productName: node.name || node.productId,
            materialName: node.materialName || '',
            githubUrl: node.githubUrl || '',
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
          ? `${node.name || node.productId} registered locally — will sync when EDC is connected`
          : `${node.name || node.productId} is now available in the dataspace`,
      });
    } catch (error) {
      toast({
        title: 'Registration failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const handleDeleteClick = useCallback((node: BomNode) => {
    setNodeToDelete(node);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
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
        toast({ title: 'Deleted', description: `Node "${nodeToDelete.name}" removed.` });
        setBomNodes(prev => prev.filter(n => n.productId !== nodeToDelete.productId));
      } else {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Delete failed');
      }
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setNodeToDelete(null);
    }
  }, [nodeToDelete, configId, dataFolder, toast]);

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PenTool className={`h-6 w-6 ${profileConfig.iconColor}`} />
            <h1 className="text-2xl font-bold tracking-tight">{profileConfig.name}</h1>
            <Badge variant="secondary" className="text-xs ml-2">
              X-Ray Tube BOM
            </Badge>
          </div>
          {(bomStats || materialCoverage) && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2">
              {bomStats && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 cursor-help">
                        <span className="text-xs text-muted-foreground">Components</span>
                        <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300">{bomStats.components}</Badge>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent><p className="text-xs">Leaf nodes without children</p></TooltipContent>
                  </Tooltip>
                  <span className="text-border">|</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 cursor-help">
                        <span className="text-xs text-muted-foreground">Assemblies</span>
                        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">{bomStats.assemblies}</Badge>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent><p className="text-xs">Nodes with children in the BOM hierarchy</p></TooltipContent>
                  </Tooltip>
                  <span className="text-border">|</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 cursor-help">
                        <span className="text-xs text-muted-foreground">Standard Parts</span>
                        <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">{bomStats.stdParts}</Badge>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent><p className="text-xs">SH StdPart — Standard parts</p></TooltipContent>
                  </Tooltip>
                  <span className="text-border">|</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 cursor-help">
                        <span className="text-xs text-muted-foreground">Electronic Components</span>
                        <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">{bomStats.electronicParts}</Badge>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent><p className="text-xs">SH PCB Comp — Electronic components</p></TooltipContent>
                  </Tooltip>
                </>
              )}
              {materialCoverage && (
                <>
                  {bomStats && <span className="text-border">|</span>}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help">
                        <Badge
                          className={`text-xs px-2.5 py-0.5 ${
                            materialCoverage.pct === 100 ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' :
                            materialCoverage.pct >= 75 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' :
                            'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                          }`}
                        >
                          {materialCoverage.pct}% Material Coverage
                        </Badge>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <div className="space-y-1.5 text-xs">
                        <p className="font-semibold">Material Coverage Calculation</p>
                        <p>{materialCoverage.assigned} of {materialCoverage.total} components have a material assigned</p>
                        <p className="text-muted-foreground">Only Components are considered. Standard Parts and Electronic Components are excluded from this calculation.</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          )}
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
          </div>
        </div>
      </div>

      {/* Content: Table + Side Panel */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left: BOM tree table */}
        <div className={`flex-1 overflow-auto p-6 transition-[padding-right] duration-200 ${selectedNode ? 'pr-0' : ''}`}>
          {loading && bomNodes.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading BOM data…
            </div>
          ) : (
            <div className="w-full">
              {/* Expand / Collapse controls */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <Button variant="ghost" size="sm" onClick={expandAll} className="text-xs h-7">
                  Expand All
                </Button>
                <Button variant="ghost" size="sm" onClick={collapseAll} className="text-xs h-7">
                  Collapse All
                </Button>
                <span className="text-xs text-muted-foreground ml-auto">
                  <span>{bomNodes.length} node{bomNodes.length !== 1 ? 's' : ''}</span>
                </span>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[360px]">Product Name</TableHead>
                      <TableHead className="w-[140px]">Component Type</TableHead>
                      <TableHead className="w-[140px]">Model Type</TableHead>
                      <TableHead className="w-[200px]">Material Name</TableHead>
                      <TableHead className="w-[90px] text-right">Quantity</TableHead>
                      <TableHead className="w-[120px] text-right">Weight (kg)</TableHead>
                      <TableHead className="w-[140px]">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">RDS (81346)</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p className="text-xs">IEC 81346 Reference Designation — Product aspect</p>
                          </TooltipContent>
                        </Tooltip>
                      </TableHead>
                      <TableHead className="w-[80px] text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                          {bomNodes.length === 0
                            ? 'No BOM data loaded yet.'
                            : 'No nodes match your search.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRows.map((node) => {
                        const id = node.nodeId || node.productId;
                        const hasChildren = node.children.length > 0;
                        const isExpanded = expanded.has(id);
                        const descendantCount = descendantCounts.get(id) ?? 0;
                        const isSelected = selectedNode?.productId === node.productId;

                        return (
                          <TableRow
                            key={id}
                            className={`group cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-950/40'
                                : 'hover:bg-muted/50'
                            }`}
                            onClick={() => handleRowClick(node)}
                          >
                            {/* Product Name with ID tooltip */}
                            <TableCell>
                              <div
                                className="flex items-center gap-1"
                                style={{ paddingLeft: `${node.depth * 24}px` }}
                              >
                                {hasChildren ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleExpand(id);
                                    }}
                                    className="p-0.5 rounded hover:bg-muted"
                                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="w-5" />
                                )}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    {node.githubUrl && node.githubUrl !== 'pending' && node.githubUrl.startsWith('http') ? (
                                      <a
                                        href={node.githubUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-medium truncate max-w-[320px] inline-block text-blue-600 dark:text-blue-400 hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {node.name ? highlightText(node.name) : '(unnamed)'}
                                      </a>
                                    ) : (
                                      <span className="font-medium truncate max-w-[320px] inline-block cursor-help">
                                        {node.name ? highlightText(node.name) : '(unnamed)'}
                                      </span>
                                    )}
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <p className="text-xs font-mono">Product ID: {node.productId}</p>
                                    {node.githubUrl && typeof node.githubUrl === 'string' && node.githubUrl.startsWith('http') && (
                                      <p className="text-xs text-blue-400 mt-1 break-all">{node.githubUrl}</p>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                                {hasChildren && !isExpanded && (
                                  <span className="text-xs text-muted-foreground ml-1">
                                    ({descendantCount})
                                  </span>
                                )}
                              </div>
                            </TableCell>

                            {/* Component Type */}
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={`text-xs font-normal ${
                                  node.hasChildren === 'True'
                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300'
                                }`}
                              >
                                {node.hasChildren === 'True' ? 'Assembly' : 'Component'}
                              </Badge>
                            </TableCell>

                            {/* Model Type */}
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={`text-xs font-normal ${modelTypeBadge(node.modelType)}`}
                              >
                                {node.modelType ? highlightText(node.modelType) : '—'}
                              </Badge>
                            </TableCell>

                            {/* Material Name */}
                            <TableCell>
                              <span className="text-sm truncate max-w-[180px] inline-block">
                                {node.materialName ? highlightText(node.materialName) : <span className="text-muted-foreground">—</span>}
                              </span>
                            </TableCell>

                            {/* Quantity */}
                            <TableCell className="text-right tabular-nums">
                              <span className="text-sm">
                                {node.quantity ? String(node.quantity) : <span className="text-muted-foreground">—</span>}
                              </span>
                            </TableCell>

                            {/* Weight */}
                            <TableCell className="text-right tabular-nums">
                              <span className="text-sm">
                                {node.weight ? `${node.weight}` : <span className="text-muted-foreground">—</span>}
                              </span>
                            </TableCell>

                            {/* IEC 81346 RDS */}
                            <TableCell>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs font-mono text-indigo-700 dark:text-indigo-300 cursor-help">
                                    {buildRdsProduct(node, nodeById, iecNumbers)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <div className="text-xs space-y-1">
                                    <p><span className="font-semibold">Class:</span> {getIecClass(node)} — {IEC_CLASS_DESCRIPTIONS[getIecClass(node)] ?? 'Unknown'}</p>
                                    <p className="text-muted-foreground">IEC 81346-1:2022 / IEC 81346-2:2019</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>

                            {/* Actions */}
                            <TableCell className="text-center">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                    <span className="sr-only">Open menu</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(node); }}>
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleProvideToEdc(node); }}>
                                    <ArrowRight className="mr-2 h-4 w-4" />
                                    Provide to EDC
                                  </DropdownMenuItem>
                                  <DropdownMenuItem disabled>
                                    <ArrowLeft className="mr-2 h-4 w-4" />
                                    Consume from EDC
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={(e) => { e.stopPropagation(); handleDeleteClick(node); }}
                                    className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-300 focus:bg-red-50 dark:focus:bg-red-950/50"
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        {/* Right: Side Panel */}
        <div
          className={`border-l bg-background overflow-y-auto transition-[width,min-width,opacity] duration-200 ease-in-out ${
            selectedNode ? 'w-[480px] min-w-[480px] opacity-100' : 'w-0 min-w-0 opacity-0 overflow-hidden'
          }`}
        >
          {selectedNode && (
            <SidePanel node={selectedNode} onClose={() => setSelectedNode(null)} nodeById={nodeById} iecNumbers={iecNumbers} configId={configId} dataFolder={dataFolder} refreshKey={refreshKey} />
          )}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={(open) => { if (!open) { setIsEditOpen(false); setEditNode(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto top-[5%] translate-y-0" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit Finished Product</DialogTitle>
          </DialogHeader>
          {isEditOpen && editNode && (
            <FinishedProductEditForm
              key={editNode.productId}
              node={editNode}
              onSuccess={handleEditSuccess}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => { if (!open) { setDeleteDialogOpen(false); setNodeToDelete(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete BOM Node</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this node? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {nodeToDelete && (
            <div className="rounded-md border p-3 bg-muted/30 text-sm space-y-1">
              <div><span className="font-medium">Name:</span> {nodeToDelete.name}</div>
              <div><span className="font-medium">Product ID:</span> <span className="font-mono text-xs">{nodeToDelete.productId}</span></div>
              {nodeToDelete.materialName && (
                <div><span className="font-medium">Material:</span> {nodeToDelete.materialName}</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteDialogOpen(false); setNodeToDelete(null); }} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={isDeleting}>
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Side Panel ─────────────────────────────────────────────────

function SidePanel({ node, onClose, nodeById, iecNumbers, configId, dataFolder, refreshKey }: { node: BomNode; onClose: () => void; nodeById: Map<string, BomNode>; iecNumbers: Map<string, string>; configId: string | null; dataFolder: string; refreshKey: number }) {
  const { schemaFields } = useSchemaFields();
  // Identifier fields are derived from the data-repo schema (not hard-coded)
  const idFields = useMemo(() => identifierFields(schemaFields), [schemaFields]);
  const dppUrl = useMemo(() => {
    if (!configId) return null;
    return `${window.location.origin}/dpp/${encodeURIComponent(configId)}/${encodeURIComponent(dataFolder || 'products')}/${encodeURIComponent(node.nodeId || node.productId)}`;
  }, [configId, dataFolder, node.nodeId, node.productId]);

  // HALB material lookup state
  const [halbMaterial, setHalbMaterial] = useState<HalbMaterialData | null>(null);
  const [halbLoading, setHalbLoading] = useState(false);
  const [halbError, setHalbError] = useState<string | null>(null);

  // Fetch HALB material data when materialName is present
  useEffect(() => {
    if (!node.materialName?.trim()) {
      setHalbMaterial(null);
      return;
    }

    let cancelled = false;

    async function lookupHalb() {
      setHalbLoading(true);
      setHalbError(null);
      try {
        // Get HALB repo config from repo-metadata
        const metadata = await fetchRepoMetadata();
        if (cancelled) return;
        const repos = metadata?.repos || [];
        const halbRepo = repos.find((r) => r.data_folders?.some((folder) => folder.folder.includes('semi-finished')));
        if (!halbRepo) {
          setHalbError('HALB repository not configured');
          return;
        }

        const params = new URLSearchParams();
        params.set('config_id', halbRepo.config_id);
        const folder = halbRepo.data_folders.find((entry) => entry.folder.includes('semi-finished'))!.folder;
        if (folder !== 'products') params.set('folder', folder);

        const cacheKey = `${halbRepo.config_id}:${folder}:${refreshKey}`;
        const cached = halbProductsCache.get(cacheKey);
        let halbEntries: HalbMaterialData[];
        if (cached && Date.now() - cached.ts < HALB_PRODUCTS_CACHE_TTL_MS) {
          halbEntries = cached.entries;
        } else {
          const res = await apiFetch(`/api/list-products?${params.toString()}`);
          if (cancelled) return;
          if (!res.ok) {
            setHalbError('Failed to fetch HALB data');
            return;
          }

          const result = await res.json();
          halbEntries = Array.isArray(result.data) ? result.data : [];
          halbProductsCache.set(cacheKey, { ts: Date.now(), entries: halbEntries });
        }

        // Find exact match by materialName (case-insensitive trim)
        const targetName = node.materialName!.trim().toLowerCase();
        const match = halbEntries.find(
          (entry) => (entry.productName || entry.designation || '')?.trim().toLowerCase() === targetName
            || (entry.materialName || '')?.trim().toLowerCase() === targetName
        );

        if (cancelled) return;
        setHalbMaterial(match || null);
      } catch (e) {
        if (!cancelled) setHalbError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        if (!cancelled) setHalbLoading(false);
      }
    }

    lookupHalb();
    return () => { cancelled = true; };
  }, [node.materialName, refreshKey]);

  const hasHalbTab = Boolean(node.materialName?.trim());
  const hasNameplateTab = Boolean(node.uriOfTheProduct || node.manufacturerName || node.manufacturerProductDesignation);
  const hasTechnicalTab = Boolean(node.classificationSystem || node.productClassId || node.uriOfManufacturer || node.internalArticleNumber);

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold truncate" title={node.name}>
            {node.name}
          </h3>
          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
            {node.nodeId || node.productId}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="w-full h-9 gap-0.5 p-1">
          <TabsTrigger value="basic" className="flex-1 min-w-0 text-[11px] px-2">Basic</TabsTrigger>
          {hasNameplateTab && (
            <TabsTrigger value="nameplate" className="flex-1 min-w-0 text-[11px] px-2">Nameplate</TabsTrigger>
          )}
          {hasTechnicalTab && (
            <TabsTrigger value="technical" className="flex-1 min-w-0 text-[11px] px-2">Technical</TabsTrigger>
          )}
          {hasHalbTab && (
            <TabsTrigger value="composition" className="flex-1 min-w-0 text-[11px] px-2">Composition</TabsTrigger>
          )}
        </TabsList>

        {/* ── Tab 1: Basic Information ─────────────────────────── */}
        <TabsContent value="basic" className="space-y-5 mt-4">
          {/* Identification */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Identification</h4>
            <div className={DETAIL_GRID_CLASS}>
              <DetailLabel>Product ID</DetailLabel>
              <DetailValue mono>{node.productId || undefined}</DetailValue>

              {idFields.map((f) => (
                <Fragment key={f.field}>
                  <DetailLabel>{f.description || fieldLabel(f.field)}</DetailLabel>
                  <DetailValue>{(node[f.field] != null && node[f.field] !== '') ? String(node[f.field]) : undefined}</DetailValue>
                </Fragment>
              ))}

              <DetailLabel>Material ID</DetailLabel>
              <DetailValue>{node.materialId || undefined}</DetailValue>
            </div>
          </div>

          <hr className="border-border" />

          {/* Component Information */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Component Information</h4>
            <div className={DETAIL_GRID_CLASS}>
              <DetailLabel>Material Name</DetailLabel>
              <DetailValue>{node.materialName || undefined}</DetailValue>

              <DetailLabel>Component Type</DetailLabel>
              <span>
                {node.hasChildren === 'True' ? (
                  <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 text-xs">
                    Assembly
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    Component
                  </Badge>
                )}
              </span>

              <DetailLabel>Model Type</DetailLabel>
              <span>
                <Badge
                  variant="secondary"
                  className={`text-xs font-normal ${modelTypeBadge(node.modelType)}`}
                >
                  {node.modelType || '—'}
                </Badge>
              </span>

              <DetailLabel>BoM-Info</DetailLabel>
              <span>
                {node.hasChildren === 'True' ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 text-xs">
                    Has Children
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    Leaf Node
                  </Badge>
                )}
              </span>

              <DetailLabel>Weight (kg)</DetailLabel>
              <DetailValue>{node.weight || undefined}</DetailValue>

              <DetailLabel>Quantity</DetailLabel>
              <DetailValue>{node.quantity ? String(node.quantity) : undefined}</DetailValue>
            </div>
          </div>

          <hr className="border-border" />

          {/* IEC 81346 Reference Designation */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              IEC 81346 Reference Designation
            </h4>
            <div className={DETAIL_GRID_CLASS}>
              <DetailLabel>Class Letter</DetailLabel>
              <span className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs font-mono bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
                  {getIecClass(node)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {IEC_CLASS_DESCRIPTIONS[getIecClass(node)] ?? 'Unknown'}
                </span>
              </span>

              <DetailLabel>RDS Product</DetailLabel>
              <DetailValue mono>{buildRdsProduct(node, nodeById, iecNumbers)}</DetailValue>

              <DetailLabel>Standard</DetailLabel>
              <DetailValue>IEC 81346-1:2022 / IEC 81346-2:2019</DetailValue>
            </div>
          </div>

          <hr className="border-border" />

          {/* Digital Product Passport */}
          {dppUrl && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Digital Product Passport</h4>
              <div className="flex flex-col items-center gap-3">
                <div className="p-3 bg-white rounded-lg border border-border">
                  <QRCodeSVG value={dppUrl} size={128} />
                </div>
                <a
                  href={dppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline truncate max-w-full"
                >
                  Open DPP Viewer &rarr;
                </a>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Nameplate ──────────────────────────────────── */}
        {hasNameplateTab && (
          <TabsContent value="nameplate" className="space-y-5 mt-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Nameplate
                </h4>
                <Badge className="text-[10px] font-normal bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
                  ZVEI Nameplate 2.0
                </Badge>
              </div>
              <div className={DETAIL_GRID_CLASS}>
                <DetailLabel>URI of Product</DetailLabel>
                <DetailValue mono>{node.uriOfTheProduct}</DetailValue>

                <DetailLabel>Manufacturer</DetailLabel>
                <DetailValue>{node.manufacturerName}</DetailValue>

                <DetailLabel>Product Designation</DetailLabel>
                <DetailValue>{node.manufacturerProductDesignation}</DetailValue>

                <DetailLabel>Product Type</DetailLabel>
                <DetailValue>{node.manufacturerProductType}</DetailValue>

                <DetailLabel>Article Number</DetailLabel>
                <DetailValue mono>{node.productArticleNumberOfManufacturer}</DetailValue>
              </div>
            </div>
          </TabsContent>
        )}

        {/* ── Tab: Technical Data ─────────────────────────────── */}
        {hasTechnicalTab && (
          <TabsContent value="technical" className="space-y-5 mt-4">
            {/* Product Classification */}
            {(node.classificationSystem || node.productClassId) && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Product Classification
                    </h4>
                    {node.classificationSystem && (
                      <Badge className="text-[10px] font-normal bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
                        {node.classificationSystem}{node.classificationSystemVersion ? ` ${node.classificationSystemVersion}` : ''}
                      </Badge>
                    )}
                  </div>
                  <div className={DETAIL_GRID_CLASS}>
                    <DetailLabel>Class ID</DetailLabel>
                    <DetailValue mono>{node.productClassId}</DetailValue>

                    <DetailLabel>Coded Name</DetailLabel>
                    <DetailValue mono>{node.productClassCodedName}</DetailValue>

                    <DetailLabel>Class Name</DetailLabel>
                    <DetailValue>{node.productClassName}</DetailValue>
                  </div>
                </div>
                <hr className="border-border" />
              </>
            )}

            {/* General Properties */}
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Properties
              </h4>
              <div className={DETAIL_GRID_CLASS}>
                {node.netWeight && (
                  <>
                    <DetailLabel>Net Weight (kg)</DetailLabel>
                    <DetailValue>{node.netWeight}</DetailValue>
                  </>
                )}

                <DetailLabel>URI Manufacturer</DetailLabel>
                <DetailValue mono>{node.uriOfManufacturer}</DetailValue>

                <DetailLabel>GLN Manufacturer</DetailLabel>
                <DetailValue mono>{node.glnOfManufacturer}</DetailValue>

                <DetailLabel>URI Product</DetailLabel>
                <DetailValue mono>{node.uriOfTheProductTechnical}</DetailValue>

                <DetailLabel>Article Number</DetailLabel>
                <DetailValue mono>{node.internalArticleNumber}</DetailValue>

                <DetailLabel>GTIN / EAN</DetailLabel>
                <DetailValue mono>{node.gtinEanCode}</DetailValue>
              </div>
            </div>
          </TabsContent>
        )}

        {/* ── Tab: Material Composition (from HALB) ───────────── */}
        {hasHalbTab && (
          <TabsContent value="composition" className="space-y-5 mt-4">
            <MaterialCompositionContent
              material={halbMaterial}
              materialName={node.materialName}
              loading={halbLoading}
              error={halbError}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ── Reusable grid cells ────────────────────────────────────────

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
      {children}
    </span>
  );
}

function DetailValue({ children, mono }: { children?: React.ReactNode; mono?: boolean }) {
  const val = children;
  return (
    <span className={`text-sm ${mono ? 'font-mono' : ''} break-all`}>
      {val || <span className="text-muted-foreground">—</span>}
    </span>
  );
}
