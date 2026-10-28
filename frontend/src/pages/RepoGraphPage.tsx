/**
 * Repo Graph Page
 * Visualizes GitHub repository metadata in an interactive React Flow diagram.
 * Each repo is displayed as a group containing nodes for directories, files,
 * languages, permissions, and recent commits.
 */

import { useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  NodeTypes,
  NodeProps,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from '../components/ui/button';
import {
  GitBranch,
  Shield,
  RefreshCw,
  Loader2,
  AlertCircle,
  Globe,
  Lock,
  Database,
  Tag,
  Cog,
  FileJson,
  Sparkles,
  Cpu,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAppProfile } from '../contexts/AppProfileContext';
import { apiFetch } from '../config/api';

// ─── Types ──────────────────────────────────────────────────────────────

interface TreeEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number | null;
  children?: TreeEntry[];
}

interface RepoCommit {
  sha: string;
  message: string;
  author: string;
  date: string | null;
}

interface SampleField {
  field: string;
  type: string;
  example: string;
  unit?: string;
  description?: string;
  format?: string;
  pattern?: string;
  source?: 'schema' | 'ai-generated' | 'rule-based';
}

interface DataFolder {
  folder: string;
  path: string;
  total_files: number;
  json_files: number;
  other_files: number;
  sample_fields: SampleField[];
  sample_file: string | null;
  array_length?: number;
  file_format?: string;
  display_name?: string;
  section?: string;
  subsection?: string;
}

interface AutomationStep {
  step: string;
  description?: string;
  output_format?: string;
  output_path?: string;
}

interface AutomationInfo {
  pipeline?: string;
  trigger?: string;
  steps?: AutomationStep[];
  output_formats?: string[];
}

interface RepoMetadata {
  config_id: string;
  config_name: string;
  full_name: string;
  name: string;
  description?: string;
  private?: boolean;
  default_branch?: string;
  branch: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  pushed_at?: string;
  size?: number;
  language?: string;
  topics?: string[];
  visibility?: string;
  permissions?: { admin: boolean; push: boolean; pull: boolean; maintain?: boolean; triage?: boolean };
  permission_level?: string;
  tree?: TreeEntry[];
  languages?: Record<string, number>;
  recent_commits?: RepoCommit[];
  data_folders?: DataFolder[];
  automation?: AutomationInfo;
  readme_snippet?: string;
  error?: string;
}

// ─── Custom Node Components ─────────────────────────────────────────────

/** Repo header node – shows repo name, topics, visibility, description */
function RepoHeaderNode({ data }: NodeProps) {
  const isPrivate = data.private;
  const topics: string[] = data.topics || [];
  return (
    <div className="px-4 py-3 shadow-lg rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 dark:from-gray-800 dark:to-gray-900 border-2 border-slate-400 dark:border-gray-600 min-w-[280px] max-w-[340px] transition-shadow hover:shadow-xl">
      <Handle type="target" position={Position.Top} className="w-3 h-3" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="w-3 h-3" style={{ left: RAIL_INSET - GROUP_PAD_LEFT + 5 }} />
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="h-5 w-5 text-slate-700 dark:text-white flex-shrink-0" />
        <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{data.repoName || data.label}</span>
        {isPrivate ? (
          <Lock className="h-3.5 w-3.5 text-yellow-400 flex-shrink-0" />
        ) : (
          <Globe className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
        )}
      </div>
      {data.label !== data.repoName && data.repoName && (
        <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate mb-1">{data.label}</div>
      )}
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {topics.map((t, i) => (
            <span key={i} className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-medium">{t}</span>
          ))}
        </div>
      )}
      {data.description && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{data.description}</p>
      )}
      <div className="flex gap-3 mt-2 text-[10px] text-gray-500 dark:text-gray-400">
        <span>Branch: <span className="text-gray-800 dark:text-gray-200">{data.branch}</span></span>
        {data.language && <span>Lang: <span className="text-gray-800 dark:text-gray-200">{data.language}</span></span>}
        {data.size != null && <span>{(data.size * 0.0009765625).toFixed(1)} MB</span>}
      </div>
    </div>
  );
}

