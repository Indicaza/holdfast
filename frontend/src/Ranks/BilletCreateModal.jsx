import { useState } from 'react'
import Modal from '../Modal/Modal.jsx'
import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { useSession } from '../Auth/sessionContext.js'
import './BilletCreateModal.css'

function BilletCreateModal({ onCreated, onClose }) {
  const session = useSession()
  const [name, setName] = useState('')
  const [responsibility, setResponsibility] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const valid = name.trim().length >= 2

  async function createBillet(event) {
    event.preventDefault()

    if (busy || !valid) return

    setBusy(true)
    setMessage('')

    try {
      const result = await runAuthenticatedMutation({
        request: () =>
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
        refresh: session.refresh,
        reauthenticate: () =>
          session.signIn(
            window.location.pathname + window.location.search + window.location.hash,
          ),
      })

      if (!result?.billet) return

      onCreated?.(result.billet)
    } catch (error) {
      if (error?.code === 'duplicate_name') {
        setMessage('A billet with that name already exists.')
      } else if (error?.code === 'reserved_name') {
        setMessage('Rank names are reserved and cannot be used as billets.')
      } else if (error?.code === 'invalid_name') {
        setMessage('Billet names must be between 2 and 48 characters.')
      } else if (error?.code === 'invalid_responsibility') {
        setMessage('Responsibility descriptions must be 600 characters or fewer.')
      } else {
        setMessage('Could not create billet. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      eyebrow="New billet"
      title="Create a responsibility"
      intro="Billets are jobs, not rank. Give the billet a clear name and responsibility; authority can be configured from its card after creation."
      size="wide"
      align="left"
      onClose={busy ? undefined : onClose}
    >
      <form className="billet-create" onSubmit={createBillet}>
        <label className="billet-create__field">
          <span>Name</span>
          <input
            autoFocus
            type="text"
            maxLength="48"
            value={name}
            placeholder="Recruit Lead"
            onChange={(event) => {
              setName(event.target.value)
              setMessage('')
            }}
          />
          <small>
            Short and recognizable. This also becomes the Holdfast Discord role.
          </small>
        </label>

        <label className="billet-create__field">
          <span>Responsibility</span>
          <textarea
            maxLength="600"
            value={responsibility}
            placeholder="Owns recruiting and helps new members get settled."
            onChange={(event) => {
              setResponsibility(event.target.value)
              setMessage('')
            }}
          />
          <small>
            Describe the job, not the person. Permissions are configured
            separately.
          </small>
        </label>

        <aside className="billet-create__note">
          <span>After creation</span>
          <p>
            The billet will appear in the grid immediately. Select its card to
            configure authority, then assign it from a member profile.
          </p>
        </aside>

        <footer className="billet-create__actions">
          <div>
            {message ? (
              <span className="billet-create__message" aria-live="polite">
                {message}
              </span>
            ) : (
              <span>
                {responsibility.length}/600
              </span>
            )}
          </div>

          <button
            className="billet-create__cancel"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="billet-create__submit"
            type="submit"
            disabled={busy || !valid}
          >
            {busy ? 'Creating…' : 'Create billet'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

export default BilletCreateModal
