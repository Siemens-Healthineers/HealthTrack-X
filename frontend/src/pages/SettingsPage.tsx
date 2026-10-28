/**
 * Settings Page
 * Theme Settings, System Status, GitHub and EDC configuration
 */

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Moon, Sun, Palette, Activity, Circle, Github, Mountain, Flame, Heart, PenTool, Wifi, Users, Check, X, Loader2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useTheme } from '../contexts/ThemeContext'
import { useSystemStatus } from '../contexts/SystemStatusContext'
import { useAppProfile } from '../contexts/AppProfileContext'
import { apiFetch } from '../config/api'
import { useAuth } from '../contexts/AuthContext'
import { GitHubSettings } from '../components/GitHubSettings'
import { EdcSettings } from '../components/EdcSettings'

interface PendingUser {
  id: string
  username: string
  email: string
  firstName: string
  lastName: string
  enabled: boolean
  createdTimestamp: number
  roles: string[]
}

const VALID_TABS = new Set(['app', 'status', 'users', 'github', 'edc'] as const)

export function SettingsPage() {
  const { isDarkMode, setTheme } = useTheme()
  const { status: systemStatus, checkStatus } = useSystemStatus()
  const { appProfile, setAppProfile } = useAppProfile()
  const { enabled: authEnabled, user } = useAuth()

  // Admin check: show Users tab if auth is disabled (local dev) or user has admin role
  const userRoles = (user?.profile as Record<string, any>)?.realm_access?.roles as string[] | undefined
  const isAdmin = !authEnabled || (userRoles?.includes('admin') ?? false)
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(
    tabParam && VALID_TABS.has(tabParam as any) ? tabParam : 'app'
  )

  // EDC Connector status for System Status tab
  const [edcStatus, setEdcStatus] = useState<{ status: string; message: string }>({ status: 'checking', message: 'Checking…' })
  const fetchEdcStatus = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/edc/status', { headers: { 'Content-Type': 'application/json' } })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      setEdcStatus({ status: data.status, message: data.message })
    } catch {
      setEdcStatus({ status: 'error', message: 'Backend unreachable' })
    }
  }, [])
  useEffect(() => { fetchEdcStatus() }, [fetchEdcStatus])

  // Pending user approvals
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingConfigured, setPendingConfigured] = useState(false)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchPendingUsers = useCallback(async () => {
    setPendingLoading(true)
    setPendingError(null)
    try {
      const resp = await apiFetch('/api/users/pending')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      setPendingUsers(data.pending || [])
      setPendingConfigured(data.configured ?? false)
      if (data.error) setPendingError(data.error)
    } catch (e: any) {
      setPendingUsers([])
      setPendingError(e?.message || 'Failed to fetch pending users')
    } finally {
      setPendingLoading(false)
    }
  }, [])

  useEffect(() => { fetchPendingUsers() }, [fetchPendingUsers])

  const approveUser = async (userId: string) => {
    setActionLoading(userId)
    try {
      const resp = await apiFetch(`/api/users/${userId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: ['viewer'] }),
      })
      if (resp.ok) {
        setPendingUsers(prev => prev.filter(u => u.id !== userId))
      }
    } finally {
      setActionLoading(null)
    }
  }

  const rejectUser = async (userId: string) => {
    setActionLoading(userId)
    try {
      const resp = await apiFetch(`/api/users/${userId}/reject`, { method: 'POST' })
      if (resp.ok) {
        setPendingUsers(prev => prev.filter(u => u.id !== userId))
      }
    } finally {
      setActionLoading(null)
    }
  }

  // Sync tab when URL search params change (e.g. clicking App Status while already on Settings)
  useEffect(() => {
    if (tabParam && VALID_TABS.has(tabParam as any)) {
      setActiveTab(tabParam)
    }
  }, [tabParam])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-green-500'
      case 'warning': return 'text-yellow-500'
      case 'offline': return 'text-red-500'
      case 'error': return 'text-red-500'
      case 'checking': return 'text-blue-500'
      default: return 'text-gray-500'
    }
  }

  const getStatusIcon = (status: string) => {
    return <Circle className={`h-4 w-4 fill-current ${getStatusColor(status)}`} />
  }

  const STATUS_LABELS: Record<string, string> = {
    online: 'Online', offline: 'Offline', error: 'Fehler', warning: 'Warning',
  }
  const statusLabel = (s: string) => STATUS_LABELS[s] ?? 'Checking...'

  return (
    <div className="flex flex-col h-full">
      {/* Header Section */}
      <div className="border-b bg-background px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </div>

      {/* Content Section */}
      <div className="flex-1 overflow-hidden p-6">
        <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); setSearchParams(val === 'app' ? {} : { tab: val }, { replace: true }); }} className="w-full h-full flex flex-col">
          <TabsList className="mb-4 flex-shrink-0 justify-start w-fit">
            <TabsTrigger value="app" className="gap-2">
              <Palette className="h-4 w-4" />
              App
            </TabsTrigger>
            <TabsTrigger value="status" className="gap-2">
              <Activity className="h-4 w-4" />
              System Status
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="users" className="gap-2 relative">
                <Users className="h-4 w-4" />
                Users
                {pendingUsers.length > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold leading-none text-white bg-orange-500 rounded-full">
                    {pendingUsers.length}
                  </span>
                )}
              </TabsTrigger>
            )}
            <TabsTrigger value="github" className="gap-2">
              <Github className="h-4 w-4" />
              GitHub
            </TabsTrigger>
            <TabsTrigger value="edc" className="gap-2">
              <Wifi className="h-4 w-4" />
              EDC Connector
            </TabsTrigger>
          </TabsList>

          {/* App Tab */}
          <TabsContent value="app" className="flex-1 overflow-auto">
            <div className="space-y-4 max-w-4xl">
              {/* Appearance */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="h-5 w-5" />
                    Appearance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Color Mode */}
                  <div className="space-y-2">
                    <div className="inline-flex rounded-md shadow-sm" role="group">
                      <Button
                        type="button"
                        variant={!isDarkMode ? 'default' : 'outline'}
                        onClick={() => setTheme(false)}
                        className="rounded-r-none"
                      >
                        <Sun className="h-4 w-4 mr-2" />
                        Light
                      </Button>
                      <Button
                        type="button"
                        variant={isDarkMode ? 'default' : 'outline'}
                        onClick={() => setTheme(true)}
                        className="rounded-l-none border-l-0"
                      >
                        <Moon className="h-4 w-4 mr-2" />
                        Dark
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Application Setup */}
              <Card>
                <CardHeader>
                  <CardTitle>Application Setup</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="inline-flex rounded-md shadow-sm" role="group">
                      <Button
                        type="button"
                        variant={appProfile === 'raw-material' ? 'default' : 'outline'}
                        onClick={() => setAppProfile('raw-material')}
                        className="rounded-r-none"
                      >
                        <Mountain className="h-4 w-4 mr-2" />
                        Raw Material (ROH)
                      </Button>
                      <Button
                        type="button"
                        variant={appProfile === 'semi-finished-good' ? 'default' : 'outline'}
                        onClick={() => setAppProfile('semi-finished-good')}
                        className="rounded-none border-l-0"
                      >
                        <Flame className="h-4 w-4 mr-2" />
                        Semi-finished Good (HALB)
                      </Button>
                      <Button
                        type="button"
                        variant={appProfile === 'finished-product' ? 'default' : 'outline'}
                        onClick={() => setAppProfile('finished-product')}
                        className="rounded-none border-l-0"
                      >
                        <PenTool className="h-4 w-4 mr-2" />
                        Finished Product (FERT)
                      </Button>
                      <Button
                        type="button"
                        variant={appProfile === 'medical-device' ? 'default' : 'outline'}
                        onClick={() => setAppProfile('medical-device')}
                        className="rounded-l-none border-l-0"
                      >
                        <Heart className="h-4 w-4 mr-2" />
                        Medical Device (END)
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* System Status Tab */}
          <TabsContent value="status" className="flex-1 overflow-auto">
            <Card className="max-w-4xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    System Status
                    <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full ${
                      systemStatus.overallStatus === 'error' || 
                      systemStatus.backend.status === 'error' || 
                      systemStatus.nats.status === 'error' ||
                      systemStatus.github.status === 'error' ||
                      systemStatus.runningCount > 4
                        ? 'bg-red-500 text-white' 
                        : systemStatus.overallStatus === 'online'
                        ? 'bg-green-500 text-white'
                        : systemStatus.runningCount > 0
                        ? 'bg-yellow-500 text-white'
                        : 'bg-gray-500 text-white'
                    }`}>
                      {systemStatus.runningCount}
                    </span>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={checkStatus}
                  >
                    Refresh
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Backend Status */}
                <div className={`flex items-center justify-between p-4 border rounded-lg ${
                  systemStatus.backend.status === 'error' ? 'border-red-500 bg-red-50 dark:bg-red-950/20' : ''
                }`}>
                  <div className="flex items-center gap-3">
                    {getStatusIcon(systemStatus.backend.status)}
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        Backend API
                        {systemStatus.backend.count !== undefined && systemStatus.backend.count > 1 && (
                          <span className="px-2 py-0.5 text-xs font-semibold bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-100 rounded">DUPLIKAT!</span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {systemStatus.backend.message}
                        {systemStatus.backend.count !== undefined && ` (${systemStatus.backend.count} Prozess${systemStatus.backend.count !== 1 ? 'e' : ''})`}
                        {systemStatus.backend.count !== undefined && systemStatus.backend.count > 1 && (
                          <span className="block text-red-600 dark:text-red-400 font-medium mt-1">Mehrere Instanzen erkannt! Bitte Container oder Deployment prüfen.</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-medium">
                    {statusLabel(systemStatus.backend.status)}
                  </div>
                </div>

                {/* NATS JetStream Status */}
                <div className={`flex items-center justify-between p-4 border rounded-lg ${
                  systemStatus.nats.status === 'error' ? 'border-red-500 bg-red-50 dark:bg-red-950/20' : ''
                }`}>
                  <div className="flex items-center gap-3">
                    {getStatusIcon(systemStatus.nats.status)}
                    <div>
                      <div className="font-medium">NATS JetStream</div>
                      <div className="text-sm text-muted-foreground">
                        {systemStatus.nats.message}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-medium">
                    {statusLabel(systemStatus.nats.status)}
                  </div>
                </div>

                {/* GitHub Status */}
                <div className={`flex items-center justify-between p-4 border rounded-lg ${
                  systemStatus.github.status === 'error' ? 'border-red-500 bg-red-50 dark:bg-red-950/20' : ''
                }`}>
                  <div className="flex items-center gap-3">
                    {getStatusIcon(systemStatus.github.status)}
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        GitHub Connection
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {systemStatus.github.message}
                        {systemStatus.github.repository && (
                          <span className="block text-xs mt-0.5">
                            Repository: {systemStatus.github.repository}
                            {systemStatus.github.auth_method && ` (${systemStatus.github.auth_method === 'token' ? 'Token' : 'GitHub App'})`}
                          </span>
                        )}
                        {systemStatus.github.status === 'error' && (
                          <span className="block text-red-600 dark:text-red-400 font-medium mt-1">Bitte GitHub-Konfiguration in den Einstellungen prüfen.</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-medium">
                    {statusLabel(systemStatus.github.status)}
                  </div>
                </div>

                {/* Ollama AI Status */}
                <div className={`flex items-center justify-between p-4 border rounded-lg ${
                  systemStatus.ollama.status === 'error' ? 'border-red-500 bg-red-50 dark:bg-red-950/20' : ''
                }`}>
                  <div className="flex items-center gap-3">
                    {getStatusIcon(systemStatus.ollama.status)}
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        Ollama AI (Local LLM)
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {systemStatus.ollama.message}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-medium">
                    {statusLabel(systemStatus.ollama.status)}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* External Connectors */}
            <Card className="max-w-4xl mt-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wifi className="h-5 w-5" />
                  External Connectors
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* EDC Connector Status */}
                <div className={`flex items-center justify-between p-4 border rounded-lg ${
                  edcStatus.status === 'not_configured' ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20'
                  : edcStatus.status === 'error' || edcStatus.status === 'offline' ? 'border-red-500 bg-red-50 dark:bg-red-950/20' : ''
                }`}>
                  <div className="flex items-center gap-3">
                    {edcStatus.status === 'online' ? <Circle className="h-4 w-4 fill-current text-green-500" />
                      : edcStatus.status === 'not_configured' ? <Circle className="h-4 w-4 fill-current text-yellow-500" />
                      : edcStatus.status === 'checking' ? <Circle className="h-4 w-4 fill-current text-blue-500" />
                      : <Circle className="h-4 w-4 fill-current text-red-500" />}
                    <div>
                      <div className="font-medium">EDC Tractus-X Connector</div>
                      <div className="text-sm text-muted-foreground">
                        {edcStatus.message}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-medium">
                    {edcStatus.status === 'not_configured' ? 'Not Configured'
                      : edcStatus.status === 'online' ? 'Online'
                      : edcStatus.status === 'checking' ? 'Checking...'
                      : 'Offline'}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* User Management Tab (admin only) */}
          {isAdmin && (
          <TabsContent value="users" className="flex-1 overflow-auto">
            <Card className="max-w-4xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Pending Approvals
                    {pendingUsers.length > 0 && (
                      <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full bg-orange-500 text-white">
                        {pendingUsers.length}
                      </span>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchPendingUsers} disabled={pendingLoading}>
                    {pendingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!pendingConfigured ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Keycloak Admin API not configured. Set <code className="bg-muted px-1 rounded">KEYCLOAK_ADMIN_CLIENT_SECRET</code> to enable user management.
                  </div>
                ) : pendingError ? (
                  <div className="text-sm text-red-500 py-4 text-center">
                    Error: {pendingError}
                  </div>
                ) : pendingLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : pendingUsers.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    No pending registrations. All users have been approved.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingUsers.map(user => (
                      <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{user.firstName} {user.lastName}</div>
                          <div className="text-sm text-muted-foreground truncate">
                            {user.username}{user.email && ` · ${user.email}`}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Registered: {new Date(user.createdTimestamp).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-green-600 border-green-300 hover:bg-green-50 dark:hover:bg-green-950/30"
                            onClick={() => approveUser(user.id)}
                            disabled={actionLoading === user.id}
                          >
                            {actionLoading === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4 mr-1" /> Approve</>}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => rejectUser(user.id)}
                            disabled={actionLoading === user.id}
                          >
                            <X className="h-4 w-4 mr-1" /> Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}

          {/* GitHub Configuration Tab */}
          <TabsContent value="github" className="flex-1 min-h-0 overflow-hidden">
            <GitHubSettings />
          </TabsContent>

          {/* EDC Connector Tab */}
          <TabsContent value="edc" className="flex-1 overflow-auto">
            <EdcSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