/** Permission badge node */
function PermissionNode({ data }: NodeProps) {
  const levelColors: Record<string, string> = {
    admin: 'from-red-100 to-red-200 border-red-400 dark:from-red-500/30 dark:to-red-700/30 dark:border-red-500/60',
    write: 'from-amber-100 to-amber-200 border-amber-400 dark:from-amber-500/30 dark:to-amber-700/30 dark:border-amber-500/60',
    read: 'from-green-100 to-green-200 border-green-400 dark:from-green-500/30 dark:to-green-700/30 dark:border-green-500/60',
    none: 'from-gray-100 to-gray-200 border-gray-400 dark:from-gray-500/30 dark:to-gray-700/30 dark:border-gray-500/60',
    unknown: 'from-gray-100 to-gray-200 border-gray-400 dark:from-gray-500/30 dark:to-gray-700/30 dark:border-gray-500/60',
    error: 'from-red-100 to-red-200 border-red-400 dark:from-red-500/30 dark:to-red-700/30 dark:border-red-500/60',
  };
  const colors = levelColors[data.level] || levelColors.unknown;

  return (
    <div className={`px-3 py-2 shadow-md rounded-lg bg-gradient-to-br ${colors} border min-w-[160px]`}>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2" />
      <div className="flex items-center gap-2 mb-1">
        <Shield className="h-4 w-4 text-gray-700 dark:text-white/80 flex-shrink-0" />
        <span className="text-xs font-semibold text-gray-800 dark:text-white/90">Permissions</span>
      </div>
      <div className="text-[11px] text-gray-600 dark:text-white/70 space-y-0.5">
        <div>Level: <span className="font-medium text-gray-800 dark:text-white/90 uppercase">{data.level}</span></div>
        {data.perms && (
          <div className="flex gap-2 flex-wrap mt-1">
            {data.perms.admin && <span className="bg-red-500/40 px-1.5 py-0.5 rounded text-[10px]">Admin</span>}
            {data.perms.push && <span className="bg-amber-500/40 px-1.5 py-0.5 rounded text-[10px]">Push</span>}
            {data.perms.pull && <span className="bg-green-500/40 px-1.5 py-0.5 rounded text-[10px]">Pull</span>}
            {data.perms.maintain && <span className="bg-blue-500/40 px-1.5 py-0.5 rounded text-[10px]">Maintain</span>}
            {data.perms.triage && <span className="bg-purple-500/40 px-1.5 py-0.5 rounded text-[10px]">Triage</span>}
          </div>
        )}
      </div>
    </div>
  );
}



