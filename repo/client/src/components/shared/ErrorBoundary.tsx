/**
 * APPLY-O — one React error boundary at the app shell.
 *
 * Every other error path in this client is a `.catch()` into state, which
 * handles asynchronous failure and nothing else. A synchronous throw during
 * render — a malformed row that slips past a schema, a null deref in a screen —
 * unmounted the whole tree and left an unrecoverable white page, in the middle
 * of a batch write, with no cancel. A white page is the one outcome this
 * product's error copy promises never to produce.
 *
 * A class component because React exposes `componentDidCatch` nowhere else.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from './ErrorState'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Called when the user asks to start again, so the shell can reset itself. */
  onReset?: () => void
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The browser console is the only sink this client has; swallowing a
    // render crash silently is worse than logging it.
    console.error('[classroom-copier] render error', error, info.componentStack)
  }

  private readonly reset = (): void => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="frame">
          <ErrorState
            detail="The screen could not be displayed. Nothing in your target course was changed by this."
            onStartOver={this.reset}
          />
        </div>
      )
    }
    return this.props.children
  }
}
