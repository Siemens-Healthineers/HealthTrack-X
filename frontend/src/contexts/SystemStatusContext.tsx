import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import { apiFetch } from '../config/api'

type ServiceStatus = 'online' | 'offline' | 'warning' | 'checking' | 'error'

interface ServiceState {
  status: ServiceStatus
  message: string
  count?: number
}

interface SystemStatusState {
  backend: ServiceState
  nats: ServiceState
  github: ServiceState & { repository?: string; auth_method?: string }
  ollama: ServiceState
  overallStatus: ServiceStatus
  runningCount: number
}

interface SystemStatusContextType {
  status: SystemStatusState
  checkStatus: () => Promise<void>
}

const SystemStatusContext = createContext<SystemStatusContextType | undefined>(undefined)

const FAST_POLL_MS = 3000
const SLOW_POLL_MS = 30000
const HIDDEN_TAB_POLL_MS = 60000
const STARTUP_FAST_POLL_MS = 60000

/** Shallow-compare two status objects.  Returns true if they differ. */
function statusChanged(a: SystemStatusState, b: Partial<SystemStatusState>): boolean {
  if (b.overallStatus !== undefined && b.overallStatus !== a.overallStatus) return true
  if (b.runningCount !== undefined && b.runningCount !== a.runningCount) return true
  if (b.backend && (b.backend.status !== a.backend.status || b.backend.message !== a.backend.message)) return true
  if (b.nats && (b.nats.status !== a.nats.status || b.nats.message !== a.nats.message)) return true
  if (b.github && (b.github.status !== a.github.status || b.github.message !== a.github.message)) return true
  if (b.ollama && (b.ollama.status !== a.ollama.status || b.ollama.message !== a.ollama.message)) return true
  return false
}

