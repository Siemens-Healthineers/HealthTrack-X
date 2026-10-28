/**
 * Shared BOM-tree utilities used by BomTreeTable, MedicalDeviceBomView, and
 * FinishedProductBomView.  Extracted here to avoid the three-way duplication
 * that existed before.
 */

import type { BomNode } from '../components/BomTreeTable';

// ── Types ──────────────────────────────────────────────────────

export interface TreeNode extends BomNode {
  children: TreeNode[];
  depth: number;
}

// ── Tree construction ──────────────────────────────────────────

export function buildTree(nodes: BomNode[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const id = n.nodeId || n.productId;
    nodeMap.set(id, { ...n, children: [], depth: 0 });
  }
  for (const [, treeNode] of nodeMap) {
    const pid = treeNode.parentId;
    if (pid && nodeMap.has(pid)) {
      const parent = nodeMap.get(pid)!;
      treeNode.depth = parent.depth + 1;
      parent.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }
  function fixDepth(node: TreeNode, depth: number) {
    node.depth = depth;
    for (const child of node.children) fixDepth(child, depth + 1);
  }
  for (const root of roots) fixDepth(root, 0);
  return roots;
}

export function flattenTree(roots: TreeNode[], expanded: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(node: TreeNode) {
    result.push(node);
    const id = node.nodeId || node.productId;
    if (expanded.has(id)) {
      for (const child of node.children) walk(child);
    }
  }
  for (const root of roots) walk(root);
  return result;
}

export function countDescendants(node: TreeNode): number {
  let count = node.children.length;
  for (const ch of node.children) count += countDescendants(ch);
  return count;
}

/**
 * Build a Map<id, descendantCount> in a single O(n) post-order pass.
 * Use this when many rows need the count (avoids O(n²) per-row recursion).
 */
export function countDescendantsById(roots: TreeNode[]): Map<string, number> {
  const out = new Map<string, number>();
  function walk(n: TreeNode): number {
    let c = n.children.length;
    for (const ch of n.children) c += walk(ch);
    out.set(n.nodeId || n.productId, c);
    return c;
  }
  for (const r of roots) walk(r);
  return out;
}

// ── Styling ────────────────────────────────────────────────────

const MODEL_TYPE_BADGE_MAP: Record<string, string> = {
  'SH 3D-Model': 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  'SH StdPart': 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  'SH PCB Comp': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
};

export function modelTypeBadge(modelType: string): string {
  return MODEL_TYPE_BADGE_MAP[modelType] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
}
