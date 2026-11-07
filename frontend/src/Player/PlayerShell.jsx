import { useEffect, useRef } from 'react'

import { DASHBOARD_GROUPS } from './playerModel.js'
import { Icon } from './ui.jsx'

function isMac() {
  return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '')
}

// The search box in the top bar: a button that opens the command palette.
function SearchTrigger({ onOpen }) {
  return (
    <button type="button" className="gw-search-trigger" onClick={onOpen} aria-label="Search drops, sources and characters" aria-keyshortcuts="Meta+K Control+K /">
      <Icon name="search" size={16} />
      <span>Search drops, nodes, pools…</span>
      <kbd>{isMac() ? '⌘' : 'Ctrl'} K</kbd>
    </button>
  )
}

// The player app's frame: a sidebar of sections grouped Explore / You, and a
// top bar with the page title and global search. Pages scroll with the
// window; the sidebar and top bar stay put.
export default function PlayerShell({
  views,
  activeView,
  title,
  eyebrow,
  description,
  serverPicker,
  syncStatus,
  topActions,
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onToggleMobile,
  onOpenSearch,
  fill = false,
  sidebar = null,
  children,
}) {
  const menuButtonRef = useRef(null)
  const closeButtonRef = useRef(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (mobileOpen) closeButtonRef.current?.focus()
    else if (wasOpen.current) menuButtonRef.current?.focus()
    wasOpen.current = mobileOpen
  }, [mobileOpen])

  useEffect(() => {
    if (!mobileOpen) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onToggleMobile(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen, onToggleMobile])

  return (
    <div className={`gw${collapsed ? ' gw--collapsed' : ''}${mobileOpen ? ' gw--mobile-open' : ''}`}>
      <aside className="gw-side" aria-label="Dashboard">
        <div className="gw-side__top">
          {serverPicker}
          <button ref={closeButtonRef} type="button" className="gw-icon-btn gw-side__close" aria-label="Close dashboard navigation" onClick={() => onToggleMobile(false)}>
            <Icon name="close" />
          </button>
        </div>

        {sidebar || (
        <nav className="gw-side__nav" aria-label="Dashboard workspaces">
          {DASHBOARD_GROUPS.map((group) => {
            const items = views.filter((view) => view.group === group.id)
            if (!items.length) return null
            return (
              <div className="gw-side__group" key={group.id}>
                <span className="gw-side__label">{group.label}</span>
                {items.map((view) => {
                  const active = view.id === activeView
                  return (
                    <a
                      key={view.id}
                      href={view.href}
                      className={`gw-side__link${active ? ' is-active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? view.label : view.description}
                      onClick={() => onToggleMobile(false)}
                    >
                      <Icon name={view.icon} />
                      <span>{view.label}</span>
                    </a>
                  )
                })}
              </div>
            )
          })}
        </nav>
        )}

        <div className="gw-side__foot">
          {syncStatus}
          <button
            type="button"
            className="gw-side__collapse"
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            aria-pressed={collapsed}
            aria-keyshortcuts="["
            title={`${collapsed ? 'Expand' : 'Collapse'} the sidebar ( [ )`}
            onClick={onToggleCollapsed}
          >
            <Icon name="collapse" size={16} />
            <span>{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </aside>

      <button type="button" className="gw-backdrop" aria-label="Close dashboard navigation" tabIndex={-1} onClick={() => onToggleMobile(false)} />

      <div className="gw-main">
        <header className="gw-top">
          <button
            ref={menuButtonRef}
            type="button"
            className="gw-icon-btn gw-top__menu"
            aria-label="Open dashboard navigation"
            aria-expanded={mobileOpen}
            onClick={() => onToggleMobile(true)}
          >
            <Icon name="menu" />
          </button>
          <button
            type="button"
            className="gw-icon-btn gw-top__fold"
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            aria-pressed={collapsed}
            aria-keyshortcuts="["
            title={`${collapsed ? 'Expand' : 'Collapse'} the sidebar ( [ )`}
            onClick={onToggleCollapsed}
          >
            <Icon name="collapse" />
          </button>
          <div className="gw-top__title">
            {eyebrow ? <span className="gw-eyebrow">{eyebrow}</span> : null}
            <h1>{title}</h1>
            {description ? <p>{description}</p> : null}
          </div>
          <div className="gw-top__actions">
            <SearchTrigger onOpen={onOpenSearch} />
            {topActions}
          </div>
        </header>
        <main className={`gw-content${fill ? ' gw-content--fill' : ''}`} id="main-content">{children}</main>
      </div>
    </div>
  )
}
