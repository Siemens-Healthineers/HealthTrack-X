/**
 * NxStructurePage — Siemens NX Open CAD Structure & BOM Explorer.
 *
 * Allows loading and inspecting CAD assembly structures directly extracted from
 * Siemens NX via NX Open (Python), styled identically to the Finished Product (FERT) use-case.
 *
 * Designed to run seamlessly inside the Siemens NX Embedded Web Browser:
 * theUFSession.Web.OpenUrl("http://htx.local/nx-structure")
 *
 * [NX-INTEGRATION MODULE] — Easily removable by deleting this file and removing the route.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Boxes,
  Box,
  Layers,
  Search,
  Code2,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  X,
  Sparkles,
  Scale,
  FileCode,
  SlidersHorizontal,
  Zap,
  Loader2,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { useToast } from '../components/ui/use-toast';
import { MaterialCompositionContent } from '../components/MaterialCompositionContent';
import { modelTypeBadge } from '../lib/bomTree';
import { apiFetch } from '../config/api';
import { fetchRepoMetadata } from '../contexts/AppProfileContext';

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

// ── NX Node Interface ──────────────────────────────────────────

export interface NxBomNode {
  productId: string;
  nodeId?: string;
  name: string;
  parentId?: string | null;
  modelType: string;
  partNumber?: string;
  revision?: string;
  quantity?: string | number;
  materialName?: string;
  density?: string | number;
  weight?: string | number;
  weightUnit?: string;
  volume?: string | number;
  surfaceArea?: string | number;
  boundingBox?: { x: number; y: number; z: number };
  centerOfGravity?: { x: number; y: number; z: number };
  nxAttributes?: Record<string, string>;
  description?: string;
  children?: NxBomNode[];
  depth?: number;
}

// ── Python Script for NX Open ─────────────────────────────────

const NX_PYTHON_SCRIPT = `# ==============================================================================
# Siemens NX Open Python — Robuster Baugruppen-, Masse- & Material-Extraktor v4
# ==============================================================================
# Unterstützt:
#   - Materials > Material & Materials > MassPropMass (in kg)
#   - Component Occurrence & Prototype Part Attribute
#   - Automatisches Nachladen von Partially Loaded Parts
#   - Session Parts Matching
# ==============================================================================
# In Siemens NX ausführen: Menü -> Werkzeuge -> Journal -> Wiedergabe (Play)
# ==============================================================================

import json
import urllib.request
import NXOpen
import NXOpen.UF

def read_nx_attribute_any(obj, title, category=None):
    if not obj:
        return None
    cats_to_try = [category] if category else ["Materials", "", None, "Mass Properties", "Properties"]
    for cat in cats_to_try:
        cat_arg = cat if cat else -1
        try:
            if hasattr(obj, "HasUserAttribute"):
                if obj.HasUserAttribute(title, NXOpen.NXObject.AttributeType.String, cat_arg):
                    v = obj.GetStringUserAttribute(title, cat_arg)
                    if v and str(v).strip() and str(v).lower() != "none":
                        return str(v).strip()
        except Exception:
            pass
        try:
            if hasattr(obj, "HasUserAttribute"):
                if obj.HasUserAttribute(title, NXOpen.NXObject.AttributeType.Real, cat_arg):
                    v = obj.GetRealUserAttribute(title, cat_arg)
                    return float(v)
        except Exception:
            pass
        try:
            if hasattr(obj, "HasUserAttribute"):
                if obj.HasUserAttribute(title, NXOpen.NXObject.AttributeType.Integer, cat_arg):
                    v = obj.GetIntegerUserAttribute(title, cat_arg)
                    return int(v)
        except Exception:
            pass
    return None

def extract_all_attributes_from_object(theUFSession, obj, tag=None):
    attrs = {}
    if not obj and not tag:
        return attrs

    if obj and hasattr(obj, 'GetUserAttributes'):
        try:
            for a in obj.GetUserAttributes():
                title = (getattr(a, 'Title', '') or '').strip()
                cat = (getattr(a, 'Category', '') or '').strip()
                val = ""
                try:
                    val = str(a.StringValue)
                except Exception:
                    try:
                        val = str(a.RealValue)
                    except Exception:
                        try:
                            val = str(a.IntegerValue)
                        except Exception:
                            val = str(a)
                if val and val.strip() and val.lower() != "none":
                    val = val.strip()
                    if title:
                        attrs[title] = val
                        if cat:
                            attrs[f"{cat} > {title}"] = val
                            attrs[f"{cat}:{title}"] = val
        except Exception:
            pass

    target_tag = tag if tag else (obj.Tag if hasattr(obj, 'Tag') else 0)
    if target_tag and theUFSession:
        try:
            attr_title = ""
            while True:
                res = theUFSession.Attr.CycleAttributes(target_tag, attr_title)
                if isinstance(res, tuple):
                    attr_title = res[0]
                    attr_type = res[1]
                else:
                    attr_title = res
                    attr_type = 1
                if not attr_title:
                    break
                if attr_title not in attrs:
                    try:
                        val_tuple = theUFSession.Attr.ReadValue(target_tag, attr_title, attr_type)
                        val = ""
                        if isinstance(val_tuple, (list, tuple)) and len(val_tuple) >= 5:
                            v_type = val_tuple[0]
                            val = str(val_tuple[v_type]) if v_type < len(val_tuple) else str(val_tuple[1])
                        else:
                            val = str(val_tuple)
                        if val and val.strip() and val.lower() != "none":
                            attrs[attr_title] = val.strip()
                    except Exception:
                        pass
        except Exception:
            pass

    return attrs

def get_material_and_mass_deep(theSession, theUFSession, comp, proto_part, part_by_name):
    material_name = "Not Assigned"
    mass = 0.0
    density = None
    volume = None
    area = None
    cog = {"x": 0.0, "y": 0.0, "z": 0.0}

    all_attrs = {}

    objects_to_search = []
    if comp:
        objects_to_search.append(("comp", comp, comp.Tag if hasattr(comp, 'Tag') else 0))
    if proto_part:
        objects_to_search.append(("proto", proto_part, proto_part.Tag if hasattr(proto_part, 'Tag') else 0))
    if part_by_name and part_by_name != proto_part:
        objects_to_search.append(("session_part", part_by_name, part_by_name.Tag if hasattr(part_by_name, 'Tag') else 0))

    for label, obj, t in objects_to_search:
        obj_attrs = extract_all_attributes_from_object(theUFSession, obj, t)
        for k, v in obj_attrs.items():
            if k not in all_attrs:
                all_attrs[k] = v

    for label, obj, t in objects_to_search:
        mat_val = read_nx_attribute_any(obj, "Material", "Materials")
        if not mat_val:
            mat_val = read_nx_attribute_any(obj, "Material")
        if not mat_val:
            mat_val = read_nx_attribute_any(obj, "NX_Material")
        if not mat_val:
            mat_val = read_nx_attribute_any(obj, "Werkstoff")
        if mat_val and str(mat_val).strip() and str(mat_val).lower() != "none" and str(mat_val) != "0":
            material_name = str(mat_val).strip()
            break

    if material_name == "Not Assigned":
        mat_keys = [
            "materials > material", "materials:material", "materials/material",
            "material", "materials > materialname", "materialname",
            "nx_material", "db_material", "cad_material", "werkstoff"
        ]
        for k, v in all_attrs.items():
            if k.strip().lower() in mat_keys:
                if v and str(v).strip() and str(v).lower() != "none" and str(v) != "0":
                    material_name = str(v).strip()
                    break

    if material_name == "Not Assigned":
        for label, obj, t in objects_to_search:
            if hasattr(obj, 'MaterialManager'):
                try:
                    p_mats = obj.MaterialManager.PhysicalMaterials.ToArray()
                    if p_mats and len(p_mats) > 0 and p_mats[0].Name:
                        material_name = str(p_mats[0].Name).strip()
                        break
                except Exception:
                    pass

    if material_name == "Not Assigned":
        for label, obj, t in objects_to_search:
            if hasattr(obj, 'Bodies'):
                try:
                    for b in obj.Bodies:
                        try:
                            bm = b.GetPhysicalMaterial()
                            if bm and bm.Name and str(bm.Name).strip():
                                material_name = str(bm.Name).strip()
                                break
                        except Exception:
                            pass
                        try:
                            bt = theUFSession.Modeling.AskBodyMaterial(b.Tag)
                            if bt:
                                bn = theUFSession.Mat.AskMaterialName(bt)
                                if bn and str(bn).strip():
                                    material_name = str(bn).strip()
                                    break
                        except Exception:
                            pass
                    if material_name != "Not Assigned":
                        break
                except Exception:
                    pass

    for label, obj, t in objects_to_search:
        m_val = read_nx_attribute_any(obj, "MassPropMass", "Materials")
        if m_val is None:
            m_val = read_nx_attribute_any(obj, "MassPropMass")
        if m_val is None:
            m_val = read_nx_attribute_any(obj, "Mass", "Materials")
        if m_val is None:
            m_val = read_nx_attribute_any(obj, "Mass")
        if m_val is not None:
            try:
                m_num = float(str(m_val).replace(',', '.').split()[0])
                if m_num > 0:
                    mass = m_num
                    break
            except Exception:
                pass

    if mass <= 0.0:
        mass_keys = [
            "materials > masspropmass", "materials:masspropmass", "materials/masspropmass",
            "masspropmass", "materials > mass", "materials:mass", "mass", "weight", "nx_mass"
        ]
        for k, v in all_attrs.items():
            if k.strip().lower() in mass_keys:
                try:
                    v_str = str(v).replace(',', '.').strip()
                    parts = v_str.split()
                    val_num = float(parts[0])
                    if len(parts) > 1 and parts[1].lower() in ('g', 'gram', 'gramm', 'grams'):
                        val_num = val_num / 1000.0
                    if val_num > 0:
                        mass = val_num
                        break
                except Exception:
                    pass
            if mass > 0:
                break

    if mass <= 0.0:
        for label, obj, t in objects_to_search:
            if hasattr(obj, 'Bodies'):
                try:
                    body_tags = [b.Tag for b in obj.Bodies if not getattr(b, 'IsSheetBody', False)]
                    if not body_tags:
                        body_tags = [b.Tag for b in obj.Bodies]
                    if body_tags:
                        props = [0.0] * 47
                        theUFSession.Modl.AskMassProps3d(body_tags, len(body_tags), 1, 2, 0.01, 1, props)
                        if props[2] > 0.0:
                            area = round(props[0], 2)
                            volume = round(props[1], 2)
                            mass = round(props[2], 4)
                            cog = {"x": round(props[3], 2), "y": round(props[4], 2), "z": round(props[5], 2)}
                            break
                except Exception:
                    pass

    if mass <= 0.0:
        for label, obj, t in objects_to_search:
            if t:
                try:
                    props = [0.0] * 47
                    theUFSession.Weight.AskPartMassProps(t, props)
                    if props[2] > 0.0:
                        area = round(props[0], 2)
                        volume = round(props[1], 2)
                        mass = round(props[2], 4)
                        cog = {"x": round(props[3], 2), "y": round(props[4], 2), "z": round(props[5], 2)}
                        break
                except Exception:
                    pass

    for k, v in all_attrs.items():
        kl = k.strip().lower()
        if kl in ("materials > masspropdensity", "materials:masspropdensity", "masspropdensity", "density") and density is None:
            try:
                density = float(str(v).replace(',', '.').split()[0])
            except Exception:
                pass
        if kl in ("materials > masspropvolume", "materials:masspropvolume", "masspropvolume", "volume") and volume is None:
            try:
                volume = float(str(v).replace(',', '.').split()[0])
            except Exception:
                pass

    if volume and mass > 0 and (density is None or density <= 0):
        density = round((mass * 1000.0) / (volume / 1000.0), 3)

    return material_name, mass, volume, area, density, cog, all_attrs

def find_session_part_by_name(theSession, name):
    if not name:
        return None
    try:
        for p in theSession.Parts:
            if p.Leaf and p.Leaf.lower() in name.lower():
                return p
            if p.FullPath and name.lower() in p.FullPath.lower():
                return p
    except Exception:
        pass
    return None

def process_component_tree(theSession, theUFSession, comp, parent_id=None, depth=0):
    nodes = []

    comp_name = comp.DisplayName if comp.DisplayName else "Component"
    part_num = comp.Name if comp.Name else comp_name
    node_id = "NX-" + str(comp.Tag)

    children = comp.GetChildren()
    is_assembly = len(children) > 0

    model_type = "NX Root Assembly" if (depth == 0 and is_assembly) else (
        "NX Subassembly" if is_assembly else "NX Component"
    )

    try:
        theUFSession.Assem.EnsurePartIsLoaded(comp.Tag)
    except Exception:
        pass

    proto_part = None
    try:
        proto = comp.Prototype
        if proto:
            part_tag = proto.Tag
            proto_part = NXOpen.Utilities.NXObjectManager.Get(part_tag)
            if hasattr(proto_part, 'Leaf') and proto_part.Leaf:
                part_num = proto_part.Leaf
    except Exception:
        pass

    part_by_name = find_session_part_by_name(theSession, comp_name) or find_session_part_by_name(theSession, part_num)

    material_name, mass, vol, area, density, cog, all_attrs = get_material_and_mass_deep(
        theSession, theUFSession, comp, proto_part, part_by_name
    )

    node_data = {
        "productId": node_id,
        "nodeId": node_id,
        "name": comp_name,
        "partNumber": part_num,
        "parentId": parent_id,
        "modelType": model_type,
        "quantity": 1,
        "materialName": material_name,
        "weight": str(round(mass, 4)) if mass > 0 else "0.0",
        "weightUnit": "kg",
        "density": density,
        "volume": vol,
        "surfaceArea": area,
        "centerOfGravity": cog,
        "nxAttributes": all_attrs,
        "depth": depth
    }
    nodes.append(node_data)

    for ch in children:
        nodes.extend(process_component_tree(theSession, theUFSession, ch, parent_id=node_id, depth=depth+1))

    return nodes

def rollup_masses(nodes):
    node_map = {n["nodeId"]: n for n in nodes}
    for n in reversed(nodes):
        if n.get("parentId") and n["parentId"] in node_map:
            p = node_map[n["parentId"]]
            child_mass = float(n.get("weight") or 0.0)
            parent_mass = float(p.get("weight") or 0.0)
            if parent_mass == 0.0 or p.get("modelType") in ("NX Root Assembly", "NX Subassembly"):
                p["weight"] = str(round(parent_mass + child_mass, 4))

def main():
    theSession = NXOpen.Session.GetSession()
    theUFSession = NXOpen.UF.UFSession.GetUFSession()

    work_part = theSession.Parts.Work
    if not work_part:
        return

    root_comp = work_part.ComponentAssembly.RootComponent

    if root_comp:
        bom_nodes = process_component_tree(theSession, theUFSession, root_comp, parent_id=None, depth=0)
        rollup_masses(bom_nodes)
    else:
        mat, mass, vol, area, den, cog, all_attrs = get_material_and_mass_deep(
            theSession, theUFSession, None, work_part, work_part
        )
        bom_nodes = [{
            "productId": "NX-" + str(work_part.Tag),
            "nodeId": "NX-" + str(work_part.Tag),
            "name": work_part.Leaf,
            "partNumber": work_part.Leaf,
            "parentId": None,
            "modelType": "NX Component",
            "quantity": 1,
            "materialName": mat,
            "weight": str(round(mass, 4)) if mass > 0 else "0.0",
            "weightUnit": "kg",
            "density": den,
            "volume": vol,
            "surfaceArea": area,
            "centerOfGravity": cog,
            "nxAttributes": all_attrs,
            "depth": 0
        }]

    json_bytes = json.dumps(bom_nodes, indent=2).encode('utf-8')
    req = urllib.request.Request(
        "http://htx.local/api/nx/assembly",
        data=json_bytes,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            pass
    except Exception:
        pass

    try:
        theUFSession.Web.OpenUrl("http://htx.local/nx-structure")
    except Exception:
        pass

if __name__ == "__main__":
    main()
`;

// ── Tree Construction Helpers ─────────────────────────────────

interface TreeNxNode extends NxBomNode {
  children: TreeNxNode[];
  depth: number;
}

function buildNxTree(nodes: NxBomNode[]): TreeNxNode[] {
  const nodeMap = new Map<string, TreeNxNode>();
  const roots: TreeNxNode[] = [];

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

  function fixDepth(node: TreeNxNode, depth: number) {
    node.depth = depth;
    for (const child of node.children) fixDepth(child, depth + 1);
  }
  for (const root of roots) fixDepth(root, 0);

  return roots;
}

function flattenNxTree(roots: TreeNxNode[], expanded: Set<string>): TreeNxNode[] {
  const result: TreeNxNode[] = [];
  function walk(node: TreeNxNode) {
    result.push(node);
    const id = node.nodeId || node.productId;
    if (expanded.has(id)) {
      for (const child of node.children) walk(child);
    }
  }
  for (const root of roots) walk(root);
  return result;
}

function countDescendants(node: TreeNxNode): number {
  let count = node.children.length;
  for (const ch of node.children) count += countDescendants(ch);
  return count;
}

// ── Component ──────────────────────────────────────────────────

export function NxStructurePage() {
  const { toast } = useToast();

  const [activeDatasetKey, setActiveDatasetKey] = useState<string>('nx-empty');
  const [nodes, setNodes] = useState<NxBomNode[]>([]);
  const [liveLoadedAt, setLiveLoadedAt] = useState<Date | null>(null);

  // UI state
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Dialogs
  const [isScriptOpen, setIsScriptOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Filtered & Tree Structured Data
  const treeRoots = useMemo(() => buildNxTree(nodes), [nodes]);
  const flatTree = useMemo(() => flattenNxTree(treeRoots, expanded), [treeRoots, expanded]);

  const filteredNodes = useMemo(() => {
    if (!searchTerm.trim()) return flatTree;
    const term = searchTerm.toLowerCase();
    return flatTree.filter(n =>
      n.name.toLowerCase().includes(term) ||
      (n.partNumber && n.partNumber.toLowerCase().includes(term)) ||
      (n.materialName && n.materialName.toLowerCase().includes(term)) ||
      n.modelType.toLowerCase().includes(term) ||
      (n.productId && n.productId.toLowerCase().includes(term))
    );
  }, [flatTree, searchTerm]);

  // Selected Node Details
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find(n => (n.nodeId || n.productId) === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  // HALB material lookup for the selected node
  const [halbMaterial, setHalbMaterial] = useState<HalbMaterialData | null>(null);
  const [halbLoading, setHalbLoading] = useState(false);
  const [halbError, setHalbError] = useState<string | null>(null);

  useEffect(() => {
    const materialName = selectedNode?.materialName;
    if (!materialName || materialName === 'Not Assigned' || materialName === 'Structural Assembly' || materialName === 'Multi-Material') {
      setHalbMaterial(null);
      setHalbError(null);
      setHalbLoading(false);
      return;
    }

    const target = materialName.trim().toLowerCase();
    let cancelled = false;
    async function lookup() {
      setHalbLoading(true);
      setHalbError(null);
      try {
        const metadata = await fetchRepoMetadata();
        if (cancelled) return;
        const repos = metadata?.repos || [];
        const halbRepo = repos.find(r => r.data_folders?.some(f => f.folder.includes('semi-finished')));
        if (!halbRepo) {
          if (!cancelled) setHalbMaterial(null);
          return;
        }

        const configId = halbRepo.config_id;
        const folder = halbRepo.data_folders.find(f => f.folder.includes('semi-finished'))!.folder;
        const params = new URLSearchParams();
        if (configId) params.set('config_id', configId);
        if (folder !== 'products') params.set('folder', folder);

        const cacheKey = `${configId || 'default'}:${folder}`;
        let halbEntries: HalbMaterialData[] = [];
        const cached = halbProductsCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < HALB_PRODUCTS_CACHE_TTL_MS) {
          halbEntries = cached.entries;
        } else {
          const res = await apiFetch(`/api/list-products?${params.toString()}`);
          if (!res.ok) {
            if (!cancelled) setHalbError('Failed to fetch HALB data');
            return;
          }
          if (cancelled) return;
          const result = await res.json();
          halbEntries = Array.isArray(result.data) ? result.data : [];
          halbProductsCache.set(cacheKey, { ts: Date.now(), entries: halbEntries });
        }

        // Exact or fuzzy match against material database
        const match = halbEntries.find(e => {
          const pName = (e.productName || '').trim().toLowerCase();
          const desig = (e.designation || '').trim().toLowerCase();
          const mName = (e.materialName || '').trim().toLowerCase();
          return pName === target || desig === target || mName === target ||
                 target.includes(pName) || pName.includes(target) ||
                 target.includes(desig) || desig.includes(target);
        });

        if (!cancelled) {
          setHalbMaterial(match || null);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setHalbMaterial(null);
          setHalbError(error instanceof Error ? error.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) setHalbLoading(false);
      }
    }
    void lookup();
    return () => { cancelled = true; };
  }, [selectedNode?.materialName]);

  // Total Assembly Weight / Mass
  const totalWeightKg = useMemo(() => {
    const root = nodes.find(n => !n.parentId);
    if (root && root.weight) return parseFloat(String(root.weight));
    return nodes.reduce((sum, n) => sum + (parseFloat(String(n.weight)) || 0), 0);
  }, [nodes]);

  // Expand / Collapse
  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const allIds = new Set<string>();
    for (const n of nodes) allIds.add(n.nodeId || n.productId);
    setExpanded(allIds);
  }, [nodes]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  // Helper to load parsed nodes into state
  const loadNodes = useCallback((newNodes: NxBomNode[], sourceLabel: string) => {
    setNodes(newNodes);
    setActiveDatasetKey('nx-live');
    setLiveLoadedAt(new Date());

    const newExpanded = new Set<string>();
    for (const n of newNodes) {
      if (!n.parentId || (n.modelType && (n.modelType.includes('Assembly') || n.modelType.includes('Subassembly')))) {
        newExpanded.add(n.nodeId || n.productId);
      }
    }
    setExpanded(newExpanded);
    setSelectedNodeId(null);

    const rootNode = newNodes.find(n => !n.parentId) || newNodes[0];
    toast({
      title: 'NX Baugruppe geladen!',
      description: `${rootNode?.name || 'Assembly'} (${newNodes.length} Komponenten) über ${sourceLabel}`,
    });
  }, [toast]);

  // ── 1-CLICK DIRECT LOAD FROM NX BUTTON HANDLER ────────────────
  const handleFetchFromNx = async () => {
    setIsLoadingLive(true);
    let loaded = false;

    // 1. Try Backend NX Endpoint (/api/nx/assembly)
    try {
      const res = await apiFetch('/api/nx/assembly');
      if (res.ok) {
        const data = await res.json();
        const dataArray: NxBomNode[] = Array.isArray(data) ? data : (data.nodes || [data]);
        if (dataArray.length > 0) {
          loadNodes(dataArray, 'Live API');
          loaded = true;
        }
      }
    } catch {
      // ignore, try next source
    }

    // 2. Try Direct Local Bridge (localhost:8765) if running
    if (!loaded) {
      try {
        const localRes = await fetch('http://localhost:8765/api/nx/assembly', { signal: AbortSignal.timeout(1000) });
        if (localRes.ok) {
          const localData = await localRes.json();
          const localArray: NxBomNode[] = Array.isArray(localData) ? localData : (localData.nodes || [localData]);
          if (localArray.length > 0) {
            loadNodes(localArray, 'NX Local Bridge');
            loaded = true;
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Try OS Clipboard (if user ran NX journal that copied JSON)
    if (!loaded && navigator.clipboard && navigator.clipboard.readText) {
      try {
        const clipText = await navigator.clipboard.readText();
        if (clipText && clipText.trim().startsWith('[') && clipText.includes('productId')) {
          const parsed = JSON.parse(clipText);
          if (Array.isArray(parsed) && parsed.length > 0) {
            loadNodes(parsed, 'Clipboard (NX Journal)');
            loaded = true;
          }
        }
      } catch {
        // ignore clipboard permissions
      }
    }

    setIsLoadingLive(false);

    if (!loaded) {
      toast({
        title: 'Keine aktive NX-Baugruppe gefunden',
        description: 'Führe das NX Python Script in Siemens NX aus, um die Baugruppe mit 1 Klick zu übertragen.',
        variant: 'destructive',
      });
      setIsScriptOpen(true);
    }
  };

  const handleResetNxAssembly = async () => {
    setIsResetting(true);
    try {
      const res = await apiFetch('/api/nx/assembly', { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      setNodes([]);
      setActiveDatasetKey('nx-empty');
      setLiveLoadedAt(null);
      setExpanded(new Set());
      setSelectedNodeId(null);
      toast({
        title: 'NX-BOM zurückgesetzt',
        description: 'Die nächste Baugruppe kann jetzt neu aus Siemens NX geladen werden.',
      });
    } catch (err: unknown) {
      toast({
        title: 'NX-BOM konnte nicht zurückgesetzt werden',
        description: err instanceof Error ? err.message : 'Backend nicht erreichbar',
        variant: 'destructive',
      });
    } finally {
      setIsResetting(false);
    }
  };

  // Check on component mount if an NX assembly is already waiting
  useEffect(() => {
    const checkInitial = async () => {
      try {
        const res = await apiFetch('/api/nx/assembly');
        if (res.ok) {
          const data = await res.json();
          const dataArray: NxBomNode[] = Array.isArray(data) ? data : (data.nodes || [data]);
          if (dataArray.length > 0) {
            loadNodes(dataArray, 'Live Backend');
          }
        }
      } catch {
        // silent fail on mount
      }
    };
    void checkInitial();
  }, [loadNodes]);

  // Copy Script to Clipboard
  const handleCopyScript = () => {
    navigator.clipboard.writeText(NX_PYTHON_SCRIPT);
    setIsCopied(true);
    toast({
      title: 'Script Copied',
      description: 'NX Open Python script copied to clipboard. Run it inside Siemens NX Journal.',
    });
    setTimeout(() => setIsCopied(false), 2500);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* ── Top Header Toolbar ──────────────────────────────────── */}
      <div className="px-6 py-3 border-b bg-card flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 shadow-sm">
            <Boxes className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Product Design (as-designed)</h1>
              {activeDatasetKey === 'nx-live' ? (
                <Badge className="text-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live NX Session
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* PRIMARY 1-CLICK BUTTON */}
          <Button
            onClick={handleFetchFromNx}
            disabled={isLoadingLive || isResetting}
            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm gap-2 font-semibold text-xs px-3.5 h-8.5"
          >
            {isLoadingLive ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 fill-yellow-300 text-yellow-300" />
            )}
            <span>Baugruppe aus NX laden</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleResetNxAssembly}
            disabled={isLoadingLive || isResetting}
            className="text-xs gap-1.5 h-8 border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
            title="Aktive NX-BOM aus Backend und Ansicht löschen"
          >
            {isResetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            NX-BOM zurücksetzen
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsScriptOpen(true)}
            className="text-xs gap-1.5 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 h-8"
          >
            <Code2 className="h-3.5 w-3.5" />
            NX Python Script
          </Button>

        </div>
      </div>

      {/* ── Sub-bar: Search, stats & tree controls ─────────────── */}
      <div className="px-6 py-2 border-b bg-muted/20 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search components, part number, material..."
              className="pl-8 h-7.5 text-xs bg-background"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {liveLoadedAt && (
            <>
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Live synchronisiert ({liveLoadedAt.toLocaleTimeString()})</span>
              </div>
              <span className="text-border">|</span>
            </>
          )}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            <span>{nodes.length} Components</span>
          </div>
          <span className="text-border">|</span>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Scale className="h-3.5 w-3.5" />
            <span>Total: <strong>{totalWeightKg.toFixed(2)} kg</strong></span>
          </div>
          <span className="text-border">|</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={expandAll} className="h-7 text-xs px-2">
              Expand All
            </Button>
            <Button variant="ghost" size="sm" onClick={collapseAll} className="h-7 text-xs px-2">
              Collapse All
            </Button>
          </div>
        </div>
      </div>

      {/* ── Main Layout: Table + Detail Side-Panel ──────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Hierarchical BOM Table */}
        <div className="flex-1 overflow-auto border-r">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[320px]">CAD Component & Hierarchy</TableHead>
                <TableHead className="w-[150px]">Part Number / ID</TableHead>
                <TableHead className="w-[140px]">Type</TableHead>
                <TableHead className="w-[180px]">Material</TableHead>
                <TableHead className="w-[100px] text-right">Mass (kg)</TableHead>
                <TableHead className="w-[60px] text-center">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredNodes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    {searchTerm.trim() ? 'No NX components match your filter.' : 'No NX components loaded.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredNodes.map(node => {
                  const id = node.nodeId || node.productId;
                  const isSelected = selectedNodeId === id;
                  const hasChildren = node.children && node.children.length > 0;
                  const isExpanded = expanded.has(id);
                  const descendantCount = countDescendants(node);

                  return (
                    <TableRow
                      key={id}
                      onClick={() => setSelectedNodeId(isSelected ? null : id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-primary/10 hover:bg-primary/15'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      {/* Name & Indentation Tree */}
                      <TableCell className="font-medium text-xs">
                        <div
                          className="flex items-center gap-1.5"
                          style={{ paddingLeft: `${node.depth * 20}px` }}
                        >
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                toggleExpand(id);
                              }}
                              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ) : (
                            <span className="w-4.5 inline-block" />
                          )}

                          {node.modelType.includes('Assembly') ? (
                            <Boxes className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                          ) : node.modelType.includes('StdPart') ? (
                            <SlidersHorizontal className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                          ) : (
                            <Box className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          )}

                          <span className="truncate max-w-[220px]" title={node.name}>
                            {node.name}
                          </span>

                          {hasChildren && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                              {descendantCount}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Part Number */}
                      <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-[150px]">
                        {node.partNumber || node.productId}
                      </TableCell>

                      {/* Model Type */}
                      <TableCell className="text-xs">
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-medium border-0 ${modelTypeBadge(node.modelType)}`}
                        >
                          {node.modelType}
                        </Badge>
                      </TableCell>

                      {/* Material */}
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {node.materialName || '—'}
                      </TableCell>

                      {/* Weight */}
                      <TableCell className="text-xs text-right font-mono">
                        {node.weight ? `${node.weight} ${node.weightUnit || 'kg'}` : '—'}
                      </TableCell>

                      {/* Qty */}
                      <TableCell className="text-xs text-center font-mono text-muted-foreground">
                        {node.quantity ?? 1}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Right: Detail Side Panel (Slides in when selected) */}
        {selectedNode && (
          <div className="w-[380px] lg:w-[420px] shrink-0 border-l bg-card flex flex-col h-full overflow-hidden shadow-lg animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-4 border-b flex items-start justify-between gap-2 bg-muted/10">
              <div className="space-y-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] bg-indigo-500/10 text-indigo-600 border-indigo-500/20">
                    {selectedNode.modelType}
                  </Badge>
                  {selectedNode.revision && (
                    <Badge variant="secondary" className="text-[10px]">
                      {selectedNode.revision}
                    </Badge>
                  )}
                </div>
                <h3 className="font-semibold text-sm truncate" title={selectedNode.name}>
                  {selectedNode.name}
                </h3>
                <p className="text-xs font-mono text-muted-foreground truncate">
                  ID: {selectedNode.partNumber || selectedNode.productId}
                </p>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedNodeId(null)}
                className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Content Tabs */}
            <Tabs defaultValue="composition" className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 pt-2 border-b">
                <TabsList className="grid grid-cols-4 h-8 w-full text-xs">
                  <TabsTrigger value="composition" className="text-[11px] px-1">Composition</TabsTrigger>
                  <TabsTrigger value="cad" className="text-[11px] px-1">Mass & CAD</TabsTrigger>
                  <TabsTrigger value="attrs" className="text-[11px] px-1">Attributes</TabsTrigger>
                  <TabsTrigger value="dpp" className="text-[11px] px-1">DPP / AAS</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="composition" className="flex-1 overflow-y-auto p-4 space-y-5 mt-4">
                <MaterialCompositionContent
                  material={halbMaterial}
                  materialName={selectedNode.materialName}
                  loading={halbLoading}
                  error={halbError}
                />
              </TabsContent>

              {/* Tab: Physical & CAD Mass */}
              <TabsContent value="cad" className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                <div className="space-y-3">
                  <h4 className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                    CAD Mass Properties (Solid & Geometry)
                  </h4>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-lg border bg-muted/20">
                      <span className="text-muted-foreground text-[10px]">Material</span>
                      <p className="font-medium mt-0.5 truncate">{selectedNode.materialName || 'Not Assigned'}</p>
                    </div>
                    <div className="p-2.5 rounded-lg border bg-muted/20">
                      <span className="text-muted-foreground text-[10px]">Mass / Weight</span>
                      <p className="font-medium mt-0.5 font-mono">{selectedNode.weight ? `${selectedNode.weight} ${selectedNode.weightUnit || 'kg'}` : 'N/A'}</p>
                    </div>
                    {selectedNode.density && (
                      <div className="p-2.5 rounded-lg border bg-muted/20">
                        <span className="text-muted-foreground text-[10px]">Density</span>
                        <p className="font-medium mt-0.5 font-mono">{selectedNode.density} g/cm³</p>
                      </div>
                    )}
                    {selectedNode.volume && (
                      <div className="p-2.5 rounded-lg border bg-muted/20">
                        <span className="text-muted-foreground text-[10px]">Volume</span>
                        <p className="font-medium mt-0.5 font-mono">{selectedNode.volume} mm³</p>
                      </div>
                    )}
                    {selectedNode.surfaceArea && (
                      <div className="p-2.5 rounded-lg border bg-muted/20">
                        <span className="text-muted-foreground text-[10px]">Surface Area</span>
                        <p className="font-medium mt-0.5 font-mono">{selectedNode.surfaceArea} mm²</p>
                      </div>
                    )}
                    <div className="p-2.5 rounded-lg border bg-muted/20">
                      <span className="text-muted-foreground text-[10px]">Quantity in Assembly</span>
                      <p className="font-medium mt-0.5 font-mono">{selectedNode.quantity ?? 1}</p>
                    </div>
                  </div>

                  {selectedNode.centerOfGravity && (
                    <div className="p-2.5 rounded-lg border bg-muted/20 space-y-1">
                      <span className="text-muted-foreground text-[10px]">Center of Gravity (X, Y, Z) mm</span>
                      <p className="font-mono text-xs">
                        X: {selectedNode.centerOfGravity.x.toFixed(1)} | Y: {selectedNode.centerOfGravity.y.toFixed(1)} | Z: {selectedNode.centerOfGravity.z.toFixed(1)}
                      </p>
                    </div>
                  )}

                  {selectedNode.boundingBox && (
                    <div className="p-2.5 rounded-lg border bg-muted/20 space-y-1">
                      <span className="text-muted-foreground text-[10px]">Bounding Box (L × W × H) mm</span>
                      <p className="font-mono text-xs">
                        {selectedNode.boundingBox.x} × {selectedNode.boundingBox.y} × {selectedNode.boundingBox.z} mm
                      </p>
                    </div>
                  )}

                  {selectedNode.description && (
                    <div className="p-2.5 rounded-lg border bg-muted/20 space-y-1">
                      <span className="text-muted-foreground text-[10px]">Description</span>
                      <p className="text-xs text-muted-foreground">{selectedNode.description}</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Tab: NX Attributes */}
              <TabsContent value="attrs" className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
                <h4 className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                  NX Part & User Attributes
                </h4>
                {selectedNode.nxAttributes && Object.keys(selectedNode.nxAttributes).length > 0 ? (
                  <div className="border rounded-lg divide-y overflow-hidden">
                    {Object.entries(selectedNode.nxAttributes).map(([k, v]) => (
                      <div key={k} className="p-2 flex flex-col gap-0.5 bg-background hover:bg-muted/20">
                        <span className="font-mono font-semibold text-[11px] text-indigo-600 dark:text-indigo-400">
                          {k}
                        </span>
                        <span className="text-xs break-all text-muted-foreground font-mono">
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-muted-foreground border rounded-lg">
                    No NX User Attributes extracted for this component.
                  </div>
                )}
              </TabsContent>

              {/* Tab: AAS / DPP Readiness */}
              <TabsContent value="dpp" className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
                <h4 className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                  AAS & Digital Product Passport Ready
                </h4>
                <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-500" />
                    <span className="font-medium">Fertigprodukt (FERT) Mapping</span>
                  </div>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    This NX component is mapped directly to the HealthTrack-X Finished Product BOM schema (IDTA 02006 / AAS Bill of Material).
                  </p>
                  <div className="pt-2 border-t space-y-1 font-mono text-[11px]">
                    <div>• Product ID: <span className="text-foreground">{selectedNode.productId}</span></div>
                    <div>• Material ID: <span className="text-foreground">{selectedNode.materialName || 'Unassigned'}</span></div>
                    <div>• Model Type: <span className="text-foreground">{selectedNode.modelType}</span></div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {/* ── NX Open Python Script Dialog ───────────────────────── */}
      <Dialog open={isScriptOpen} onOpenChange={setIsScriptOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5 text-indigo-500" />
              NX Open Python Extraction Script
            </DialogTitle>
            <DialogDescription>
              Run this script directly in Siemens NX (Journal / Developer tab) to export the active assembly tree with mass properties and attributes.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto rounded-md border bg-slate-950 p-3 my-2 text-slate-50 font-mono text-xs">
            <pre>{NX_PYTHON_SCRIPT}</pre>
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between w-full">
            <span className="text-xs text-muted-foreground">
              Compatible with Siemens NX 12 - NX 2406+
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setIsScriptOpen(false)}>
                Close
              </Button>
              <Button onClick={handleCopyScript} className="gap-1.5">
                {isCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {isCopied ? 'Copied!' : 'Copy Script'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
