import { useEffect, useRef } from 'react'

import { DASHBOARD_GROUPS } from './playerModel.js'
import Tip from './Tooltip.jsx'
import { Icon } from './ui.jsx'

function isMac() {
  return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '')
}

// The search box in the toolbar: a button that opens the command palette.
function SearchTrigger({ onOpen }) {
  return (
    <button type="button" className="gw-search-trigger" onClick={onOpen} aria-label="Search drops, sources and characters" aria-keyshortcuts="Meta+K Control+K /">
      <Icon name="search" size={15} />
      <span>Search drops, nodes, pools…</span>
      <kbd>{isMac() ? '⌘' : 'Ctrl'} K</kbd>
    </button>
  )
}

function Brand() {
  return (
    <a className="gw-brand" href="/" aria-label="Guildweaver home">
      <svg className="gw-brand__mark" width="22" height="22" viewBox="0 0 28 28" aria-hidden="true">
        <path d="M4 7 C10 7 10 21 16 21 S22 7 24 7" />
        <path d="M4 21 C10 21 10 7 16 7 S22 21 24 21" />
      </svg>
      <span className="gw-brand__name">Guildweaver</span>
    </a>
  )
}

// Every section as a labelled link, grouped Explore / You.
function SideNav({ views, activeView, collapsed, onNavigate }) {
  return (
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
                <Tip key={view.id} label={view.label} side="right" disabled={!collapsed}>
                  <a
                    href={view.href}
                    className={`gw-side__link${active ? ' is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={onNavigate}
                  >
                    <Icon name={view.icon} />
                    <span>{view.label}</span>
                  </a>
                </Tip>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}

// While a page uses the sidebar for its own tools (the map's legend), the
// sections stay one click away as a row of icons.
function SideTabs({ views, activeView, collapsed, onNavigate }) {
  return (
    <nav className="gw-side__tabs" aria-label="Dashboard workspaces">
      {views.map((view) => {
        const active = view.id === activeView
        return (
          <Tip key={view.id} label={view.label} side={collapsed ? 'right' : 'bottom'}>
            <a
              href={view.href}
              className={`gw-side__tab${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
              aria-label={view.label}
              onClick={onNavigate}
            >
              <Icon name={view.icon} size={17} />
            </a>
          </Tip>
        )
      })}
    </nav>
  )
}

// The player app's frame: a sidebar with the brand, the server and every
// section, and a slim toolbar with the page title, search and the account.
// Pages scroll with the window; the sidebar and toolbar stay put.
export default function PlayerShell({
  views,
  activeView,
  title,
  serverPicker,
  syncStatus,
  account,
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

  const closeMobile = () => onToggleMobile(false)
  const foldLabel = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'

  return (
    <div className={`gw${collapsed ? ' gw--collapsed' : ''}${mobileOpen ? ' gw--mobile-open' : ''}${sidebar ? ' gw--tools' : ''}`}>
      <aside className="gw-side" aria-label="Dashboard">
        <div className="gw-side__brand">
          <Brand />
          <button ref={closeButtonRef} type="button" className="gw-icon-btn gw-icon-btn--quiet gw-side__close" aria-label="Close dashboard navigation" onClick={closeMobile}>
            <Icon name="close" />
          </button>
        </div>
        <div className="gw-side__top">{serverPicker}</div>

        {sidebar ? (
          <>
            <SideTabs views={views} activeView={activeView} collapsed={collapsed} onNavigate={closeMobile} />
            {sidebar}
          </>
        ) : (
          <SideNav views={views} activeView={activeView} collapsed={collapsed} onNavigate={closeMobile} />
        )}

        <div className="gw-side__foot">
          {syncStatus}
          <Tip label={foldLabel.replace(' the sidebar', ' sidebar')} shortcut="[" side="right" disabled={!collapsed}>
            <button
              type="button"
              className="gw-side__collapse"
              aria-label={foldLabel}
              aria-pressed={collapsed}
              aria-keyshortcuts="["
              onClick={onToggleCollapsed}
            >
              <Icon name="collapse" size={16} />
              <span>{collapsed ? 'Expand' : 'Collapse'}</span>
              <kbd aria-hidden="true">[</kbd>
            </button>
          </Tip>
        </div>
      </aside>

      <button type="button" className="gw-backdrop" aria-label="Close dashboard navigation" tabIndex={-1} onClick={closeMobile} />

      <div className="gw-main">
        <header className="gw-top">
          <button
            ref={menuButtonRef}
            type="button"
            className="gw-icon-btn gw-icon-btn--quiet gw-top__menu"
            aria-label="Open dashboard navigation"
            aria-expanded={mobileOpen}
            onClick={() => onToggleMobile(true)}
          >
            <Icon name="menu" />
          </button>
          <Tip label={foldLabel.replace(' the sidebar', ' sidebar')} shortcut="[" side="bottom">
            <button
              type="button"
              className="gw-icon-btn gw-icon-btn--quiet gw-top__fold"
              aria-label={foldLabel}
              aria-pressed={collapsed}
              aria-keyshortcuts="["
              onClick={onToggleCollapsed}
            >
              <Icon name="collapse" size={17} />
            </button>
          </Tip>
          <h1 className="gw-top__title">{title}</h1>
          <div className="gw-top__actions">
            <SearchTrigger onOpen={onOpenSearch} />
            {account}
          </div>
        </header>
        <main className={`gw-content${fill ? ' gw-content--fill' : ''}`} id="main-content">{children}</main>
      </div>
    </div>
  )
}
