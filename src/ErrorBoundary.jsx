import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Queue render error:', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return <main className="q-auth-screen"><section className="q-auth-card"><div className="q-brand"><span className="q-brand-mark">Q</span><strong>QUEUE</strong></div><p className="q-eyebrow">APP ERROR</p><h1>Queue’i ei saanud avada</h1><p>Laadi leht uuesti. Kui probleem kordub, ava arendaja konsool ja jaga veateadet.</p><button className="q-button q-button--primary" onClick={() => window.location.reload()}>Laadi uuesti</button></section></main>
    }
    return this.props.children
  }
}
