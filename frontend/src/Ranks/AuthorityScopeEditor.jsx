import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { useSession } from '../Auth/sessionContext.js'
import './AuthorityScopeEditor.css'

const RANKS = [
  'Recruit',
  'Private',
  'Corporal',
  'Sergeant',
  'Master Sergeant',
  'Sergeant Major',
  'Lieutenant',
  'Captain',
  'Major',
  'Commander',
]

function rankOrder(rank) {
  return RANKS.indexOf(rank)
}

function scopeKey(type, scope) {
  return type === 'rank' ? scope.rank : scope.id
}

function scopeName(type, scope) {
  return type === 'rank' ? scope.rank : scope.name
}

function AuthorityScopeCard({
  type,
  scope,
  capabilities,
  actorAuthority,
  onSaved,
}) {
  const session = useSession()
  const [permissions, setPermissions] = useState(scope.permissions || [])
  const [maxManagedRank, setMaxManagedRank] = useState(
    scope.maxManagedRank || '',
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setPermissions(scope.permissions || [])
    setMaxManagedRank(scope.maxManagedRank || '')
  }, [scope])

  const actorPermissions = useMemo(
    () => new Set(actorAuthority?.permissions || []),
    [actorAuthority?.permissions],
  )

  const canEditRank =
    type !== 'rank' ||
    actorAuthority?.isOwner ||
    rankOrder(scope.rank) < rankOrder(actorAuthority?.memberRank)

  const canEdit = Boolean(canEditRank)

  function togglePermission(permission) {
    if (!canEdit) return

    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission],
    )
  }

  async function save() {
    if (busy || !canEdit) return

    setBusy(true)
    setMessage('')

    try {
      const endpoint =
        type === 'rank'
          ? '/api/guild/authority/ranks/' + encodeURIComponent(scope.rank)
          : '/api/guild/authority/billets/' + encodeURIComponent(scope.id)

      const result = await runAuthenticatedMutation({
        request: () =>
          apiJson(endpoint, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              permissions,
              maxManagedRank: maxManagedRank || null,
            }),
          }),
        refresh: session.refresh,
        reauthenticate: () =>
          session.signIn(
            window.location.pathname + window.location.search + window.location.hash,
          ),
      })

      if (!result) return

      onSaved?.(type, result.scope)
      await session.refresh()
      setMessage('Authority saved.')
    } catch (error) {
      if (error?.code === 'scope_above_actor') {
        setMessage('That would grant authority above your own.')
      } else {
        setMessage('Could not save authority.')
      }
    } finally {
      setBusy(false)
    }
  }

  const actorCeiling = actorAuthority?.isOwner
    ? 'Commander'
    : actorAuthority?.maxManagedRank
  const actorCeilingOrder = rankOrder(actorCeiling)

  return (
    <article className="authority-scope-card">
      <header>
        <div>
          <span>{type === 'rank' ? 'Rank' : 'Billet'}</span>
          <h3>{scopeName(type, scope)}</h3>
        </div>
        {scope.maxManagedRank ? (
          <small>Manages through {scope.maxManagedRank}</small>
        ) : (
          <small>No member-management authority</small>
        )}
      </header>

      {type === 'billet' && scope.responsibility ? (
        <p className="authority-scope-card__responsibility">
          {scope.responsibility}
        </p>
      ) : null}

      {!canEdit ? (
        <p className="authority-scope-card__locked">
          This scope is at or above your own rank and cannot be changed.
        </p>
      ) : (
        <>
          <div className="authority-scope-card__permissions">
            {capabilities.map((capability) => {
              const canGrant =
                actorAuthority?.isOwner ||
                actorPermissions.has(capability.id)

              return (
                <label key={capability.id}>
                  <input
                    type="checkbox"
                    checked={permissions.includes(capability.id)}
                    disabled={busy || !canGrant}
                    onChange={() => togglePermission(capability.id)}
                  />
                  <span>
                    <strong>{capability.label}</strong>
                    <small>{capability.description}</small>
                  </span>
                </label>
              )
            })}
          </div>

          <label className="authority-scope-card__ceiling">
            <span>Member management ceiling</span>
            <select
              value={maxManagedRank}
              disabled={busy}
              onChange={(event) => setMaxManagedRank(event.target.value)}
            >
              <option value="">No member-management authority</option>
              {RANKS.filter(
                (rank) =>
                  actorAuthority?.isOwner ||
                  rankOrder(rank) <= actorCeilingOrder,
              ).map((rank) => (
                <option key={rank} value={rank}>
                  Through {rank}
                </option>
              ))}
            </select>
          </label>

          <footer>
            <button type="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save authority'}
            </button>
            {message ? <small aria-live="polite">{message}</small> : null}
          </footer>
        </>
      )}
    </article>
  )
}

function AuthorityScopeEditor() {
  const session = useSession()
  const [catalog, setCatalog] = useState(null)
  const [status, setStatus] = useState('idle')

  const canManage = session.hasPermission('authority.manage')

  useEffect(() => {
    if (!session.authenticated || !canManage) {
      setCatalog(null)
      setStatus('idle')
      return
    }

    const controller = new AbortController()
    let active = true

    async function load() {
      setStatus('loading')

      try {
        const result = await apiJson('/api/guild/authority', {
          signal: controller.signal,
        })

        if (!active) return
        setCatalog(result)
        setStatus('ready')
      } catch (error) {
        if (!active || error?.name === 'AbortError') return
        setStatus('error')
      }
    }

    void load()

    return () => {
      active = false
      controller.abort()
    }
  }, [canManage, session.authenticated])

  if (!canManage) return null

  function updateScope(type, updated) {
    setCatalog((current) => {
      if (!current) return current

      const collection = type === 'rank' ? 'ranks' : 'billets'
      const id = scopeKey(type, updated)

      return {
        ...current,
        [collection]: current[collection].map((scope) =>
          scopeKey(type, scope) === id ? { ...scope, ...updated } : scope,
        ),
      }
    })
  }

  return (
    <section className="authority-scopes" aria-labelledby="authority-scopes-title">
      <header className="authority-scopes__heading">
        <div>
          <span>Commander controls</span>
          <h2 id="authority-scopes-title">Authority scopes</h2>
        </div>
        <p>
          Ranks provide baseline authority. Billets add job-specific authority.
          A leader can never grant permissions or a promotion ceiling above
          their own.
        </p>
      </header>

      {status === 'loading' ? (
        <p className="authority-scopes__state">Loading authority…</p>
      ) : status === 'error' ? (
        <p className="authority-scopes__state">
          Authority scopes could not be loaded.
        </p>
      ) : catalog ? (
        <>
          <div className="authority-scopes__group">
            <div>
              <span>Baseline authority</span>
              <h3>Ranks</h3>
            </div>
            <div className="authority-scopes__grid">
              {catalog.ranks.map((scope) => (
                <AuthorityScopeCard
                  key={scope.rank}
                  type="rank"
                  scope={scope}
                  capabilities={catalog.capabilities}
                  actorAuthority={session.authority}
                  onSaved={updateScope}
                />
              ))}
            </div>
          </div>

          <div className="authority-scopes__group">
            <div>
              <span>Job authority</span>
              <h3>Billets</h3>
            </div>
            <div className="authority-scopes__grid">
              {catalog.billets.map((scope) => (
                <AuthorityScopeCard
                  key={scope.id}
                  type="billet"
                  scope={scope}
                  capabilities={catalog.capabilities}
                  actorAuthority={session.authority}
                  onSaved={updateScope}
                />
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}

export default AuthorityScopeEditor
