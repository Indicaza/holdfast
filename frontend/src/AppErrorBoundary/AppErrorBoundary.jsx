import { Component } from 'react'
import './AppErrorBoundary.css'

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    console.error('Holdfast interface failed', error, info)
  }

  render() {
    if (!this.state.failed) {
      return this.props.children
    }

    return (
      <main className="app-error">
        <span className="app-error__mark" aria-hidden="true">
          ♜
        </span>
        <p className="app-error__eyebrow">Holdfast</p>
        <h1>The gate jammed.</h1>
        <p>
          The page hit an unexpected problem. Reload it once and we will try
          the approach again.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload Holdfast
        </button>
      </main>
    )
  }
}

export default AppErrorBoundary
