import { useCallback, useEffect, useRef, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import './NotificationBell.css'

function relativeTime(value) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return ''

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`

  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </svg>
  )
}

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [inbox, setInbox] = useState({
    notifications: [],
    unreadCount: 0,
    actionCount: 0,
  })
  const [status, setStatus] = useState('loading')
  const rootRef = useRef(null)

  const refresh = useCallback(async () => {
    try {
      const next = await apiJson('/api/notifications')
      setInbox({
        notifications: Array.isArray(next?.notifications) ? next.notifications : [],
        unreadCount: Number(next?.unreadCount) || 0,
        actionCount: Number(next?.actionCount) || 0,
      })
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    refresh()

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 45_000)

    function handleFocus() {
      refresh()
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') refresh()
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh])

  useEffect(() => {
    if (!open) return undefined

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  async function openNotification(notification) {
    if (!notification.readAt) {
      setInbox((current) => ({
        ...current,
        unreadCount: Math.max(0, current.unreadCount - (notification.resolvedAt ? 0 : 1)),
        notifications: current.notifications.map((item) =>
          item.id === notification.id
            ? { ...item, readAt: new Date().toISOString() }
            : item,
        ),
      }))

      try {
        await apiJson(`/api/notifications/${encodeURIComponent(notification.id)}/read`, {
          method: 'POST',
        })
      } catch {
        refresh()
      }
    }

    if (notification.href) {
      window.location.assign(notification.href)
    }
  }

  async function markAllRead() {
    const now = new Date().toISOString()
    setInbox((current) => ({
      ...current,
      unreadCount: 0,
      notifications: current.notifications.map((item) => ({
        ...item,
        readAt: item.readAt || now,
      })),
    }))

    try {
      await apiJson('/api/notifications/read-all', { method: 'POST' })
    } catch {
      refresh()
    }
  }

  const badge = inbox.unreadCount > 99 ? '99+' : String(inbox.unreadCount)

  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        className="notification-bell__button"
        type="button"
        aria-label={`Notifications${inbox.unreadCount ? `, ${inbox.unreadCount} unread` : ''}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value)
          if (!open) refresh()
        }}
      >
        <BellIcon />
        {inbox.unreadCount > 0 ? (
          <span className="notification-bell__badge" aria-hidden="true">{badge}</span>
        ) : null}
      </button>

      {open ? (
        <section
          className="notification-bell__panel notification-bell__panel--open"
          aria-label="Notifications"
        >
          <header className="notification-bell__header">
            <div>
              <strong>Notifications</strong>
              {inbox.actionCount > 0 ? <span>{inbox.actionCount} need you</span> : null}
            </div>
            {inbox.unreadCount > 0 ? (
              <button type="button" onClick={markAllRead}>Mark all read</button>
            ) : null}
          </header>

          <div className="notification-bell__list">
            {status === 'loading' ? (
              <p className="notification-bell__empty">Checking Holdfast…</p>
            ) : status === 'error' ? (
              <button className="notification-bell__retry" type="button" onClick={refresh}>
                Couldn’t load notifications. Retry
              </button>
            ) : inbox.notifications.length === 0 ? (
              <p className="notification-bell__empty">You’re caught up.</p>
            ) : (
              inbox.notifications.map((notification) => {
                const unread = !notification.readAt && !notification.resolvedAt
                const actionable = notification.kind === 'action' && !notification.resolvedAt

                return (
                  <button
                    key={notification.id}
                    className={`notification-bell__item ${unread ? 'notification-bell__item--unread' : ''}`}
                    type="button"
                    onClick={() => openNotification(notification)}
                  >
                    <span className="notification-bell__item-topline">
                      <strong>{notification.title}</strong>
                      <time dateTime={notification.createdAt}>{relativeTime(notification.createdAt)}</time>
                    </span>
                    {notification.message ? <span>{notification.message}</span> : null}
                    <span className="notification-bell__item-meta">
                      {actionable ? <em>Needs you</em> : null}
                      {notification.resolvedAt ? <em>Handled</em> : null}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </section>
      ) : null}
    </div>
  )
}

export default NotificationBell
