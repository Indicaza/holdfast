import { useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { useSession } from '../Auth/sessionContext.js'
import './BilletControls.css'

function BilletDefinitionManager({ billets, onChanged }) {
  const session = useSession()
  const [name, setName] = useState('')
  const [responsibility, setResponsibility] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editResponsibility, setEditResponsibility] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  if (!session.hasPermission('site.admin')) {
    return null
  }

  async function mutate(request) {
    return runAuthenticatedMutation({
      request,
      refresh: session.refresh,
      reauthenticate: () =>
        session.signIn(
          window.location.pathname + window.location.search + window.location.hash,
        ),
    })
  }

  async function createDefinition(event) {
    event.preventDefault()

    if (busy || !name.trim()) return

    setBusy(true)
    setMessage('')

    try {
      const result = await mutate(() =>
        apiJson('/api/guild/billets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name,
            responsibility,
          }),
        }),
      )

      if (!result) return

      onChanged?.((current) =>
        [...current, result.billet].sort((left, right) =>
          left.name.localeCompare(right.name, undefined, {
            sensitivity: 'base',
          }),
        ),
      )
      setName('')
      setResponsibility('')
      setMessage(
        result.discordSync?.status === 'synced'
          ? 'Billet created and Discord role synced.'
          : 'Billet created. Discord role sync will retry automatically.',
      )
    } catch (error) {
      setMessage(
        error?.code === 'duplicate_name'
          ? 'A billet with that name already exists.'
          : 'Could not create billet.',
      )
    } finally {
      setBusy(false)
    }
  }

  function beginEdit(billet) {
    setEditingId(billet.id)
    setEditName(billet.name)
    setEditResponsibility(billet.responsibility || '')
    setMessage('')
  }

  async function saveEdit(billetId) {
    if (busy || !editName.trim()) return

    setBusy(true)
    setMessage('')

    try {
      const result = await mutate(() =>
        apiJson('/api/guild/billets/' + encodeURIComponent(billetId), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: editName,
            responsibility: editResponsibility,
          }),
        }),
      )

      if (!result) return

      onChanged?.((current) =>
        current
          .map((billet) =>
            billet.id === result.billet.id ? result.billet : billet,
          )
          .sort((left, right) =>
            left.name.localeCompare(right.name, undefined, {
              sensitivity: 'base',
            }),
          ),
      )
      setEditingId(null)
      setMessage(
        result.discordSync?.status === 'synced'
          ? 'Billet updated and Discord role synced.'
          : 'Billet updated. Discord role sync will retry automatically.',
      )
    } catch (error) {
      setMessage(
        error?.code === 'duplicate_name'
          ? 'A billet with that name already exists.'
          : 'Could not update billet.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="billet-definitions">
      <summary>Manage billets</summary>

      <div className="billet-definitions__body">
        <div className="billet-definitions__intro">
          <div>
            <span>Guild jobs</span>
            <h2>Billets</h2>
          </div>
          <p>
            Billets describe a member&apos;s current responsibility. Assignments
            are authoritative here and project to Discord roles.
          </p>
        </div>

        <div className="billet-definitions__list">
          {billets.map((billet) => (
            <article key={billet.id}>
              {editingId === billet.id ? (
                <div className="billet-definitions__edit">
                  <input
                    type="text"
                    maxLength="48"
                    value={editName}
                    aria-label="Billet name"
                    onChange={(event) => setEditName(event.target.value)}
                  />
                  <textarea
                    maxLength="600"
                    value={editResponsibility}
                    aria-label="Billet responsibility"
                    onChange={(event) =>
                      setEditResponsibility(event.target.value)
                    }
                  />
                  <div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void saveEdit(billet.id)
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <strong>{billet.name}</strong>
                    <span>
                      {billet.discordRoleId
                        ? 'Discord linked'
                        : 'Discord sync pending'}
                    </span>
                  </div>
                  <p>
                    {billet.responsibility ||
                      'No responsibility description yet.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => beginEdit(billet)}
                  >
                    Edit
                  </button>
                </>
              )}
            </article>
          ))}
        </div>

        <form
          className="billet-definitions__create"
          onSubmit={createDefinition}
        >
          <div>
            <span>New billet</span>
            <strong>Create a responsibility</strong>
          </div>

          <label>
            <span>Name</span>
            <input
              type="text"
              maxLength="48"
              value={name}
              placeholder="Recruit Lead"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label>
            <span>Responsibility</span>
            <textarea
              maxLength="600"
              value={responsibility}
              placeholder="Owns recruiting and new-member onboarding."
              onChange={(event) => setResponsibility(event.target.value)}
            />
          </label>

          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Create billet'}
          </button>
        </form>

        {message ? (
          <p className="billet-definitions__message" aria-live="polite">
            {message}
          </p>
        ) : null}
      </div>
    </details>
  )
}

export default BilletDefinitionManager
