/**
 * Main Layout Component
 * Kombiniert Sidebar mit Page Content
 */

import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AppLayout } from './AppLayout'

const ROUTE_MAP: Record<string, string> = {
  '/settings': 'settings',
  '/table': 'table',
  '/catalog': 'catalog',
  '/connector': 'connector',
  '/repo-graph': 'repo-graph',
  '/nx-structure': 'nx-structure',
  '/docs': 'docs',
} as const

const NAV_MAP: Record<string, string> = {
  'settings-status': '/settings?tab=status',
  settings: '/settings',
  table: '/table',
  catalog: '/catalog',
  connector: '/connector',
  'repo-graph': '/repo-graph',
  'nx-structure': '/nx-structure',
  docs: '/docs',
} as const

export function MainLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  
  const currentPage = ROUTE_MAP[location.pathname] ?? 'overview'
  
  const handleNavigate = (pageId: string) => {
    const target = NAV_MAP[pageId] ?? '/'
    // Standalone pages (outside MainLayout) need a full page load
    // because React Router transitions keep showing the old layout
    if (pageId === 'docs') {
      window.location.href = target
    } else {
      navigate(target)
    }
  }

  return (
    <AppLayout currentPage={currentPage} onNavigate={handleNavigate}>
      <Outlet />
    </AppLayout>
  )
}