/** Group node for repo container */
function RepoGroupNode({ data }: NodeProps) {
  const borderColor = data.isActiveProfile
    ? 'border-amber-400 dark:border-amber-400 ring-2 ring-amber-400/30'
    : data.hasError
      ? 'border-red-500 dark:border-red-500/50'
      : data.isPrivate
        ? 'border-amber-400 dark:border-amber-500/40'
        : 'border-slate-400 dark:border-slate-400/50';

  return (
    <div
      className={`rounded-xl bg-transparent border-2 ${borderColor} ${data.isActiveProfile ? 'transition-colors duration-500' : ''}`}
      style={{
        width: data.width || 600,
        height: data.height || 500,
        pointerEvents: 'none',
      }}
    >
      {data.groupLabel && (
        <div className="absolute -top-3 left-4 px-2 bg-background text-[11px] font-medium text-muted-foreground flex items-center gap-1">
          {data.isActiveProfile && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
          {data.groupLabel}
        </div>
      )}
    </div>
  );
}

/** Data folder node – compact view with all fields inside one box */
function DataFolderNode({ data }: NodeProps) {
  const folder: DataFolder = data.folder;
  const fields: SampleField[] = folder.sample_fields || [];
  const typeColor: Record<string, string> = {
    str: 'text-green-600 dark:text-green-400',
    int: 'text-blue-600 dark:text-blue-400',
    float: 'text-blue-500 dark:text-blue-300',
    bool: 'text-yellow-600 dark:text-yellow-400',
    dict: 'text-purple-600 dark:text-purple-400',
    list: 'text-cyan-600 dark:text-cyan-400',
    'jsonld-meta': 'text-gray-500',
  };

  // Categorize fields by source
  const schemaFields = fields.filter(f => f.type !== 'jsonld-meta' && (!f.source || f.source === 'schema'));
  const ruleBasedFields = fields.filter(f => f.source === 'rule-based');
  const aiGeneratedFields = fields.filter(f => f.source === 'ai-generated');
  const metaFields = fields.filter(f => f.type === 'jsonld-meta');
  const hasCategories = schemaFields.length > 0 || ruleBasedFields.length > 0 || aiGeneratedFields.length > 0;

  /** Render a field row */
  const renderField = (f: SampleField, i: number, icon: React.ReactNode) => (
    <div key={i} className="flex items-center gap-1.5 text-[11px]" title={f.description || ''}>
      {icon}
      <span className="text-gray-900 dark:text-white/80 font-mono">{f.field}</span>
      {f.unit && (
        <span className="text-[8px] text-gray-400 dark:text-white/30">[{f.unit}]</span>
      )}
      <span className={`ml-auto text-[9px] ${typeColor[f.type] || 'text-gray-400'}`}>{f.type}</span>
    </div>
  );

  return (
    <div className="px-3 py-2 shadow-md rounded-lg bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-500/15 dark:to-orange-500/15 border border-amber-400 dark:border-amber-500/40 min-w-[260px] max-w-[380px] max-h-[480px] overflow-y-auto nowheel">
      <Handle type="target" position={Position.Left} className="w-2 h-2" style={{ top: 20 }} />
      <div className="flex items-center gap-2 mb-1">
        <Database className="h-4 w-4 text-amber-500 dark:text-amber-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{folder.display_name || `${folder.folder}/`}</span>
        {folder.file_format && (
          <span className="ml-auto flex items-center gap-1 text-[9px] bg-amber-200 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded font-medium">
            <FileJson className="h-2.5 w-2.5" />
            {folder.file_format}
          </span>
        )}
      </div>
      {folder.section && (
        <div className="text-[11px] font-semibold text-gray-800 dark:text-white/80 mb-0.5">{folder.section}</div>
      )}
      {folder.subsection && (
        <div className="text-[10px] text-gray-500 dark:text-white/50 mb-1 leading-tight">{folder.subsection}</div>
      )}
      <div className="text-[10px] text-gray-500 dark:text-white/40 mb-1 truncate font-mono">{folder.path}</div>
      <div className="flex gap-3 text-[10px] text-gray-500 dark:text-white/50 mb-2">
        {folder.total_files > 0 && <span>{folder.total_files} files</span>}
        {folder.json_files > 0 && <span>{folder.json_files} JSON</span>}
        {folder.array_length != null && <span>{folder.array_length} records</span>}
      </div>

      {/* ── Category 1: Schema (user-entered values) ── */}
      {schemaFields.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400/70 mb-1 border-t border-amber-500/20 pt-1 font-semibold">
            <Tag className="h-2.5 w-2.5" />
            Schema{folder.sample_file ? ` (${folder.sample_file})` : ''}
          </div>
          <div className="space-y-0.5 mb-1.5">
            {schemaFields.map((f, i) => renderField(f, i,
              <Tag className="h-2.5 w-2.5 text-amber-500 dark:text-amber-500/60 flex-shrink-0" />
            ))}
          </div>
        </>
      )}

      {/* ── Category 2: Rule-based generated values ── */}
      {ruleBasedFields.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 text-[10px] text-violet-600 dark:text-violet-400/70 mb-1 border-t border-violet-500/20 pt-1 font-semibold">
            <Cpu className="h-2.5 w-2.5" />
            Rule-based generated
          </div>
          <div className="space-y-0.5 mb-1.5">
            {ruleBasedFields.map((f, i) => renderField(f, i,
              <Cpu className="h-2.5 w-2.5 text-violet-500 dark:text-violet-500/60 flex-shrink-0" />
            ))}
          </div>
        </>
      )}

      {/* ── Category 3: AI-generated values ── */}
      {aiGeneratedFields.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 text-[10px] text-sky-600 dark:text-sky-400/70 mb-1 border-t border-sky-500/20 pt-1 font-semibold">
            <Sparkles className="h-2.5 w-2.5" />
            AI generated
          </div>
          <div className="space-y-0.5 mb-1.5">
            {aiGeneratedFields.map((f, i) => renderField(f, i,
              <Sparkles className="h-2.5 w-2.5 text-sky-500 dark:text-sky-500/60 flex-shrink-0" />
            ))}
          </div>
        </>
      )}

      {/* ── JSON-LD metadata ── */}
      {metaFields.length > 0 && (
        <div className="mt-1 pt-1 border-t border-amber-500/20">
          <div className="text-[9px] text-gray-400 dark:text-white/30">JSON-LD metadata:</div>
          {metaFields.map((f, i) => (
            <div key={i} className="text-[10px] text-gray-500 dark:text-white/40 truncate">{f.field}</div>
          ))}
        </div>
      )}

      {!hasCategories && fields.length === 0 && (
        <div className="text-[10px] text-gray-400 dark:text-white/30 italic">No schema defined</div>
      )}
    </div>
  );
}

