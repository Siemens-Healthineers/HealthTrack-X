import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[ErrorBoundary]', error, info.componentStack) }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="m-4 rounded border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="font-semibold text-destructive">Something went wrong</p>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {error.message}{'\n'}{error.stack}
        </pre>
        <button className="mt-3 rounded bg-primary px-3 py-1 text-xs text-primary-foreground"
          onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    )
  }
}
