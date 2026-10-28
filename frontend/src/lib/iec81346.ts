/**
 * IEC 81346 Reference Designation System (RDS) utilities.
 *
 * Maps existing BOM modelType values to IEC 81346-2 class letters and
 * provides functions to build hierarchical Reference Designations.
 */

import type { BomNode } from '../components/BomTreeTable';

// ── IEC 81346-2 Class Letter Descriptions ──────────────────────

export const IEC_CLASS_DESCRIPTIONS: Record<string, string> = {
  A: 'Assembly / Sub-assembly',
  B: 'Transducing (non-electrical ↔ electrical)',
  C: 'Storing (energy/information)',
  E: 'Providing radiant/thermal energy',
  F: 'Protecting directly',
  G: 'Generating / Converting (electrical)',
  H: 'Producing new material',
  K: 'Processing (signals/information)',
  M: 'Providing mechanical energy',
  P: 'Presenting information',
  Q: 'Switching (power circuits)',
  R: 'Restricting / Stabilizing',
  S: 'Switching (information circuits)',
  T: 'Transforming (energy, same form)',
  U: 'Holding / Enclosing (physically)',
  V: 'Processing / Treating (material)',
  W: 'Guiding / Conducting (energy/signals/material)',
  X: 'Connecting (mechanically)',
};

// ── modelType → IEC 81346-2 class letter mapping ──────────────

export const MODEL_TYPE_TO_IEC_CLASS: Record<string, string> = {
  'SH 3D-Model': 'A',   // Assembly / Sub-assembly
  'SH Assembly': 'A',   // Assembly / Sub-assembly
  'SH PCB':      'A',   // PCB treated as assembly (IEC 81346 conformant)
  'SH PCB Comp': 'K',   // Processing signals/information
  'SH StdPart':  'X',   // Connecting mechanically (fasteners)
  'SH Material': 'R',   // Restricting / Stabilizing (passive material)
  'SH Cable':    'W',   // Guiding / Conducting energy/signals
  'SH Coating':  'U',   // Holding / Enclosing (surface protection)
};

/**
 * Derive IEC 81346-2 class letter for a BOM node.
 * Priority: explicit iec81346Class → mapping from modelType → 'A' for assemblies → '?'
 */
export function getIecClass(node: BomNode): string {
  if (node.iec81346Class) return node.iec81346Class;
  if (node.modelType && MODEL_TYPE_TO_IEC_CLASS[node.modelType]) {
    return MODEL_TYPE_TO_IEC_CLASS[node.modelType];
  }
  if (node.hasChildren === 'True') return 'A';
  return '?';
}

/**
 * Build the full RDS product designation string for a node by traversing
 * its ancestor chain.  Example result: `-A1-K2`
 */
export function buildRdsProduct(
  node: BomNode,
  byId: Map<string, BomNode>,
  iecNumbers: Map<string, string>,
): string {
  const chain: BomNode[] = [];
  let cur: BomNode | undefined = node;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain
    .map(n => {
      const cls = getIecClass(n);
      const num = n.iec81346Number ?? iecNumbers.get(n.nodeId || n.productId) ?? '';
      return `-${cls}${num}`;
    })
    .join('');
}

/**
 * Build a short (leaf-only) RDS designation: e.g. `-K2`
 */
export function buildRdsShort(node: BomNode, iecNumbers: Map<string, string>): string {
  const cls = getIecClass(node);
  const num = node.iec81346Number ?? iecNumbers.get(node.nodeId || node.productId) ?? '';
  return `-${cls}${num}`;
}

/**
 * Compute sibling-based numbering for all nodes in a flat list.
 * Assigns sequential 1-based numbers among siblings sharing the same IEC class.
 * Returns a Map: nodeId → computed number string.
 */
export function computeIecNumbers(nodes: BomNode[]): Map<string, string> {
  const result = new Map<string, string>();
  const byParent = new Map<string, BomNode[]>();
  for (const n of nodes) {
    const pid = n.parentId ?? '__root__';
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(n);
  }
  for (const siblings of byParent.values()) {
    const classCounters = new Map<string, number>();
    for (const sib of siblings) {
      const cls = getIecClass(sib);
      const count = (classCounters.get(cls) ?? 0) + 1;
      classCounters.set(cls, count);
      result.set(sib.nodeId || sib.productId, String(count));
    }
  }
  return result;
}
