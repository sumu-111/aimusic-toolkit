import { Component, type ErrorInfo, type ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
  label: string
}

type ErrorBoundaryState = {
  error: Error | null
}

const COPY = {
  reset: '\u8be5\u9762\u677f\u5f02\u5e38\uff0c\u70b9\u51fb\u91cd\u7f6e',
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[boundary] ${this.props.label}`, error, info)
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <button
        className="panel-error-boundary"
        type="button"
        onClick={() => this.setState({ error: null })}
      >
        <strong>{COPY.reset}</strong>
        <span>{this.props.label}</span>
      </button>
    )
  }
}
