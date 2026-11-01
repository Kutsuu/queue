import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import './queue.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Queue root element is missing.')
createRoot(rootElement).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>)
window.__QUEUE_MARK_READY__?.()
