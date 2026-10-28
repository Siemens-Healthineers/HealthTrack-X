import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { MainLayout } from './components/layout/MainLayout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toaster } from './components/ui/toaster'
import { TooltipProvider } from './components/ui/tooltip'
import { ThemeProvider } from './contexts/ThemeContext'
import { SystemStatusProvider } from './contexts/SystemStatusContext'
import { AppProfileProvider } from './contexts/AppProfileContext'
import { AuthProvider } from './contexts/AuthContext'
import { AuthGate } from './components/auth/AuthGate'
import { AuthCallbackPage } from './components/auth/AuthCallbackPage'
import { MutationApprovalDialog } from './components/mutations/MutationApprovalDialog'
import './index.css'

// Eagerly preload ReactFlow — on Azure Cloud the separate chunk downloads
// in parallel with the main bundle, so it's cached before the user navigates
// to the repo-graph view.  No extra round-trip at navigation time.
import 'reactflow'
import 'reactflow/dist/style.css'

// Lazy-loaded pages — only downloaded when the route is visited.
const OverviewPage = lazy(() => import('./pages/OverviewPage').then(m => ({ default: m.OverviewPage })))
const TablePage = lazy(() => import('./pages/TablePage').then(m => ({ default: m.TablePage })))
const CatalogPage = lazy(() => import('./pages/CatalogPage').then(m => ({ default: m.CatalogPage })))
const ConnectorPage = lazy(() => import('./pages/ConnectorPage').then(m => ({ default: m.ConnectorPage })))
const RepoGraphPage = lazy(() => import('./pages/RepoGraphPage').then(m => ({ default: m.RepoGraphPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const DppViewerPage = lazy(() => import('./pages/DppViewerPage').then(m => ({ default: m.DppViewerPage })))
const DocsPage = lazy(() => import('./pages/DocsPage'))
// [NX-INTEGRATION] Lazy-loaded Siemens NX structure page
const NxStructurePage = lazy(() => import('./pages/NxStructurePage').then(m => ({ default: m.NxStructurePage })))

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  )
}

function ProtectedApp({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <SystemStatusProvider>
        <AppProfileProvider>
          {children}
          <MutationApprovalDialog />
        </AppProfileProvider>
      </SystemStatusProvider>
    </AuthGate>
  )
}

function LazyRoute({ children, withErrorBoundary = true }: { children: ReactNode; withErrorBoundary?: boolean }) {
  const content = <Suspense fallback={<PageFallback />}>{children}</Suspense>
  return withErrorBoundary ? <ErrorBoundary>{content}</ErrorBoundary> : content
}

function ProtectedRoute({ children, withErrorBoundary = true }: { children: ReactNode; withErrorBoundary?: boolean }) {
  return (
    <ProtectedApp>
      <LazyRoute withErrorBoundary={withErrorBoundary}>{children}</LazyRoute>
    </ProtectedApp>
  )
}

function App() {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="auth/callback" element={<AuthCallbackPage />} />
              <Route path="dpp/:configId/:folder/:productId" element={<ProtectedRoute><DppViewerPage /></ProtectedRoute>} />
              <Route path="docs" element={<ProtectedRoute><DocsPage /></ProtectedRoute>} />
              <Route path="/" element={<ProtectedApp><MainLayout /></ProtectedApp>}>
                <Route index element={<LazyRoute><OverviewPage /></LazyRoute>} />
                <Route path="table" element={<LazyRoute><TablePage /></LazyRoute>} />
                <Route path="catalog" element={<LazyRoute><CatalogPage /></LazyRoute>} />
                <Route path="connector" element={<LazyRoute><ConnectorPage /></LazyRoute>} />
                <Route path="repo-graph" element={<LazyRoute><RepoGraphPage /></LazyRoute>} />
                <Route path="nx-structure" element={<LazyRoute><NxStructurePage /></LazyRoute>} />
                <Route path="settings" element={<LazyRoute><SettingsPage /></LazyRoute>} />
              </Route>
            </Routes>
            <Toaster />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
