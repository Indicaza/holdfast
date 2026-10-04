import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/tokens.css'
import './index.css'
import App from './App.jsx'
import AppErrorBoundary from './AppErrorBoundary/AppErrorBoundary.jsx'
import { SessionProvider } from './Auth/SessionProvider.jsx'
import RecruitmentProvider from './Join/RecruitmentProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <SessionProvider>
        <RecruitmentProvider>
          <App />
        </RecruitmentProvider>
      </SessionProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