export function SystemStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SystemStatusState>({
    backend: { status: 'checking', message: 'Checking...' },
    nats: { status: 'checking', message: 'Checking...' },
    github: { status: 'checking', message: 'Checking...' },
    ollama: { status: 'checking', message: 'Checking...' },
    overallStatus: 'checking',
    runningCount: 0
  })
  const pollIntervalRef = useRef<number>(FAST_POLL_MS)
  const pollTimeoutRef = useRef<number | null>(null)
  const statusCheckInFlightRef = useRef(false)
  // Use ref for checkAttempts to avoid stale closure in setInterval
  const checkAttemptsRef = useRef<number>(0)

  const fallbackStatusCheck = useCallback(async (newStatus: Partial<SystemStatusState>) => {
    // Check Backend with simple endpoint
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      
      const backendResponse = await apiFetch('/', { 
        signal: controller.signal,
        mode: 'cors'
      })
      clearTimeout(timeoutId)
      
      newStatus.backend = backendResponse.ok 
        ? { status: 'online', message: 'Backend API running' }
        : { status: 'warning', message: `Backend returned ${backendResponse.status}` }
      
      if (backendResponse.ok) {
        newStatus.nats = { status: 'online', message: 'NATS available' }
        newStatus.github = { status: 'checking', message: 'GitHub status unknown in fallback mode' }
        newStatus.ollama = { status: 'checking', message: 'Ollama status unknown in fallback mode' }
      } else {
        newStatus.nats = { status: 'offline', message: 'NATS offline' }
        newStatus.github = { status: 'offline', message: 'Cannot check GitHub status' }
      }
      newStatus.ollama = { status: 'offline', message: 'Cannot check Ollama status' }
    } catch (error) {
      newStatus.backend = { status: 'offline', message: 'Backend not reachable' }
      newStatus.nats = { status: 'offline', message: 'NATS not available' }
      newStatus.github = { status: 'offline', message: 'Cannot check GitHub status' }
      newStatus.ollama = { status: 'offline', message: 'Cannot check Ollama status' }
    }

    // Calculate overall status for fallback (use 'checking' as safe default)
    const backend = newStatus.backend?.status || 'checking'
    const natsStatus = newStatus.nats?.status || 'checking'
    const github = newStatus.github?.status || 'checking'
    const ollama = newStatus.ollama?.status || 'offline'

    let runningCount = 0
    if (backend === 'online') runningCount++
    if (natsStatus === 'online') runningCount++
    if (github === 'online') runningCount++
    if (ollama === 'online') runningCount++
    newStatus.runningCount = runningCount

    if (backend === 'checking' || natsStatus === 'checking' || github === 'checking') {
      newStatus.overallStatus = 'checking'
    } else if (backend === 'online' && natsStatus === 'online' && github === 'online') {
      newStatus.overallStatus = 'online'
    } else if (backend === 'offline' || natsStatus === 'offline') {
      newStatus.overallStatus = 'offline'
    } else {
      newStatus.overallStatus = 'warning'
    }
  }, [])

  const checkStatus = useCallback(async () => {
    if (statusCheckInFlightRef.current) return
    statusCheckInFlightRef.current = true
    const newStatus: Partial<SystemStatusState> = {}

    try {
      const controller = new AbortController()
      // Backend checks Ollama which can take 2+ seconds, so use adequate timeout
      const timeout = checkAttemptsRef.current < 3 ? 5000 : 8000
      const timeoutId = setTimeout(() => controller.abort(), timeout)
      
      // Try to get detailed system status
      const statusResponse = await apiFetch('/api/system-status', { 
        signal: controller.signal,
        mode: 'cors'
      })
      clearTimeout(timeoutId)
      
      if (statusResponse.ok) {
        const data = await statusResponse.json()
        
        newStatus.backend = {
          status: data.backend.status,
          message: data.backend.message,
          count: data.backend.count
        }
        newStatus.nats = {
          status: data.nats?.status || 'online',
          message: data.nats?.message || 'NATS JetStream',
        }
        newStatus.github = {
          status: data.github.status,
          message: data.github.message,
          repository: data.github.repository,
          auth_method: data.github.auth_method
        }
        newStatus.ollama = {
          status: data.ollama?.status || 'offline',
          message: data.ollama?.message || 'Ollama status unknown',
        }
        
        // Use the overall status and count from backend
        newStatus.overallStatus = data.overall_status as ServiceStatus
        newStatus.runningCount = data.running_count
        
        // Reset check attempts on success
        checkAttemptsRef.current = 0
      } else {
        // Fallback to simple check
        await fallbackStatusCheck(newStatus)
      }
    } catch (error) {
      // During initial startup (first 5 attempts), keep showing "checking" instead of "offline"
      checkAttemptsRef.current += 1
      
      if (checkAttemptsRef.current <= 5) {
        // Keep checking status for first few attempts
        newStatus.backend = { status: 'checking', message: 'Waiting for backend...' }
        newStatus.nats = { status: 'checking', message: 'Waiting for NATS...' }
        newStatus.github = { status: 'checking', message: 'Waiting for GitHub check...' }
        newStatus.overallStatus = 'checking'
        newStatus.runningCount = 0
      } else {
        // After several attempts, fall back to offline status
        await fallbackStatusCheck(newStatus)
      }
    }

    // Only trigger a React re-render when status values actually changed
    setStatus(prev => {
      if (!statusChanged(prev, newStatus)) return prev          // same reference = no re-render
      return { ...prev, ...newStatus } as SystemStatusState
    })
    
    // Switch to slow polling if all services are online, recover to fast polling if not
    if (newStatus.overallStatus === 'online' && pollIntervalRef.current === FAST_POLL_MS) {
      pollIntervalRef.current = SLOW_POLL_MS
    } else if (newStatus.overallStatus !== 'online' && newStatus.overallStatus !== 'checking' && pollIntervalRef.current === SLOW_POLL_MS) {
      pollIntervalRef.current = FAST_POLL_MS
    }
    statusCheckInFlightRef.current = false
  }, [fallbackStatusCheck])

  useEffect(() => {
    let mounted = true
    
    // Switch to slow polling after 60 seconds even if not all services are online
    const slowPollTimeout = setTimeout(() => {
      if (pollIntervalRef.current === FAST_POLL_MS) {
        pollIntervalRef.current = SLOW_POLL_MS
      }
    }, STARTUP_FAST_POLL_MS)

    // Self-scheduling poll: reads pollIntervalRef at each tick
    // so interval changes take effect without tearing down the timer.
    async function poll() {
      if (!mounted) return
      if (document.visibilityState !== 'hidden') {
        await checkStatus()
      }
      if (mounted) {
        const nextPollMs = document.visibilityState === 'hidden'
          ? HIDDEN_TAB_POLL_MS
          : pollIntervalRef.current
        pollTimeoutRef.current = window.setTimeout(poll, nextPollMs)
      }
    }
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible' || statusCheckInFlightRef.current) return
      if (pollTimeoutRef.current) window.clearTimeout(pollTimeoutRef.current)
      void poll()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    poll()
    
    return () => {
      mounted = false
      clearTimeout(slowPollTimeout)
      if (pollTimeoutRef.current) window.clearTimeout(pollTimeoutRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, []) // empty deps — runs once, self-schedules

  return (
    <SystemStatusContext.Provider value={{ status, checkStatus }}>
      {children}
    </SystemStatusContext.Provider>
  )
}

export function useSystemStatus() {
  const context = useContext(SystemStatusContext)
  if (!context) {
    throw new Error('useSystemStatus must be used within SystemStatusProvider')
  }
  return context
}
