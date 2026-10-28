/**
 * GitHub Settings Component - Redesigned
 * Table view with expandable edit panel
 * Two modes: Manual Configuration and Automated GitHub App
 */

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { 
  Github, 
  Check, 
  X, 
  AlertTriangle, 
  Loader2,
  Eye,
  EyeOff,
  TestTube,
  Info,
  Edit,
  ExternalLink,
  Trash2,
  Zap,
  Settings,
  FolderPlus,
  Link,
  Building2,
  Lock,
  Globe,
  RefreshCw,
  ChevronDown,
  Plus
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { useToast } from './ui/use-toast'
import { apiFetch } from '../config/api'

interface GitHubConfig {
  id?: string
  name?: string
  auth_method: 'app'
  github_app_id?: string
  github_app_private_key?: string
  github_app_installation_id?: string
  github_repo: string
  github_branch: string
  github_base_url?: string
  created_at?: string
  updated_at?: string
}

interface OrgInfo {
  installation_id: number
  org: string
  org_avatar: string
  org_type: string
}

interface RepoInfo {
  name: string
  full_name: string
  description: string
  private: boolean
  html_url: string
  clone_url: string
  default_branch: string
  updated_at?: string
}

interface SourceConfig {
  id: string
  name: string
  org: string
}

type AutomatedAction = 'create' | 'connect'

export function GitHubSettings() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [authSource, setAuthSource] = useState<'manual' | 'keyvault'>('manual')
  const [showInfoTooltip, setShowInfoTooltip] = useState(false)
  const [showSourceTooltip, setShowSourceTooltip] = useState(false)
  const [originalConfig, setOriginalConfig] = useState<GitHubConfig | null>(null)
  
  // Multi-config support
  const [configs, setConfigs] = useState<GitHubConfig[]>([])
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null)
  
  // Automated slide-in panel
  const [automatedPanelOpen, setAutomatedPanelOpen] = useState(false)
  
  // Automated mode state
  const [automatedAvailable, setAutomatedAvailable] = useState(false)
  const [sourceConfigs, setSourceConfigs] = useState<SourceConfig[]>([])
  const [selectedSourceConfig, setSelectedSourceConfig] = useState<string>('')
  const [orgs, setOrgs] = useState<OrgInfo[]>([])
  const [selectedOrg, setSelectedOrg] = useState<string>('')
  const [orgRepos, setOrgRepos] = useState<RepoInfo[]>([])
  const [automatedAction, setAutomatedAction] = useState<AutomatedAction>('create')
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoDescription, setNewRepoDescription] = useState('')
  const [newRepoPrivate, setNewRepoPrivate] = useState(true)
  const [selectedExistingRepo, setSelectedExistingRepo] = useState('')
  const [loadingOrgs, setLoadingOrgs] = useState(false)
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [creatingRepo, setCreatingRepo] = useState(false)
  
  const [config, setConfig] = useState<GitHubConfig>({
    auth_method: 'app',
    github_repo: '',
    github_branch: 'main',
    github_base_url: ''
  })

  // Helper function to construct repository URL
  const getRepoUrl = (cfg: GitHubConfig): string => {
    if (!cfg.github_repo) return ''
    
    if (cfg.github_base_url) {
      // GitHub Enterprise
      const baseUrl = cfg.github_base_url.replace('/api/v3', '').replace(/\/$/, '')
      return `${baseUrl}/${cfg.github_repo}`
    } else {
      // github.com
      return `https://github.com/${cfg.github_repo}`
    }
  }

  // Helper function to get repository name (without owner)
  const getRepoName = (cfg: GitHubConfig): string => {
    if (!cfg.github_repo) return '—'
    const parts = cfg.github_repo.split('/')
    return parts.length > 1 ? parts[1] : cfg.github_repo
  }

  // Helper function to parse organization and repository from github_repo
  const parseRepo = (repoPath: string): { org: string; repo: string } => {
    if (!repoPath) return { org: '', repo: '' }
    const parts = repoPath.split('/')
    return {
      org: parts[0] || '',
      repo: parts[1] || ''
    }
  }

  // Helper function to compose github_repo from organization and repository
  const composeRepo = (org: string, repo: string): string => {
    if (!org && !repo) return ''
    if (!org) return repo
    if (!repo) return org
    return `${org}/${repo}`
  }

  useEffect(() => {
    loadConfig()
    checkAutomatedAvailability()
  }, [])

  const loadConfig = async () => {
    try {
      // Load all configurations
      const configsResponse = await apiFetch('/api/github-configs')
      const configsData = await configsResponse.json()
      
      if (configsData.configs && configsData.configs.length > 0) {
        setConfigs(configsData.configs)
        
        // Load first config as default for edit panel (backward compatibility)
        const firstConfig = configsData.configs[0]
        setConfig({
          auth_method: 'app' as const,
          id: firstConfig.id,
          name: firstConfig.name || firstConfig.github_repo,
          github_app_id: firstConfig.github_app_id || '',
          github_app_private_key: firstConfig.github_app_private_key || '',
          github_app_installation_id: firstConfig.github_app_installation_id || '',
          github_repo: firstConfig.github_repo || '',
          github_branch: firstConfig.github_branch || 'main',
          github_base_url: firstConfig.github_base_url || ''
        })
        setOriginalConfig({...firstConfig})
      } else {
        setConfigs([])
      }
    } catch (error) {
      console.error('Failed to load config:', error)
      toast({
        title: 'Error',
        description: 'Failed to load GitHub configurations',
        variant: 'destructive'
      })
    }
  }

  // ============================================
  // Automated Mode Functions
  // ============================================

  const checkAutomatedAvailability = async () => {
    try {
      const resp = await apiFetch('/api/github-app/status')
      const data = await resp.json()
      setAutomatedAvailable(data.available)
      setSourceConfigs(data.source_configs || [])
      if (data.source_configs?.length > 0) {
        setSelectedSourceConfig(data.source_configs[0].id)
      }
    } catch (error) {
      console.error('Failed to check automated availability:', error)
      setAutomatedAvailable(false)
    }
  }

  const loadOrgs = useCallback(async (sourceConfigId?: string) => {
    setLoadingOrgs(true)
    setOrgs([])
    setSelectedOrg('')
    setOrgRepos([])
    try {
      const params = sourceConfigId ? `?source_config_id=${sourceConfigId}` : ''
      const resp = await apiFetch(`/api/github-app/orgs${params}`)
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'Failed to load organizations')
      }
      const data = await resp.json()
      setOrgs(data.orgs || [])
      if (data.orgs?.length > 0) {
        setSelectedOrg(data.orgs[0].org)
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load organizations',
        variant: 'destructive'
      })
    } finally {
      setLoadingOrgs(false)
    }
  }, [toast])

  const loadOrgRepos = useCallback(async (org: string, sourceConfigId?: string) => {
    if (!org) return
    setLoadingRepos(true)
    setOrgRepos([])
    try {
      const params = sourceConfigId ? `?source_config_id=${sourceConfigId}` : ''
      const resp = await apiFetch(`/api/github-app/repos/${org}${params}`)
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'Failed to load repositories')
      }
      const data = await resp.json()
      setOrgRepos(data.repos || [])
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load repositories',
        variant: 'destructive'
      })
    } finally {
      setLoadingRepos(false)
    }
  }, [toast])

  const handleCreateRepo = async () => {
    if (!selectedOrg || !newRepoName) {
      toast({ title: 'Error', description: 'Organization and repository name are required', variant: 'destructive' })
      return
    }
    setCreatingRepo(true)
    try {
      const resp = await apiFetch('/api/github-app/create-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org: selectedOrg,
          repo_name: newRepoName,
          description: newRepoDescription,
          private: newRepoPrivate,
          source_config_id: selectedSourceConfig || undefined,
        })
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'Failed to create repository')
      }
      const result = await resp.json()
      toast({
        title: 'Repository Created!',
        description: `${result.repo?.full_name} created and automatically configured`,
        className: 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800',
        duration: 8000,
      })
      // Reset form
      setNewRepoName('')
      setNewRepoDescription('')
      // Reload configs to show the new one
      await loadConfig()
      await checkAutomatedAvailability()
      // Reload org repos
      if (selectedOrg) await loadOrgRepos(selectedOrg, selectedSourceConfig)
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    } finally {
      setCreatingRepo(false)
    }
  }

  const handleConnectRepo = async () => {
    if (!selectedOrg || !selectedExistingRepo) {
      toast({ title: 'Error', description: 'Organization and repository are required', variant: 'destructive' })
      return
    }
    setCreatingRepo(true)
    try {
      const resp = await apiFetch('/api/github-app/connect-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org: selectedOrg,
          repo_name: selectedExistingRepo,
          source_config_id: selectedSourceConfig || undefined,
        })
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'Failed to connect repository')
      }
      const result = await resp.json()
      toast({
        title: 'Repository Connected!',
        description: `${result.repo?.full_name} automatically configured`,
        className: 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800',
        duration: 8000,
      })
      setSelectedExistingRepo('')
      await loadConfig()
      await checkAutomatedAvailability()
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    } finally {
      setCreatingRepo(false)
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      setConfig({ ...config, github_app_private_key: text })
      toast({
        title: 'Success',
        description: 'PEM file loaded successfully'
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to read PEM file',
        variant: 'destructive'
      })
    }
  }

  const testConnection = async (configToTest?: GitHubConfig) => {
    setTesting(true)
    try {
      // Use provided config or fall back to current state
      const testConfig = configToTest || config
      
      let response;
      
      // If config has ID, use the test-by-id endpoint (loads real credentials from backend)
      // Otherwise, use the regular test endpoint (for new configs being created)
      if (testConfig.id) {
        response = await apiFetch(`/api/github-configs/${testConfig.id}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      } else {
        // For new configs without ID, test with the provided credentials
        response = await apiFetch('/api/github-config/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testConfig)
        })
      }

      const result = await response.json()
      
      if (result.success) {
        toast({
          title: 'Connection Successful',
          description: result.message,
          className: 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
        })
      } else {
        toast({
          title: 'Connection Failed',
          description: result.message,
          variant: 'destructive'
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to test connection',
        variant: 'destructive'
      })
    } finally {
      setTesting(false)
    }
  }

  const saveConfig = async () => {
    if (authSource === 'keyvault') {
      toast({
        title: 'Key Vault Not Available',
        description: 'Key Vault integration is not yet implemented.',
        variant: 'destructive',
      })
      return
    }
    
    setLoading(true)
    try {
      let response;
      
      // If config has ID, update existing config; otherwise create new
      if (config.id) {
        response = await apiFetch(`/api/github-configs/${config.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        })
      } else {
        response = await apiFetch('/api/github-configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        })
      }

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to save configuration')
      }

      const result = await response.json()
      setEditMode(false) // Close edit panel after save
      setEditingConfigId(null)
      
      // Reload all configs
      await loadConfig()
      
      toast({
        title: 'Success',
        description: result.message || 'Configuration saved successfully',
        duration: 5000
      })
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const saveAsNewConfig = async () => {
    if (authSource === 'keyvault') {
      toast({
        title: 'Key Vault Not Available',
        description: 'Key Vault integration is not yet implemented.',
        variant: 'destructive',
      })
      return
    }
    
    setLoading(true)
    try {
      // Always POST to create new config (remove ID if present)
      const newConfig = {...config}
      delete newConfig.id
      
      const response = await apiFetch('/api/github-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to save configuration')
      }

      await response.json() // Consume response
      
      // Reload all configs
      await loadConfig()
      
      // Reset form for new configuration
      setConfig({
        auth_method: 'app',
        github_repo: '',
        github_branch: 'main',
        github_base_url: '',
        github_app_id: '',
        github_app_private_key: '',
        github_app_installation_id: ''
      })
      setOriginalConfig(null)
      setEditingConfigId(null)
      
      toast({
        title: 'Success',
        description: 'Configuration saved. You can now create another configuration.',
        duration: 5000
      })
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const deleteConfig = async (configId: string) => {
    // Find config to get its name for confirmation
    const configToDelete = configs.find(c => c.id === configId)
    const configName = configToDelete?.name || configToDelete?.github_repo || 'this configuration'
    
    // First confirmation
    if (!confirm(`DELETE CONFIGURATION?\n\n"${configName}"\n\nThis action cannot be undone. All credentials and settings will be permanently removed.\n\nDo you want to continue?`)) {
      return
    }
    
    // Second confirmation for extra safety
    if (!confirm(`FINAL CONFIRMATION\n\nYou are about to permanently delete:\n"${configName}"\n\nType or click OK to confirm deletion.`)) {
      return
    }

    setLoading(true)
    try {
      const response = await apiFetch(`/api/github-configs/${configId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Failed to delete configuration')
      }

      toast({
        title: 'Success',
        description: 'Configuration deleted successfully'
      })
      
      // Reload configs
      await loadConfig()
      
      // Close edit panel if deleted config was being edited
      if (editingConfigId === configId) {
        setEditMode(false)
        setEditingConfigId(null)
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete configuration',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleEditConfig = (cfg: GitHubConfig) => {
    // Load config into edit form
    setConfig({
      id: cfg.id,
      name: cfg.name,
      auth_method: 'app',
      github_app_id: cfg.github_app_id || '',
      github_app_private_key: cfg.github_app_private_key || '',
      github_app_installation_id: cfg.github_app_installation_id || '',
      github_repo: cfg.github_repo || '',
      github_branch: cfg.github_branch || 'main',
      github_base_url: cfg.github_base_url || ''
    })
    setOriginalConfig({...cfg})
    setEditingConfigId(cfg.id || null)
    setEditMode(true)
  }

  const handleAddNew = () => {
    // Reset config to empty state for new configuration
    setConfig({
      auth_method: 'app',
      github_repo: '',
      github_branch: 'main',
      github_base_url: '',
      github_app_id: '',
      github_app_private_key: '',
      github_app_installation_id: ''
    })
    setEditingConfigId(null)
    setOriginalConfig(null)
    setEditMode(true)
  }

  return (
    <TooltipProvider>
      <Card className="max-w-full h-full flex flex-col">
        <CardContent className="pt-6 pb-6 flex-1 flex flex-col min-h-0">
          {/* Main Layout */}
          <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Header: Title + Add Dropdown */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">GitHub Repository Management</h2>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="default" size="sm" className="h-9">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Configuration
                  <ChevronDown className="h-3.5 w-3.5 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onClick={handleAddNew} className="cursor-pointer">
                  <Settings className="h-4 w-4 mr-2" />
                  <div>
                    <div className="font-medium">Manual</div>
                    <div className="text-xs text-muted-foreground">Enter credentials & repo details</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => {
                    if (automatedAvailable) {
                      setAutomatedPanelOpen(true)
                      // Pre-load orgs if we have a source config
                      if (selectedSourceConfig) {
                        loadOrgs(selectedSourceConfig)
                      }
                    }
                  }}
                  disabled={!automatedAvailable}
                  className="cursor-pointer"
                >
                  <Zap className="h-4 w-4 mr-2" />
                  <div>
                    <div className="flex items-center gap-1.5 font-medium">
                      Automatic
                      {!automatedAvailable && <Lock className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {automatedAvailable 
                        ? 'Create repo via GitHub App — one click' 
                        : 'Needs a saved manual config first'}
                    </div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          {/* Configuration Table */}
          <div className="border rounded-lg overflow-auto min-h-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="px-4 py-3 text-left font-medium">Repository Name</th>
                  <th className="px-4 py-3 text-left font-medium">Repository URL</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-left font-medium">Permissions</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {configs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No configurations found. Click "Add New Configuration" to create one.
                    </td>
                  </tr>
                ) : (
                  configs.map((cfg) => (
                    <tr key={cfg.id} className="border-b hover:bg-muted/30 transition-colors">
                      {/* Repository Name */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">
                            {getRepoName(cfg)}
                          </span>
                          {cfg.name && cfg.name !== cfg.github_repo && (
                            <span className="text-xs text-muted-foreground">{cfg.name}</span>
                          )}
                        </div>
                      </td>
                      
                      {/* Repository URL */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded truncate max-w-[200px]">
                            {cfg.github_repo || '—'}
                          </code>
                          {cfg.github_repo && (
                            <a 
                              href={getRepoUrl(cfg)} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 flex-shrink-0"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </td>
                      
                      {/* Source */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                          <span className="font-medium text-xs">Local (.env)</span>
                          <Tooltip open={showSourceTooltip} onOpenChange={setShowSourceTooltip}>
                            <TooltipTrigger asChild>
                              <button 
                                type="button"
                                onClick={() => setShowSourceTooltip(!showSourceTooltip)}
                                className="inline-flex items-center p-0.5 rounded bg-yellow-100 dark:bg-yellow-900/20 hover:bg-yellow-200 dark:hover:bg-yellow-900/30 focus:outline-none focus:ring-2 focus:ring-yellow-500 transition-colors"
                              >
                                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 hover:text-yellow-700 dark:hover:text-yellow-300 cursor-pointer transition-colors" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              <p><strong>Localhost Only:</strong> Settings stored locally with encryption. For production, use Azure Key Vault.</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </td>
                      
                      {/* Permissions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {(cfg.github_app_id && 
                            cfg.github_app_private_key && 
                            cfg.github_app_installation_id && 
                            cfg.github_repo) ? (
                            <>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-800/80 dark:text-green-100">
                                Read
                              </span>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-800/80 dark:text-blue-100">
                                Write
                              </span>
                            </>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200">
                              Not configured
                            </span>
                          )}
                        </div>
                      </td>
                      
                      {/* Status */}
                      <td className="px-4 py-3">
                        {(cfg.github_app_id && 
                          cfg.github_app_private_key && 
                          cfg.github_app_installation_id && 
                          cfg.github_repo) ? (
                          <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                            <Check className="h-4 w-4" />
                            <span className="text-xs font-medium">Ready</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-4 w-4" />
                            <span className="text-xs font-medium">Incomplete</span>
                          </div>
                        )}
                      </td>
                      
                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => testConnection(cfg)}
                            disabled={testing}
                            className="h-8"
                          >
                            {testing ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <TestTube className="h-3 w-3 mr-1" />
                                Test
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant={editMode && editingConfigId === cfg.id ? 'default' : 'ghost'}
                            onClick={() => handleEditConfig(cfg)}
                            className="h-8"
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => cfg.id && deleteConfig(cfg.id)}
                            disabled={loading}
                            className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          </div>

          {/* Right: Expandable Edit Panel - Fixed Position */}
          {editMode && (
            <>
              {/* Backdrop */}
              <div 
                className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-300"
                onClick={() => {
                  // Restore original config when closing via backdrop
                  if (originalConfig) {
                    setConfig(originalConfig)
                  }
                  setEditMode(false)
                }}
              />
              
              {/* Edit Panel */}
              <div className="fixed top-14 right-0 w-[500px] h-[calc(100vh-3.5rem)] bg-background border-l shadow-xl z-50 animate-in slide-in-from-right duration-300">
                <div className="h-full flex flex-col overflow-auto">
                  {/* Close Button */}
                  <div className="flex justify-end p-4 pb-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        // Restore original config when closing
                        if (originalConfig) {
                          setConfig(originalConfig)
                        }
                        setEditMode(false)
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex-1 px-6 pb-6 space-y-6">
                    {/* Configuration Name */}
                    <div className="space-y-3 pb-4 border-b">
                      <div className="flex items-center gap-4">
                        <Label htmlFor="config-name" className="text-sm w-40 flex-shrink-0">
                          Configuration Name
                        </Label>
                        <Input
                          id="config-name"
                          type="text"
                          placeholder="Optional - defaults to repository name"
                          value={config.name || ''}
                          onChange={(e) => setConfig({ ...config, name: e.target.value })}
                          className="h-10 flex-1"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground ml-44">
                        Give this configuration a friendly name (e.g., "Production", "Development")
                      </p>
                    </div>

                    {/* Authentication Source Selector */}
                    <div className="space-y-3">
                      <Label htmlFor="auth-source" className="text-sm font-semibold">
                        Authentication Source
                      </Label>
                      <Select 
                        value={authSource} 
                        onValueChange={(value: 'manual' | 'keyvault') => setAuthSource(value)}
                      >
                        <SelectTrigger id="auth-source" className="h-9">
                          <SelectValue placeholder="Select auth source" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">Manual Configuration</SelectItem>
                          <SelectItem value="keyvault" disabled>
                            Azure Key Vault (Not Available)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {authSource === 'manual' 
                          ? 'Configure GitHub App credentials manually' 
                          : 'Use Azure Key Vault for secure credential storage'}
                      </p>
                    </div>

                    {/* GitHub App Credentials Section */}
                    <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                      <Github className="h-4 w-4" />
                      GitHub App Credentials
                    </h4>
                    <Tooltip open={showInfoTooltip} onOpenChange={setShowInfoTooltip}>
                      <TooltipTrigger asChild>
                        <button 
                          type="button"
                          onClick={() => setShowInfoTooltip(!showInfoTooltip)}
                          className="inline-flex items-center p-0.5 rounded hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
                        >
                          <Info className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="font-semibold mb-1">Create GitHub App:</p>
                        <p>Settings → Developer settings → GitHub Apps</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <Label htmlFor="app-id" className="text-sm w-40 flex-shrink-0">GitHub App ID</Label>
                      <Input
                        id="app-id"
                        type="text"
                        placeholder="123456"
                        value={config.github_app_id || ''}
                        onChange={(e) => setConfig({ ...config, github_app_id: e.target.value })}
                        className="h-10 flex-1"
                      />
                    </div>

                    <div className="flex items-center gap-4">
                      <Label htmlFor="installation-id" className="text-sm w-40 flex-shrink-0">Installation ID</Label>
                      <Input
                        id="installation-id"
                        type="text"
                        placeholder="12345678"
                        value={config.github_app_installation_id || ''}
                        onChange={(e) => setConfig({ ...config, github_app_installation_id: e.target.value })}
                        className="h-10 flex-1"
                      />
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <Label htmlFor="pem-file" className="text-sm w-40 flex-shrink-0 pt-2">Private Key</Label>
                    <div className="flex-1 space-y-2">
                      <div className="flex gap-2">
                        <Input
                          id="pem-file"
                          type="file"
                          accept=".pem"
                          onChange={handleFileUpload}
                          className="flex-1 h-10 text-sm"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setShowPrivateKey(!showPrivateKey)}
                          disabled={!config.github_app_private_key}
                          className="h-10 w-10"
                        >
                          {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      {config.github_app_private_key && (
                        <div>
                          {showPrivateKey ? (
                            <Textarea
                              value={config.github_app_private_key}
                              onChange={(e) => setConfig({ ...config, github_app_private_key: e.target.value })}
                              rows={3}
                              className="font-mono text-xs"
                            />
                          ) : (
                            <div className="p-2 bg-muted rounded text-xs text-muted-foreground flex items-center gap-2">
                              <Check className="h-3 w-3 text-green-600" />
                              Key loaded ({config.github_app_private_key.length} chars)
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Repository Settings Section */}
                <div className="space-y-4 border-t pt-6">
                  <h4 className="text-sm font-semibold text-foreground">Repository Settings</h4>
                      
                      <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          <Label htmlFor="org" className="text-sm w-40 flex-shrink-0">Organization</Label>
                          <Input
                            id="org"
                            type="text"
                            placeholder="owner or org-name"
                            value={parseRepo(config.github_repo).org}
                            onChange={(e) => {
                              const { repo } = parseRepo(config.github_repo)
                              setConfig({ ...config, github_repo: composeRepo(e.target.value, repo) })
                            }}
                            className="h-10 flex-1"
                          />
                        </div>

                        <div className="flex items-center gap-4">
                          <Label htmlFor="repo" className="text-sm w-40 flex-shrink-0">Repository</Label>
                          <Input
                            id="repo"
                            type="text"
                            placeholder="repository-name"
                            value={parseRepo(config.github_repo).repo}
                            onChange={(e) => {
                              const { org } = parseRepo(config.github_repo)
                              setConfig({ ...config, github_repo: composeRepo(org, e.target.value) })
                            }}
                            className="h-10 flex-1"
                          />
                        </div>

                        <div className="flex items-center gap-4">
                          <Label htmlFor="branch" className="text-sm w-40 flex-shrink-0">Branch</Label>
                          <Input
                            id="branch"
                            type="text"
                            placeholder="main"
                            value={config.github_branch}
                            onChange={(e) => setConfig({ ...config, github_branch: e.target.value })}
                            className="h-10 flex-1"
                          />
                        </div>

                        <div className="flex items-center gap-4">
                          <Label htmlFor="base-url" className="text-sm w-40 flex-shrink-0">Enterprise URL</Label>
                          <Input
                            id="base-url"
                            type="text"
                            placeholder="Optional"
                            value={config.github_base_url || ''}
                            onChange={(e) => setConfig({ ...config, github_base_url: e.target.value })}
                            className="h-10 flex-1"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-3 pt-6 border-t">
                      <Button
                        onClick={saveConfig}
                        disabled={loading || testing}
                        className="w-full"
                        size="sm"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Check className="mr-2 h-4 w-4" />
                            Save Configuration
                          </>
                        )}
                      </Button>

                      <Button
                        onClick={saveAsNewConfig}
                        disabled={loading || testing}
                        variant="outline"
                        className="w-full"
                        size="sm"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Check className="mr-2 h-4 w-4" />
                            Save as New Configuration
                          </>
                        )}
                      </Button>

                      {config.id && (
                        <Button
                          onClick={() => deleteConfig(config.id!)}
                          variant="destructive"
                          disabled={loading || testing}
                          className="w-full"
                          size="sm"
                        >
                          <X className="mr-2 h-4 w-4" />
                          Delete Configuration
                        </Button>
                      )}
                    </div>

                    {/* Restart Info */}
                    <div className="flex items-start gap-2 p-2 bg-muted/50 rounded-lg text-xs">
                      <Info className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <p className="text-muted-foreground">
                        Restart required after saving: restart the backend container or Kubernetes rollout
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ============================================ */}
          {/* Automated Slide-In Panel */}
          {/* ============================================ */}
          {automatedPanelOpen && (
            <>
              {/* Backdrop */}
              <div 
                className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-300"
                onClick={() => setAutomatedPanelOpen(false)}
              />
              
              {/* Panel */}
              <div className="fixed top-14 right-0 w-[540px] h-[calc(100vh-3.5rem)] bg-background border-l shadow-xl z-50 animate-in slide-in-from-right duration-300">
                <div className="h-full flex flex-col overflow-auto">
                  {/* Header */}
                  <div className="flex items-center justify-between p-4 pb-2 flex-shrink-0 border-b">
                    <div className="flex items-center gap-2">
                      <Zap className="h-5 w-5 text-blue-600" />
                      <h3 className="font-semibold">Automatic Configuration</h3>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setAutomatedPanelOpen(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex-1 px-6 pb-6 pt-4 space-y-5">
                    {/* Info */}
                    <div className="flex items-start gap-2.5 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        Creates or connects repos using your stored GitHub App credentials — no additional setup needed.
                      </p>
                    </div>

                    {/* Source Config Selector (if multiple) */}
                    {sourceConfigs.length > 1 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Credential Source</Label>
                        <Select value={selectedSourceConfig} onValueChange={(v) => {
                          setSelectedSourceConfig(v)
                          setOrgs([])
                          setSelectedOrg('')
                          setOrgRepos([])
                        }}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select configuration" />
                          </SelectTrigger>
                          <SelectContent>
                            {sourceConfigs.map((sc) => (
                              <SelectItem key={sc.id} value={sc.id}>
                                <span className="flex items-center gap-2">
                                  <Github className="h-3.5 w-3.5" />
                                  {sc.name} {sc.org && <span className="text-muted-foreground">({sc.org})</span>}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Action Toggle: Create vs Connect */}
                    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
                      <Button
                        variant={automatedAction === 'create' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setAutomatedAction('create')}
                        className="flex-1 h-8"
                      >
                        <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
                        Create New
                      </Button>
                      <Button
                        variant={automatedAction === 'connect' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setAutomatedAction('connect')}
                        className="flex-1 h-8"
                      >
                        <Link className="h-3.5 w-3.5 mr-1.5" />
                        Connect Existing
                      </Button>
                    </div>

                    {/* Step 1: Organization */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          Organization
                        </Label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => loadOrgs(selectedSourceConfig)}
                          disabled={loadingOrgs}
                          className="h-7 text-xs"
                        >
                          {loadingOrgs ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          {orgs.length > 0 ? 'Refresh' : 'Load'}
                        </Button>
                      </div>

                      {orgs.length > 0 ? (
                        <Select value={selectedOrg} onValueChange={(v) => {
                          setSelectedOrg(v)
                          setOrgRepos([])
                          setSelectedExistingRepo('')
                          if (automatedAction === 'connect') {
                            loadOrgRepos(v, selectedSourceConfig)
                          }
                        }}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select organization" />
                          </SelectTrigger>
                          <SelectContent>
                            {orgs.map((o) => (
                              <SelectItem key={o.org} value={o.org}>
                                <span className="flex items-center gap-2">
                                  <Building2 className="h-3.5 w-3.5" />
                                  {o.org}
                                  <span className="text-xs text-muted-foreground">({o.org_type})</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {loadingOrgs ? 'Loading organizations...' : 'Click "Load" to discover available organizations.'}
                        </p>
                      )}
                    </div>

                    {/* Step 2: Create or Connect */}
                    {selectedOrg && automatedAction === 'create' && (
                      <div className="space-y-4 border-t pt-4">
                        <Label className="text-sm font-semibold flex items-center gap-2">
                          <FolderPlus className="h-4 w-4" />
                          New Repository
                        </Label>

                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <Label className="text-sm w-28 flex-shrink-0">Organization</Label>
                            <div className="flex items-center gap-1.5 text-sm font-medium">
                              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                              {selectedOrg} /
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <Label htmlFor="auto-name" className="text-sm w-28 flex-shrink-0">Name</Label>
                            <Input
                              id="auto-name"
                              placeholder="my-new-repository"
                              value={newRepoName}
                              onChange={(e) => setNewRepoName(e.target.value)}
                              className="h-9 flex-1"
                            />
                          </div>

                          <div className="flex items-center gap-3">
                            <Label htmlFor="auto-desc" className="text-sm w-28 flex-shrink-0">Description</Label>
                            <Input
                              id="auto-desc"
                              placeholder="Optional"
                              value={newRepoDescription}
                              onChange={(e) => setNewRepoDescription(e.target.value)}
                              className="h-9 flex-1"
                            />
                          </div>

                          <div className="flex items-center gap-3">
                            <Label className="text-sm w-28 flex-shrink-0">Visibility</Label>
                            <div className="flex items-center gap-1 p-0.5 bg-muted rounded-md">
                              <Button
                                variant={newRepoPrivate ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setNewRepoPrivate(true)}
                                className="h-7 text-xs px-3"
                              >
                                <Lock className="h-3 w-3 mr-1" />
                                Private
                              </Button>
                              <Button
                                variant={!newRepoPrivate ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setNewRepoPrivate(false)}
                                className="h-7 text-xs px-3"
                              >
                                <Globe className="h-3 w-3 mr-1" />
                                Public
                              </Button>
                            </div>
                          </div>
                        </div>

                        {newRepoName && (
                          <div className="flex items-start gap-2 p-2.5 bg-muted/50 rounded-lg text-xs">
                            <Info className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                            <div className="text-muted-foreground">
                              <p>Will create <code className="px-1 py-0.5 bg-background rounded font-medium">{selectedOrg}/{newRepoName}</code> and auto-register the configuration.</p>
                            </div>
                          </div>
                        )}

                        <Button
                          onClick={async () => {
                            await handleCreateRepo()
                            setAutomatedPanelOpen(false)
                          }}
                          disabled={creatingRepo || !newRepoName}
                          className="w-full"
                        >
                          {creatingRepo ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Zap className="mr-2 h-4 w-4" />
                              Create & Auto-Configure
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {selectedOrg && automatedAction === 'connect' && (
                      <div className="space-y-4 border-t pt-4">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-semibold flex items-center gap-2">
                            <Link className="h-4 w-4" />
                            Existing Repository
                          </Label>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => loadOrgRepos(selectedOrg, selectedSourceConfig)}
                            disabled={loadingRepos}
                            className="h-7 text-xs"
                          >
                            {loadingRepos ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <RefreshCw className="h-3 w-3 mr-1" />
                            )}
                            {orgRepos.length > 0 ? 'Refresh' : 'Load'}
                          </Button>
                        </div>

                        {orgRepos.length > 0 ? (
                          <Select value={selectedExistingRepo} onValueChange={setSelectedExistingRepo}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select a repository" />
                            </SelectTrigger>
                            <SelectContent>
                              {orgRepos.map((r) => {
                                const alreadyConfigured = configs.some(c => c.github_repo === r.full_name)
                                return (
                                  <SelectItem key={r.name} value={r.name} disabled={alreadyConfigured}>
                                    <span className="flex items-center gap-2">
                                      <Github className="h-3.5 w-3.5" />
                                      {r.name}
                                      {r.private && <Lock className="h-3 w-3 text-muted-foreground" />}
                                      {alreadyConfigured && (
                                        <span className="text-xs text-green-600">(configured)</span>
                                      )}
                                    </span>
                                  </SelectItem>
                                )
                              })}
                            </SelectContent>
                          </Select>
                        ) : loadingRepos ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading repositories...
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Click "Load" to see available repos in <span className="font-medium">{selectedOrg}</span>.
                          </p>
                        )}

                        {selectedExistingRepo && (
                          <Button
                            onClick={async () => {
                              await handleConnectRepo()
                              setAutomatedPanelOpen(false)
                            }}
                            disabled={creatingRepo}
                            className="w-full"
                          >
                            {creatingRepo ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Connecting...
                              </>
                            ) : (
                              <>
                                <Zap className="mr-2 h-4 w-4" />
                                Connect & Auto-Configure
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}
