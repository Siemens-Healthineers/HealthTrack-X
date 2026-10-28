/**
 * BomTreeTable — expandable hierarchical Bill-of-Material table.
 *
 * Receives a flat array of BOM nodes (each with an optional `parentId`)
 * and renders them as an indented, collapsible tree using the existing
 * shadcn Table primitives.
 */

// Trademark notice: "Asset Administration Shell" (AAS) and the AAS logo are
// trademarks of the Industrial Digital Twin Association (IDTA), referenced here
// for identification and interoperability purposes only.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { buildTree, flattenTree, countDescendantsById, modelTypeBadge } from '../lib/bomTree';
import {
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  Plus,
  Link2,
  MoreVertical,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

// ── Types ──────────────────────────────────────────────────────
export interface BomNode {
  productId: string;
  nodeId?: string;
  name: string;
  parentId?: string | null;
  modelType: string;
  quantity?: string | number;
  manufacturer?: string;
  materialName?: string;
  weight?: string;
  valueType?: string;
  propertyValue?: string;
  description?: string;
  edcAssetId?: string;
  edcAssetName?: string;
  githubUrl?: string;
  materialId?: string;
  /** Raw YAML field indicating whether this node has children in the source data. */
  hasChildren?: string;
  // IEC 81346 Reference Designation
  iec81346Class?: string;
  iec81346Number?: string;
  // Nameplate (AAS)
  uriOfTheProduct?: string;
  manufacturerName?: string;
  manufacturerProductDesignation?: string;
  manufacturerProductType?: string;
  productArticleNumberOfManufacturer?: string;
  // Technical Data (AAS)
  classificationSystem?: string;
  classificationSystemVersion?: string;
  productClassId?: string;
  productClassCodedName?: string;
  productClassName?: string;
  netWeight?: string;
  uriOfManufacturer?: string;
  glnOfManufacturer?: string;
  uriOfTheProductTechnical?: string;
  internalArticleNumber?: string;
  gtinEanCode?: string;
  [key: string]: unknown;
}

interface BomTreeTableProps {
  nodes: BomNode[];
  searchQuery?: string;
  /** The modelType value that represents an assembly/collection (from metadata) */
  assemblyType?: string;
  onEdit: (node: BomNode) => void;
  onDelete: (node: BomNode) => void;
  onAddChild: (parentNode: BomNode | null) => void;
  onAddEdcAsset: (parentNode: BomNode | null) => void;
}

// ── Component ──────────────────────────────────────────────────

export function BomTreeTable({
  nodes,
  searchQuery,
  assemblyType = 'Assembly',
  onEdit,
  onDelete,
  onAddChild,
  onAddEdcAsset,
}: BomTreeTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Start with all nodes expanded
    return new Set(nodes.map(n => n.nodeId || n.productId));
  });

  // Auto-expand nodes that arrive after the initial mount (e.g., after Add Child)
  useEffect(() => {
    setExpanded(prev => {
      const incoming = nodes
        .map(n => n.nodeId || n.productId)
        .filter(id => !prev.has(id));
      if (incoming.length === 0) return prev;
      const next = new Set(prev);
      for (const id of incoming) next.add(id);
      return next;
    });
  }, [nodes]);

  // Rebuild tree when nodes change
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  // O(n) descendant counts (avoids O(n²) per-row recursion)
  const descendantCounts = useMemo(() => countDescendantsById(tree), [tree]);

  // Flatten tree for rendering, respecting expand/collapse state
  const visibleRows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);

  // Apply search filter
  const filteredRows = useMemo(() => {
    if (!searchQuery?.trim()) return visibleRows;
    const q = searchQuery.toLowerCase();
    return visibleRows.filter(
      (n) =>
        n.name?.toLowerCase().includes(q) ||
        (n.nodeId || n.productId)?.toLowerCase().includes(q) ||
        n.modelType?.toLowerCase().includes(q) ||
        n.edcAssetName?.toLowerCase().includes(q),
    );
  }, [visibleRows, searchQuery]);

  const toggleExpand = useCallback((nodeId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(nodes.map(n => n.nodeId || n.productId)));
  }, [nodes]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  return (
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
          {nodes.length} node{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Product Name</TableHead>
              <TableHead className="w-[150px]">Manufacturer</TableHead>
              <TableHead className="w-[180px]">Model Type</TableHead>
              <TableHead className="w-[170px]">Material Name</TableHead>
              <TableHead className="w-[90px] text-right">Weight</TableHead>
              <TableHead className="w-[60px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  {nodes.length === 0
                    ? 'No BOM nodes yet. Click "Add Data" to create the first node.'
                    : 'No nodes match your search.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((node) => {
                const id = node.nodeId || node.productId;
                const hasChildren = node.children.length > 0;
                const isExpanded = expanded.has(id);
                const descendantCount = descendantCounts.get(id) ?? 0;

                return (
                  <TableRow
                    key={id}
                    className="group hover:bg-muted/50 transition-colors"
                  >
                    {/* Product Name with ID tooltip */}
                    <TableCell>
                      <div
                        className="flex items-center gap-1"
                        style={{ paddingLeft: `${node.depth * 24}px` }}
                      >
                        {/* Expand/collapse chevron */}
                        {hasChildren ? (
                          <button
                            onClick={() => toggleExpand(id)}
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
                          <span className="w-5" /> /* spacing for leaf nodes */
                        )}

                        <Tooltip>
                            <TooltipTrigger asChild>
                              {node.githubUrl && node.githubUrl !== 'pending' && node.githubUrl.startsWith('http') ? (
                                <a
                                  href={node.githubUrl.replace(/[^/]+$/, 'products.json')}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium truncate max-w-[240px] inline-block text-blue-600 dark:text-blue-400 hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {node.name || '(unnamed)'}
                                </a>
                              ) : (
                                <span className="font-medium truncate max-w-[240px] inline-block cursor-help">
                                  {node.name || '(unnamed)'}
                                </span>
                              )}
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs font-mono">Product ID: {node.productId || id}</p>
                              {node.githubUrl && typeof node.githubUrl === 'string' && node.githubUrl.startsWith('http') && (
                                <p className="text-xs text-blue-400 mt-1 break-all">{node.githubUrl.replace(/[^/]+$/, 'products.json')}</p>
                              )}
                              {node.githubUrl === 'pending' && <p className="text-xs text-yellow-400 mt-1">GitHub sync in progress</p>}
                            </TooltipContent>
                        </Tooltip>

                        {hasChildren && !isExpanded && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({descendantCount})
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Manufacturer */}
                    <TableCell>
                      <span className="text-sm truncate max-w-[130px] inline-block">
                        {node.manufacturer || <span className="text-muted-foreground">—</span>}
                      </span>
                    </TableCell>

                    {/* Model Type */}
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-xs font-normal ${modelTypeBadge(node.modelType)}`}
                      >
                        {node.modelType}
                      </Badge>
                    </TableCell>

                    {/* Material Name */}
                    <TableCell>
                      {node.modelType === assemblyType ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span className="text-sm truncate max-w-[150px] inline-block">
                          {node.materialName || <span className="text-muted-foreground">—</span>}
                        </span>
                      )}
                    </TableCell>

                    {/* Weight */}
                    <TableCell className="text-right tabular-nums">
                      {node.modelType === assemblyType ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span className="text-sm">
                          {node.weight ? `${node.weight} g` : <span className="text-muted-foreground">—</span>}
                        </span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(node)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          {node.modelType === assemblyType && (
                            <DropdownMenuItem onClick={() => onAddChild(node)}>
                              <Plus className="h-3.5 w-3.5 mr-2" />
                              Add Child
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => onAddEdcAsset(node)}>
                            <Link2 className="h-3.5 w-3.5 mr-2" />
                            Add EDC Asset
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onDelete(node)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
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
  );
}