/** Automation box node – compact view with pipeline info and steps in one box */
function AutomationBoxNode({ data }: NodeProps) {
  const auto: AutomationInfo = data.automation || {};
  const steps = auto.steps || [];

  return (
    <div className="px-3 py-2 shadow-md rounded-lg bg-gradient-to-br from-violet-50 to-indigo-100 dark:from-violet-500/15 dark:to-indigo-500/15 border border-violet-400 dark:border-violet-500/40 min-w-[260px] max-w-[350px] max-h-[360px] overflow-y-auto nowheel">
      <Handle type="target" position={Position.Left} className="w-2 h-2" style={{ top: 20 }} />
      <div className="flex items-center gap-2 mb-1">
        <Cog className="h-4 w-4 text-violet-500 dark:text-violet-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Automation</span>
        {auto.output_formats && auto.output_formats.length > 0 && (
          <div className="ml-auto flex flex-wrap gap-1">
            {auto.output_formats.map((fmt, i) => (
              <span key={i} className="inline-flex items-center gap-0.5 text-[8px] bg-violet-200 dark:bg-violet-500/20 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 rounded font-medium">
                <FileJson className="h-2 w-2" />{fmt}
              </span>
            ))}
          </div>
        )}
      </div>
      {auto.pipeline && (
        <div className="text-[11px] text-gray-800 dark:text-white/70 font-medium truncate">{auto.pipeline}</div>
      )}
      {auto.trigger && (
        <div className="text-[10px] text-gray-600 dark:text-white/40 font-mono mb-1">trigger: {auto.trigger}</div>
      )}
      {steps.length > 0 && (
        <>
          <div className="text-[10px] text-gray-500 dark:text-white/40 mb-1 border-t border-violet-500/20 pt-1">
            Steps:
          </div>
          <div className="space-y-1">
            {steps.map((s, i) => (
              <div key={i} className="pl-1">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-violet-600 dark:text-violet-400 font-mono font-bold flex-shrink-0">{i + 1}.</span>
                  <span className="text-gray-900 dark:text-white/80 font-medium">{s.step}</span>
                  {s.output_format && (
                    <span className="ml-auto inline-flex items-center gap-0.5 text-[8px] bg-violet-200 dark:bg-violet-500/20 text-violet-700 dark:text-violet-400 px-1 py-0.5 rounded font-medium">
                      <FileJson className="h-2 w-2" />{s.output_format}
                    </span>
                  )}
                </div>
                {s.description && (
                  <div className="text-[9px] text-gray-500 dark:text-white/35 mt-0.5 truncate pl-4">{s.description}</div>
                )}
                {s.output_path && (
                  <div className="text-[8px] text-gray-400 dark:text-white/30 font-mono mt-0.5 pl-4">→ {s.output_path}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {steps.length === 0 && (
        <div className="text-[10px] text-gray-400 dark:text-white/30 italic">No steps defined</div>
      )}
    </div>
  );
}

/** Invisible junction dot for rail branching */
function JunctionNode(_props: NodeProps) {
  return (
    <div className="w-2.5 h-2.5 rounded-full bg-slate-500 dark:bg-slate-500/60 border border-slate-500 dark:border-slate-500" style={{ marginLeft: -1 }}>
      <Handle type="target" position={Position.Top} className="!w-1.5 !h-1.5 !min-w-0 !min-h-0 opacity-0" />
      <Handle type="source" position={Position.Bottom} id="down" className="!w-1.5 !h-1.5 !min-w-0 !min-h-0 opacity-0" />
      <Handle type="source" position={Position.Right} id="right" className="!w-1.5 !h-1.5 !min-w-0 !min-h-0 opacity-0" style={{ top: '50%' }} />
    </div>
  );
}



// ─── Node Types ─────────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  repoHeader: RepoHeaderNode,
  permission: PermissionNode,
  repoGroup: RepoGroupNode,
  dataFolder: DataFolderNode,
  automationBox: AutomationBoxNode,
  junction: JunctionNode,
};

// ─── Layout helpers ─────────────────────────────────────────────────────

const GROUP_WIDTH = 520;       // wider to fit boxes + rail with padding
const GROUP_HEIGHT = 400;
const GROUP_GAP = 60;
const BOX_GAP = 28;            // equal vertical gap between content boxes
const HANDLE_TOP = 20;         // fixed px offset of the left handle from box top
const GROUP_PAD_LEFT = 30;     // left padding inside group border
const RAIL_INSET = 80;         // rail X from group left edge (more spacing from border)
const BOX_INSET = 130;         // box X from group left edge
const GROUP_PAD_BOTTOM = 30;   // bottom padding inside group border

/** Estimate the rendered height of a compact DataFolder node */
function estimateDataFolderHeight(df: DataFolder): number {
  const fields = df.sample_fields || [];
  const schemaFields = fields.filter(f => f.type !== 'jsonld-meta' && (!f.source || f.source === 'schema'));
  const ruleBasedFields = fields.filter(f => f.source === 'rule-based');
  const aiGeneratedFields = fields.filter(f => f.source === 'ai-generated');
  const metaFields = fields.filter(f => f.type === 'jsonld-meta');
  let h = 72; // base: py-2 (16) + header row+mb-1 (20) + path+mb-1 (18) + stats-area+mb-2 (10) + bottom pad (8)
  if (df.section) h += 18;
  if (df.subsection) h += 16;
  // Category: Schema
  if (schemaFields.length > 0) {
    h += 22;                           // category label + border-t + pt-1 + mb-1
    h += schemaFields.length * 18;     // each field row
    h += 6;                            // mb-1.5 bottom margin
  }
  // Category: Rule-based
  if (ruleBasedFields.length > 0) {
    h += 22;                           // category label + border-t + pt-1 + mb-1
    h += ruleBasedFields.length * 18;
    h += 6;
  }
  // Category: AI-generated
  if (aiGeneratedFields.length > 0) {
    h += 22;                           // category label + border-t + pt-1 + mb-1
    h += aiGeneratedFields.length * 18;
    h += 6;
  }
  if (metaFields.length > 0) {
    h += 18 + metaFields.length * 14;
  }
  if (fields.length === 0) {
    h += 16;
  }
  return Math.min(h, 480);
}

/** Estimate the rendered height of the compact AutomationBox node */
function estimateAutomationBoxHeight(auto: AutomationInfo): number {
  const steps = auto.steps || [];
  let h = 56; // base: py-2 (16) + header row + mb-1 (20) + bottom pad (8) + buffer
  if (auto.pipeline) h += 18;
  if (auto.trigger) h += 18;
  if (steps.length > 0) {
    h += 22; // "Steps:" label + border-t + pt-1 + mb-1
    for (const s of steps) {
      h += 18;                           // step header row
      if (s.description) h += 16;
      if (s.output_path) h += 14;
      h += 4;                            // spacing (space-y-1)
    }
  } else {
    h += 16; // "No steps defined"
  }
  return Math.min(h, 360);
}

function buildNodesAndEdges(repos: RepoMetadata[], activeConfigId?: string | null): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const palette = [
    { stroke: '#94a3b8' },
    { stroke: '#f97316' },
    { stroke: '#8b5cf6' },
    { stroke: '#06b6d4' },
    { stroke: '#ec4899' },
    { stroke: '#10b981' },
  ];

  repos.forEach((repo, idx) => {
    const px = idx * (GROUP_WIDTH + GROUP_GAP) + 20;
    const py = 20;
    const pal = palette[idx % palette.length];
    const prefix = `repo-${idx}`;

    let curY = 110; // start below permission node
    const headerY = curY;
    // Estimate header height: py-3 (24) + name row (24) + full_name? (14) + topics? (22) + desc? (18) + stats row (18)
    let headerHeight = 66; // base: padding + name row + stats
    if (repo.full_name && repo.name && repo.full_name !== repo.name) headerHeight += 14;
    if (repo.topics && repo.topics.length > 0) headerHeight += 22;
    if (repo.description) headerHeight += 18;
    curY += headerHeight + BOX_GAP;

    const dataFolders = repo.data_folders || [];
    const automation = repo.automation;
    const hasAutomation = !!(automation && (
      automation.pipeline ||
      (automation.steps && automation.steps.length > 0) ||
      (automation.output_formats && automation.output_formats.length > 0)
    ));

    // Chain info: boxes with their Y positions for junction placement
    type BoxInfo = { id: string; y: number; height: number };
    const boxes: BoxInfo[] = [];
    const boxX = px + BOX_INSET; // boxes offset to the right, leaving room for the left rail
    const junctionX = px + RAIL_INSET; // x position of the vertical trunk

    // ── Compact data folder boxes (stacked vertically) ──
    dataFolders.forEach((df, fi) => {
      const folderId = `${prefix}-df-${fi}`;
      const h = estimateDataFolderHeight(df);
      nodes.push({
        id: folderId,
        type: 'dataFolder',
        data: { folder: df },
        position: { x: boxX, y: py + curY },
        style: { zIndex: 1 },
      });
      boxes.push({ id: folderId, y: py + curY, height: h });
      curY += h + BOX_GAP;
    });

    // ── Automation compact box ──
    if (hasAutomation) {
      const autoBoxId = `${prefix}-auto-box`;
      const h = estimateAutomationBoxHeight(automation!);
      nodes.push({
        id: autoBoxId,
        type: 'automationBox',
        data: { automation },
        position: { x: boxX, y: py + curY },
        style: { zIndex: 1 },
      });
      boxes.push({ id: autoBoxId, y: py + curY, height: h });
      curY += h + BOX_GAP;
    }

    // ── Trunk + branch edges via junction dots ──
    const railColor = pal.stroke;
    if (boxes.length > 0) {
      const junctionDotSize = 10; // w-2.5 = 10px
      const allJunctionIds: string[] = [];

      boxes.forEach((box, bi) => {
        const jId = `${prefix}-jct-${bi}`;
        const jY = box.y + HANDLE_TOP - junctionDotSize / 2;
        nodes.push({
          id: jId,
          type: 'junction',
          data: {},
          position: { x: junctionX, y: jY },
          style: { zIndex: 2 },
          draggable: false,
          selectable: false,
        });
        allJunctionIds.push(jId);

        // Branch: junction → box (horizontal, right)
        edges.push({
          id: `${prefix}-branch-${bi}`,
          source: jId,
          sourceHandle: 'right',
          target: box.id,
          type: 'straight',
          animated: true,
          style: { strokeWidth: 1.5, stroke: railColor },
        });
      });

      // Trunk: header-bottom → first junction (straight, handle aligned with rail)
      edges.push({
        id: `${prefix}-trunk-top`,
        source: `${prefix}-header`,
        sourceHandle: 'bottom',
        target: allJunctionIds[0],
        type: 'straight',
        animated: true,
        style: { strokeWidth: 1.5, stroke: railColor },
      });

      // Trunk: junction → junction (vertical, straight)
      for (let i = 1; i < allJunctionIds.length; i++) {
        edges.push({
          id: `${prefix}-trunk-${i}`,
          source: allJunctionIds[i - 1],
          sourceHandle: 'down',
          target: allJunctionIds[i],
          type: 'straight',
          animated: true,
          style: { strokeWidth: 1.5, stroke: railColor },
        });
      }
    }

    // Compute actual bottom of all boxes for dynamic height
    const lastBox = boxes.length > 0 ? boxes[boxes.length - 1] : null;
    const contentBottom = lastBox ? (lastBox.y - py + lastBox.height) : curY;
    const dynamicHeight = Math.max(GROUP_HEIGHT, contentBottom + GROUP_PAD_BOTTOM);

    // Group container
    nodes.push({
      id: `${prefix}-group`,
      type: 'repoGroup',
      data: {
        width: GROUP_WIDTH,
        height: dynamicHeight,
        groupLabel: repo.config_name || repo.name,
        isPrivate: repo.private,
        hasError: !!repo.error,
        isActiveProfile: !!(activeConfigId && repo.config_id === activeConfigId),
      },
      position: { x: px, y: py },
      style: { width: GROUP_WIDTH, height: dynamicHeight, zIndex: 0 },
      selectable: false,
      draggable: false,
    });

    // Permission node (above header)
    nodes.push({
      id: `${prefix}-perms`,
      type: 'permission',
      data: {
        level: repo.permission_level || 'unknown',
        perms: repo.permissions,
      },
      position: { x: px + GROUP_PAD_LEFT + 30, y: py + 20 },
      style: { zIndex: 1 },
    });

    // Repo header
    nodes.push({
      id: `${prefix}-header`,
      type: 'repoHeader',
      data: {
        repoName: repo.name,
        label: repo.full_name || repo.name,
        description: repo.description,
        branch: repo.branch,
        language: repo.language,
        size: repo.size,
        private: repo.private,
        topics: repo.topics,
      },
      position: { x: px + GROUP_PAD_LEFT, y: py + headerY },
      style: { zIndex: 1 },
    });

    edges.push({
      id: `${prefix}-e-perms-header`,
      source: `${prefix}-perms`,
      target: `${prefix}-header`,
      animated: true,
      style: { strokeWidth: 1.5, stroke: pal.stroke },
    });

    // Error node
    if (repo.error) {
      nodes.push({
        id: `${prefix}-error`,
        type: 'repoHeader',
        data: {
          label: `\u26a0 ${repo.name}`,
          description: `Error: ${repo.error}`,
          branch: '',
        },
        position: { x: px + 190, y: py + 200 },
        style: { zIndex: 1 },
      });
    }
  });

  return { nodes, edges };
}

// ─── Main Page Component ────────────────────────────────────────────────

export function RepoGraphPage() {
  useTheme(); // subscribe to theme changes for re-render
  const { configId: activeConfigId } = useAppProfile();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repoCount, setRepoCount] = useState(0);
  const [loadTime, setLoadTime] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const fetchMetadata = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    const start = performance.now();

    try {
      const url = refresh
        ? '/api/repo-metadata?refresh=true&depth=full'
        : '/api/repo-metadata?depth=full';
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const repos: RepoMetadata[] = data.repos || [];
      // API response loaded
      setRepoCount(repos.length);
      setFromCache(!refresh && !!data._cached_at);

      const { nodes: n, edges: e } = buildNodesAndEdges(repos, activeConfigId);
      setNodes(n);
      setEdges(e);
      setLoadTime(performance.now() - start);
    } catch (err: any) {
      console.error('Failed to load repo metadata:', err);
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges, activeConfigId]);

  useEffect(() => {
    fetchMetadata(false);  // initial load from cache
  }, [fetchMetadata]);

  return (
    <div className="h-full w-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background/80 backdrop-blur-sm">
        <GitBranch className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Repository Graph</h2>
        <span className="text-xs text-muted-foreground">
          {repoCount} repo{repoCount !== 1 ? 's' : ''} configured
        </span>
        {loadTime !== null && (
          <span className="text-[10px] text-muted-foreground">
            ({loadTime.toFixed(0)} ms{fromCache ? ', cached' : ''})
          </span>
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => fetchMetadata(true)} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Refresh
        </Button>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        {loading && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Fetching repository metadata…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20">
            <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 text-destructive px-4 py-2 rounded-lg text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={1.5}
          elevateNodesOnSelect={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeStrokeWidth={3}
            nodeColor={(n) => {
              if (n.type === 'repoGroup') return 'transparent';
              if (n.type === 'repoHeader') return '#475569';
              if (n.type === 'permission') return '#f59e0b';
              if (n.type === 'dataFolder') return '#f97316';
              if (n.type === 'automationBox') return '#8b5cf6';
              if (n.type === 'aiGenerated') return '#0ea5e9';
              if (n.type === 'junction') return '#94a3b8';
              return '#94a3b8';
            }}
            style={{ borderRadius: 8 }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
