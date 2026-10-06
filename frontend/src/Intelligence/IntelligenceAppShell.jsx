import { useEffect } from 'react'

import Navbar from '../Home/Navbar/Navbar.jsx'
import LiveStatusBadge from '../Live/LiveStatusBadge.jsx'
import intelligenceViews from './intelligenceViews.js'
import './IntelligenceAppShell.css'
import './IntelligenceOpsTuning.css'

function ViewIcon({ name }) {
  if (name === 'overview') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    )
  }

  if (name === 'roster') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 9 9h-9V3Z" />
        <path d="M15 3.6A8.4 8.4 0 0 1 20.4 9H15V3.6Z" />
      </svg>
    )
  }

  if (name === 'characters') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.2" />
        <path d="M3.5 20c.4-4 2.3-6 5.5-6s5.1 2 5.5 6" />
        <path d="M14.5 15.2c.7-.8 1.7-1.2 2.9-1.2 2.1 0 3.4 1.4 3.8 4.2" />
      </svg>
    )
  }

  if (name === 'audit') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3h9l3 3v15H6V3Z" />
        <path d="M15 3v4h4M9 11h6M9 15h6" />
      </svg>
    )
  }

  if (name === 'guildweaver') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6" cy="12" r="2.5" />
        <circle cx="18" cy="7" r="2.5" />
        <circle cx="18" cy="17" r="2.5" />
        <path d="m8.2 10.9 7.6-3M8.2 13.1l7.6 3" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 5 5" />
      <path d="M8 10.5h5M10.5 8v5" />
    </svg>
  )
}

function ViewButton({ activeView, collapsed, onSelect, view }) {
  const active = activeView === view.id
  return (
    <button
      className={`intelligence-rail__nav-item ${active ? 'intelligence-rail__nav-item--active' : ''}`}
      type="button"
      title={collapsed ? view.label : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(view.id)}
    >
      <span className="intelligence-rail__nav-icon"><ViewIcon name={view.icon} /></span>
      <span className="intelligence-rail__nav-copy">
        <strong>{view.label}</strong>
        <small>{view.description}</small>
      </span>
    </button>
  )
}

export default function IntelligenceAppShell({
  activeView,
  collapsed,
  freshCharacters,
  mobileOpen,
  onSelectView,
  onToggleCollapsed,
  onToggleMobile,
  views = intelligenceViews,
  children,
}) {
  const currentView = views.find((view) => view.id === activeView) || views[0] || intelligenceViews[0]
  const guildViews = views.filter((view) => view.section !== 'operations')
  const operationViews = views.filter((view) => view.section === 'operations')

  useEffect(() => {
    if (!mobileOpen) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') onToggleMobile(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mobileOpen, onToggleMobile])

  function selectView(view) {
    onSelectView(view)
    onToggleMobile(false)
  }

  return (
    <>
      <Navbar />
      <div className={`intelligence-app ${collapsed ? 'intelligence-app--collapsed' : ''} ${mobileOpen ? 'intelligence-app--mobile-open' : ''}`}>
        <aside className="intelligence-rail" aria-label="GuildOS navigation">
          <div className="intelligence-rail__brand-row">
            <div className="intelligence-rail__brand" aria-label="GuildOS">
              <span className="intelligence-rail__brand-mark" aria-hidden="true">♜</span>
              <span className="intelligence-rail__brand-copy">
                <strong>GuildOS</strong>
                <small>Holdfast operations</small>
              </span>
            </div>
            <button
              className="intelligence-rail__close-mobile"
              type="button"
              aria-label="Close GuildOS navigation"
              onClick={() => onToggleMobile(false)}
            >
              ×
            </button>
          </div>

          <nav className="intelligence-rail__nav" aria-label="GuildOS workspaces">
            <div className="intelligence-rail__section-label">Guild</div>
            {guildViews.map((view) => (
              <ViewButton
                activeView={activeView}
                collapsed={collapsed}
                key={view.id}
                onSelect={selectView}
                view={view}
              />
            ))}

            {operationViews.length ? <div className="intelligence-rail__section-label">Operations</div> : null}

            {operationViews.map((view) => (
              <ViewButton
                activeView={activeView}
                collapsed={collapsed}
                key={view.id}
                onSelect={selectView}
                view={view}
              />
            ))}
          </nav>

          <div className="intelligence-rail__footer">
            <button
              className="intelligence-rail__collapse"
              type="button"
              aria-label={collapsed ? 'Expand GuildOS navigation' : 'Collapse GuildOS navigation'}
              aria-pressed={collapsed}
              onClick={onToggleCollapsed}
            >
              <span aria-hidden="true">{collapsed ? '→' : '←'}</span>
              <span>{collapsed ? 'Expand' : 'Collapse'}</span>
            </button>
          </div>
        </aside>

        <button
          className="intelligence-app__backdrop"
          type="button"
          aria-label="Close GuildOS navigation"
          onClick={() => onToggleMobile(false)}
        />

        <div className="intelligence-app__main">
          <header className="intelligence-app__topbar">
            <div className="intelligence-app__heading">
              <button
                className="intelligence-app__menu-button"
                type="button"
                aria-label="Open GuildOS navigation"
                aria-expanded={mobileOpen}
                onClick={() => onToggleMobile(true)}
              >
                <span />
                <span />
                <span />
              </button>
              <div>
                <span>GuildOS</span>
                <h1>{currentView.label}</h1>
                <p>{currentView.description}</p>
              </div>
            </div>

            <div className="intelligence-app__actions">
              <LiveStatusBadge />
              <div className="intelligence-app__freshness" title="Characters reporting within the last 24 hours">
                <span aria-hidden="true" />
                <strong>{freshCharacters}</strong>
                <small>fresh</small>
              </div>
            </div>
          </header>

          <main className="intelligence-app__workspace">
            <div className="intelligence-app__content">{children}</div>
          </main>
        </div>
      </div>
    </>
  )
}
