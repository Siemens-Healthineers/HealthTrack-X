import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, RefreshCw, X } from 'lucide-react'
import { apiFetch } from '../../config/api'
import { MUTATION_PREVIEW_CREATED_EVENT } from '../../lib/mutationEvents'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { ScrollArea } from '../ui/scroll-area'
import { useToast } from '../ui/use-toast'

interface MutationChange {
  field: string
  before: unknown
  after: unknown
}

interface MutationActionPreview {
  index: number
  action: 'create' | 'update' | 'delete'
  product_id: string
  title: string
  changes: MutationChange[]
  target: { config_id?: string | null; folder: string }
}

interface MutationWarning {
  action_index?: number
  product_id?: string
  message: string
}

interface MutationPreview {
  approval_id: string
  status: string
  valid: boolean
  atomic: boolean
  created_at: string
  summary: { create: number; update: number; delete: number; total: number; target_files: number; github_commits: number }
  groups: Array<{ repo: string; folder: string; path: string; base_count: number; final_count: number }>
  actions: MutationActionPreview[]
  warnings: MutationWarning[]
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function actionLabel(action: MutationActionPreview['action']) {
  if (action === 'create') return 'Create'
  if (action === 'update') return 'Update'
  return 'Delete'
}

export function MutationApprovalDialog() {
  const { toast } = useToast()
  const [previews, setPreviews] = useState<MutationPreview[]>([])
  const [busy, setBusy] = useState(false)

  const activePreview = previews[0] ?? null
  const open = Boolean(activePreview)
  const canCommit = activePreview?.atomic !== false

  const globalWarnings = useMemo(
    () => activePreview?.warnings.filter(warning => warning.action_index === undefined) ?? [],
    [activePreview],
  )

  const warningByAction = useMemo(() => {
    const map = new Map<number, MutationWarning[]>()
    for (const warning of activePreview?.warnings ?? []) {
      if (warning.action_index === undefined) continue
      const list = map.get(warning.action_index) ?? []
      list.push(warning)
      map.set(warning.action_index, list)
    }
    return map
  }, [activePreview])

  const loadPending = useCallback(async () => {
    try {
      const res = await apiFetch('/api/data-mutations/pending')
      if (!res.ok) return
      const data = await res.json()
      setPreviews(Array.isArray(data.previews) ? data.previews : [])
    } catch {
      // Polling is best-effort; normal page use should not be noisy.
    }
  }, [])

  useEffect(() => {
    void loadPending()
    const id = window.setInterval(loadPending, 2500)
    const onPreviewCreated = () => { void loadPending() }
    window.addEventListener(MUTATION_PREVIEW_CREATED_EVENT, onPreviewCreated)
    return () => {
      window.clearInterval(id)
      window.removeEventListener(MUTATION_PREVIEW_CREATED_EVENT, onPreviewCreated)
    }
  }, [loadPending])

  async function reject() {
    if (!activePreview) return
    setBusy(true)
    try {
      const res = await apiFetch(`/api/data-mutations/reject/${activePreview.approval_id}`, { method: 'POST' })
      if (!res.ok && res.status !== 404) throw new Error('Reject failed')
      setPreviews(prev => prev.filter(p => p.approval_id !== activePreview.approval_id))
      toast({ title: 'Changes rejected', description: 'No repository data was modified.' })
    } catch (error) {
      toast({
        title: 'Reject failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  async function approveAndCommit() {
    if (!activePreview) return
    setBusy(true)
    try {
      if (activePreview.status !== 'approved') {
        const approveRes = await apiFetch(`/api/data-mutations/approve/${activePreview.approval_id}`, { method: 'POST' })
        if (!approveRes.ok) throw new Error('Approval failed')
      }

      const commitRes = await apiFetch('/api/data-mutations/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approval_id: activePreview.approval_id }),
      })
      if (!commitRes.ok) {
        const error = await commitRes.json().catch(() => ({ detail: commitRes.statusText }))
        throw new Error(typeof error.detail === 'string' ? error.detail : 'Commit failed')
      }

      setPreviews(prev => prev.filter(p => p.approval_id !== activePreview.approval_id))
      sessionStorage.setItem('dataInvalidated', Date.now().toString())
      toast({
        title: 'Changes committed',
        description: `${activePreview.summary.total} change(s) written in ${activePreview.summary.github_commits} GitHub commit(s).`,
      })
    } catch (error) {
      toast({
        title: 'Commit failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
      loadPending()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) reject() }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Review data changes</DialogTitle>
          <DialogDescription>
            An MCP tool or AI assistant prepared a batch. Review the diff before it is written to the data repositories.
          </DialogDescription>
        </DialogHeader>

        {activePreview && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{activePreview.summary.create} create</Badge>
              <Badge variant="secondary">{activePreview.summary.update} update</Badge>
              <Badge variant="secondary">{activePreview.summary.delete} delete</Badge>
              <Badge variant="outline">{activePreview.summary.target_files} target file(s)</Badge>
              <Badge variant="outline">{activePreview.summary.github_commits} GitHub commit(s)</Badge>
              <Badge variant={activePreview.atomic ? 'outline' : 'destructive'}>
                {activePreview.atomic ? 'atomic commit' : 'split required'}
              </Badge>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              {activePreview.groups.map(group => (
                <div key={`${group.repo}:${group.folder}:${group.path}`} className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="font-medium">{group.repo}</span>
                  <span className="text-muted-foreground">{group.path}</span>
                  <span className="text-muted-foreground">{group.base_count} to {group.final_count} records</span>
                </div>
              ))}
            </div>

            {globalWarnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                {globalWarnings.map(warning => (
                  <p key={warning.message}>{warning.message}</p>
                ))}
              </div>
            )}

            <ScrollArea className="h-[420px] rounded-md border">
              <div className="divide-y">
                {activePreview.actions.map(action => (
                  <div key={`${action.index}:${action.product_id}`} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={action.action === 'delete' ? 'destructive' : 'default'}>{actionLabel(action.action)}</Badge>
                      <span className="font-medium">{action.title}</span>
                      <span className="text-xs text-muted-foreground font-mono">{action.product_id}</span>
                    </div>

                    {(warningByAction.get(action.index) ?? []).map(warning => (
                      <p key={warning.message} className="text-sm text-amber-600 dark:text-amber-400">{warning.message}</p>
                    ))}

                    <div className="space-y-1 text-sm">
                      {action.changes.slice(0, 20).map(change => (
                        <div key={change.field} className="grid grid-cols-[140px_1fr] gap-3 rounded-sm bg-background px-3 py-2">
                          <span className="font-medium text-muted-foreground">{change.field}</span>
                          <span className="min-w-0 break-words">
                            <span className="text-red-600 dark:text-red-400">{formatValue(change.before)}</span>
                            <span className="px-2 text-muted-foreground">to</span>
                            <span className="text-green-700 dark:text-green-400">{formatValue(change.after)}</span>
                          </span>
                        </div>
                      ))}
                      {action.changes.length > 20 && (
                        <p className="text-xs text-muted-foreground">{action.changes.length - 20} more field change(s)</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={loadPending} disabled={busy}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" onClick={reject} disabled={busy}>
            <X className="mr-2 h-4 w-4" />
            Reject
          </Button>
          <Button onClick={approveAndCommit} disabled={busy || !canCommit}>
            <Check className="mr-2 h-4 w-4" />
            {canCommit ? 'Approve and commit' : 'Split batch first'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}