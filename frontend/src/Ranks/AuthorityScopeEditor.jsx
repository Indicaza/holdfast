import { useMemo, useState } from 'react'
import Modal from '../Modal/Modal.jsx'
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

const MEMBER_MANAGEMENT_PERMISSIONS = new Set([
  'members.rank.manage',
  'members.billet.assign',
])

function rankOrder(rank) {
  return RANKS.indexOf(rank)
}

function samePermissions(left, right) {
  const a = [...(left || [])].sort()
  const b = [...(right || [])].sort()

  return a.length === b.length && a.every((value, index) => value === b[index])
}

function scopeName(type, scope) {
  return type === 'rank' ? scope.rank : scope.name
}

function AuthorityScopeEditor({
  type,
  scope,
  capabilities,
  actorAuthority,
  onSaved,
  onClose,
}) {
  const session = useSession()
  const [permissions, setPermissions] = useState(scope.permissions || [])
  const [maxManagedRank, setMaxManagedRank] = useState(
    scope.maxManagedRank || '',
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const actorPermissions = useMemo(
    () => new Set(actorAuthority?.permissions || []),
    [actorAuthority?.permissions],
  )

  const hasMemberManagement = permissions.some((permission) =>
    MEMBER_MANAGEMENT_PERMISSIONS.has(permission),
  )
  const effectiveCeiling = hasMemberManagement ? maxManagedRank : ''
  const dirty =
    !samePermissions(permissions, scope.permissions) ||
    effectiveCeiling !== (scope.maxManagedRank || '')

  const actorCeiling = actorAuthority?.isOwner
    ? 'Commander'
    : actorAuthority?.maxManagedRank
  const actorCeilingOrder = rankOrder(actorCeiling)

  function canGrant(permission) {
    return actorAuthority?.isOwner || actorPermissions.has(permission)
  }

  function togglePermission(permission) {
    if (!canGrant(permission) || busy) return

    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission],
    )
    setMessage('')
  }

  async function save() {
    if (busy || !dirty) return

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
              maxManagedRank: effectiveCeiling || null,
            }),
          }),
        refresh: session.refresh,
        reauthenticate: () =>
          session.signIn(
            window.location.pathname + window.location.search + window.location.hash,
          ),
      })

      if (!result) return

      await session.refresh()
      onSaved?.(type, result.scope)
    } catch (error) {
      if (error?.code === 'scope_above_actor') {
        setMessage('That would grant authority above your own.')
      } else if (error?.code === 'invalid_rank_ceiling') {
        setMessage('Choose a valid member-management ceiling.')
      } else if (error?.code === 'ceiling_requires_member_management') {
        setMessage('Enable Promote & demote or Assign billets before setting a ceiling.')
      } else {
        setMessage('Could not save authority. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = permissions.length
  const title = scopeName(type, scope)
  const intro =
    type === 'rank'
      ? 'Rank authority is the baseline every member of this rank receives. Billets add to it; they never replace it.'
      : 'Billet authority stacks on top of the member’s rank. Removing a permission here never removes the same permission if their rank or another billet still grants it.'

  return (
    <Modal
      eyebrow={type === 'rank' ? 'Rank authority' : 'Billet authority'}
      title={title}
      intro={intro}
      size="wide"
      align="left"
      onClose={busy ? undefined : onClose}
    >
      <div className="authority-editor">
        <aside className="authority-editor__rule">
          <span>How stacking works</span>
          <strong>Permissions are additive.</strong>
          <p>
            Holdfast combines every permission granted by the member&apos;s rank
            and billets. For member management, the highest available ceiling
            wins.
          </p>
        </aside>

        {type === 'billet' && scope.responsibility ? (
          <div className="authority-editor__responsibility">
            <span>Responsibility</span>
            <p>{scope.responsibility}</p>
          </div>
        ) : null}

        <section className="authority-editor__section">
          <header className="authority-editor__section-heading">
            <div>
              <span>Capabilities</span>
              <h2>What this {type} can do</h2>
            </div>
            <strong>
              {selectedCount} {selectedCount === 1 ? 'permission' : 'permissions'}
            </strong>
          </header>

          <div className="authority-editor__permissions">
            {capabilities.map((capability) => {
              const grantable = canGrant(capability.id)
              const checked = permissions.includes(capability.id)

              return (
                <label
                  key={capability.id}
                  className={
                    grantable
                      ? 'authority-editor__permission'
                      : 'authority-editor__permission authority-editor__permission--locked'
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy || !grantable}
                    onChange={() => togglePermission(capability.id)}
                  />
                  <span>
                    <strong>
                      {capability.label}
                      {capability.status === 'reserved' ? (
                        <b className="authority-editor__reserved">Reserved</b>
                      ) : null}
                    </strong>
                    <small>{capability.description}</small>
                  </span>
                  {!grantable ? <em>Above your authority</em> : null}
                </label>
              )
            })}
          </div>
        </section>

        <section className="authority-editor__section authority-editor__section--ceiling">
          <div className="authority-editor__section-heading">
            <div>
              <span>Delegation boundary</span>
              <h2>Member-management ceiling</h2>
            </div>
          </div>

          <p className="authority-editor__help">
            This only matters when this scope grants Promote &amp; demote or
            Assign billets. It is the highest-ranked member this authority can
            modify.
          </p>

          <label className="authority-editor__ceiling">
            <span>Can manage members through</span>
            <select
              value={effectiveCeiling}
              disabled={busy || !hasMemberManagement}
              onChange={(event) => {
                setMaxManagedRank(event.target.value)
                setMessage('')
              }}
            >
              <option value="">No member-management authority</option>
              {RANKS.filter(
                (rank) =>
                  actorAuthority?.isOwner ||
                  rankOrder(rank) <= actorCeilingOrder,
              ).map((rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
            </select>
          </label>

          {!hasMemberManagement ? (
            <small className="authority-editor__ceiling-note">
              Enable a member-management capability above to set a ceiling.
            </small>
          ) : null}
        </section>

        <footer className="authority-editor__actions">
          <div>
            {message ? (
              <span className="authority-editor__message" aria-live="polite">
                {message}
              </span>
            ) : dirty ? (
              <span>Unsaved changes</span>
            ) : (
              <span>No changes</span>
            )}
          </div>

          <button
            className="authority-editor__cancel"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="authority-editor__save"
            type="button"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save authority'}
          </button>
        </footer>
      </div>
    </Modal>
  )
}

export default AuthorityScopeEditor
