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

const QUEST_SCOPED_PERMISSIONS = new Set([
  'quests.create',
  'quests.edit',
  'quests.publish',
  'rewards.approve',
  'rewards.issue',
])

const REWARD_PERMISSIONS = new Set([
  'rewards.approve',
  'rewards.issue',
])

const EMPTY_REWARD_LIMITS = {
  repPerObjective: 0,
  marksPerObjective: 0,
  marksPerQuest: 0,
}

function rankOrder(rank) {
  return RANKS.indexOf(rank)
}

function samePermissions(left, right) {
  const a = [...(left || [])].sort()
  const b = [...(right || [])].sort()

  return a.length === b.length && a.every((value, index) => value === b[index])
}

function AuthorityScopeEditor({
  type,
  scope,
  capabilities,
  actorAuthority,
  economyPolicy,
  authorityEditable,
  onSaved,
  onBilletUpdated,
  onBilletDeleted,
  onClose,
}) {
  const session = useSession()
  const [permissions, setPermissions] = useState(scope.permissions || [])
  const [maxManagedRank, setMaxManagedRank] = useState(
    scope.maxManagedRank || '',
  )
  const [questScope, setQuestScope] = useState(scope.questScope || 'own')
  const [rewardLimits, setRewardLimits] = useState({
    ...EMPTY_REWARD_LIMITS,
    ...(scope.rewardLimits || {}),
  })
  const [billetName, setBilletName] = useState(scope.name || '')
  const [responsibility, setResponsibility] = useState(
    scope.responsibility || '',
  )
  const [authorityBusy, setAuthorityBusy] = useState(false)
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [message, setMessage] = useState('')
  const [detailsMessage, setDetailsMessage] = useState('')
  const [deleteMessage, setDeleteMessage] = useState('')

  const canEditAuthority =
    session.hasPermission('authority.manage') && Boolean(authorityEditable)
  const canEditDetails =
    type === 'billet' && session.hasPermission('billets.edit')
  const canDeleteBillet =
    type === 'billet' &&
    session.hasPermission('billets.delete') &&
    !scope.discordManaged

  const busy = authorityBusy || detailsBusy || deleteBusy

  const actorPermissions = useMemo(
    () => new Set(actorAuthority?.permissions || []),
    [actorAuthority?.permissions],
  )

  const hasMemberManagement = permissions.some((permission) =>
    MEMBER_MANAGEMENT_PERMISSIONS.has(permission),
  )
  const scopedPermissions = permissions.filter((permission) =>
    QUEST_SCOPED_PERMISSIONS.has(permission),
  )
  const rewardPermissions = permissions.filter((permission) =>
    REWARD_PERMISSIONS.has(permission),
  )
  const hasQuestAuthority = scopedPermissions.length > 0
  const hasRewardAuthority = rewardPermissions.length > 0
  const effectiveCeiling = hasMemberManagement ? maxManagedRank : ''
  const effectiveQuestScope = hasQuestAuthority ? questScope : 'own'
  const effectiveRewardLimits = hasRewardAuthority
    ? rewardLimits
    : EMPTY_REWARD_LIMITS
  const authorityDirty =
    !samePermissions(permissions, scope.permissions) ||
    effectiveCeiling !== (scope.maxManagedRank || '') ||
    effectiveQuestScope !== (scope.questScope || 'own') ||
    JSON.stringify(effectiveRewardLimits) !==
      JSON.stringify({ ...EMPTY_REWARD_LIMITS, ...(scope.rewardLimits || {}) })
  const detailsDirty =
    type === 'billet' &&
    (billetName.trim() !== (scope.name || '') ||
      responsibility.trim() !== (scope.responsibility || ''))

  const actorCeiling = actorAuthority?.isOwner
    ? 'Commander'
    : actorAuthority?.maxManagedRank
  const actorCeilingOrder = rankOrder(actorCeiling)

  const canUseAllQuestScope =
    actorAuthority?.isOwner ||
    scopedPermissions.every(
      (permission) => actorAuthority?.questScopes?.[permission] === 'all',
    )

  const actorRewardCeiling = rewardPermissions.reduce(
    (current, permission) => {
      const bucket =
        permission === 'rewards.approve'
          ? actorAuthority?.rewardLimits?.approve
          : actorAuthority?.rewardLimits?.issue

      if (!bucket) return current
      if (!current) return { ...bucket }

      return {
        repPerObjective: Math.min(
          current.repPerObjective,
          bucket.repPerObjective,
        ),
        marksPerObjective: Math.min(
          current.marksPerObjective,
          bucket.marksPerObjective,
        ),
        marksPerQuest: Math.min(
          current.marksPerQuest,
          bucket.marksPerQuest,
        ),
      }
    },
    null,
  ) || EMPTY_REWARD_LIMITS

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

  async function authenticatedMutation(request) {
    return runAuthenticatedMutation({
      request,
      refresh: session.refresh,
      reauthenticate: () =>
        session.signIn(
          window.location.pathname + window.location.search + window.location.hash,
        ),
    })
  }

  async function saveAuthority() {
    if (busy || !authorityDirty || !canEditAuthority) return

    setAuthorityBusy(true)
    setMessage('')

    try {
      const endpoint =
        type === 'rank'
          ? '/api/guild/authority/ranks/' + encodeURIComponent(scope.rank)
          : '/api/guild/authority/billets/' + encodeURIComponent(scope.id)

      const result = await authenticatedMutation(() =>
        apiJson(endpoint, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            permissions,
            maxManagedRank: effectiveCeiling || null,
            questScope: effectiveQuestScope,
            rewardLimits: effectiveRewardLimits,
          }),
        }),
      )

      if (!result) return

      await session.refresh()
      onSaved?.(type, result.scope)
    } catch (error) {
      if (error?.code === 'scope_above_actor') {
        setMessage('That would grant authority above your own.')
      } else if (error?.code === 'invalid_rank_ceiling') {
        setMessage('Choose a valid member-management ceiling.')
      } else if (error?.code === 'ceiling_requires_member_management') {
        setMessage(
          'Enable Promote & demote or Assign billets before setting a ceiling.',
        )
      } else if (error?.code === 'invalid_quest_scope') {
        setMessage('Choose a valid quest scope.')
      } else if (error?.code === 'invalid_reward_limits') {
        setMessage('Reward limits must be non-negative whole numbers.')
      } else {
        setMessage('Could not save authority. Try again.')
      }
    } finally {
      setAuthorityBusy(false)
    }
  }

  async function saveBilletDetails() {
    if (busy || !detailsDirty || !canEditDetails) return

    setDetailsBusy(true)
    setDetailsMessage('')

    try {
      const result = await authenticatedMutation(() =>
        apiJson('/api/guild/billets/' + encodeURIComponent(scope.id), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: billetName,
            responsibility,
          }),
        }),
      )

      if (!result?.billet) return

      setBilletName(result.billet.name)
      setResponsibility(result.billet.responsibility || '')
      onBilletUpdated?.(result.billet)
      setDetailsMessage(
        result.discordSync?.status === 'synced'
          ? 'Details saved and Discord synced.'
          : 'Details saved. Discord sync will retry automatically.',
      )
    } catch (error) {
      if (error?.code === 'duplicate_name') {
        setDetailsMessage('A billet with that name already exists.')
      } else if (error?.code === 'reserved_name') {
        setDetailsMessage('Rank names are reserved and cannot be used as billets.')
      } else if (error?.code === 'name_locked') {
        setDetailsMessage('This infrastructure billet name is protected.')
      } else {
        setDetailsMessage('Could not save billet details.')
      }
    } finally {
      setDetailsBusy(false)
    }
  }

  async function deleteBillet() {
    if (busy || !canDeleteBillet || !confirmDelete) return

    setDeleteBusy(true)
    setDeleteMessage('')

    try {
      const result = await authenticatedMutation(() =>
        apiJson('/api/guild/billets/' + encodeURIComponent(scope.id), {
          method: 'DELETE',
        }),
      )

      if (!result) return

      onBilletDeleted?.(scope.id)
    } catch (error) {
      if (error?.code === 'protected') {
        setDeleteMessage('Infrastructure billets cannot be deleted.')
      } else if (error?.code === 'authority_scope_exceeded') {
        setDeleteMessage('This billet is above your authority.')
      } else if (error?.code === 'discord_billet_delete_failed') {
        setDeleteMessage('Discord could not remove the billet role. Nothing was deleted.')
      } else {
        setDeleteMessage('Could not delete billet.')
      }
    } finally {
      setDeleteBusy(false)
    }
  }

  const selectedCount = permissions.length
  const title = type === 'rank' ? scope.rank : billetName || scope.name
  const intro =
    type === 'rank'
      ? 'Rank authority is the baseline every member of this rank receives. Billets add to it; they never replace it.'
      : 'Billets describe a job and may add job-specific authority on top of rank.'

  return (
    <Modal
      eyebrow={type === 'rank' ? 'Rank authority' : 'Billet'}
      title={title}
      intro={intro}
      size="wide"
      align="left"
      onClose={busy ? undefined : onClose}
    >
      <div className="authority-editor">
        {type === 'billet' && canEditDetails ? (
          <section className="authority-editor__section authority-editor__details">
            <header className="authority-editor__section-heading">
              <div>
                <span>Billet details</span>
                <h2>Name &amp; responsibility</h2>
              </div>
            </header>

            <div className="authority-editor__detail-fields">
              <label>
                <span>Name</span>
                <input
                  type="text"
                  maxLength="48"
                  value={billetName}
                  disabled={busy || scope.discordManaged}
                  onChange={(event) => {
                    setBilletName(event.target.value)
                    setDetailsMessage('')
                  }}
                />
                {scope.discordManaged ? (
                  <small>
                    This name is used by Holdfast Discord infrastructure and is
                    protected.
                  </small>
                ) : null}
              </label>

              <label>
                <span>Responsibility</span>
                <textarea
                  maxLength="600"
                  value={responsibility}
                  disabled={busy}
                  onChange={(event) => {
                    setResponsibility(event.target.value)
                    setDetailsMessage('')
                  }}
                />
              </label>
            </div>

            <div className="authority-editor__inline-actions">
              <span aria-live="polite">
                {detailsMessage ||
                  (detailsDirty ? 'Unsaved detail changes' : 'Details up to date')}
              </span>
              <button
                type="button"
                disabled={busy || !detailsDirty || billetName.trim().length < 2}
                onClick={() => void saveBilletDetails()}
              >
                {detailsBusy ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </section>
        ) : type === 'billet' && scope.responsibility ? (
          <div className="authority-editor__responsibility">
            <span>Responsibility</span>
            <p>{scope.responsibility}</p>
          </div>
        ) : null}

        {canEditAuthority ? (
          <>
            <aside className="authority-editor__rule">
              <span>How stacking works</span>
              <strong>Permissions are additive.</strong>
              <p>
                Holdfast combines every permission granted by the member&apos;s
                rank and billets. For member management, the highest available
                ceiling wins.
              </p>
            </aside>

            <section className="authority-editor__section">
              <header className="authority-editor__section-heading">
                <div>
                  <span>Capabilities</span>
                  <h2>What this {type} can do</h2>
                </div>
                <strong>
                  {selectedCount}{' '}
                  {selectedCount === 1 ? 'permission' : 'permissions'}
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
                            <b className="authority-editor__reserved">
                              Reserved
                            </b>
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

            {hasQuestAuthority ? (
              <section className="authority-editor__section authority-editor__quest-scope">
                <div className="authority-editor__section-heading">
                  <div>
                    <span>Quest scope</span>
                    <h2>Whose quests can this authority touch?</h2>
                  </div>
                </div>

                <div className="authority-editor__scope-options">
                  <button
                    type="button"
                    className={
                      effectiveQuestScope === 'own'
                        ? 'authority-editor__scope-option authority-editor__scope-option--active'
                        : 'authority-editor__scope-option'
                    }
                    disabled={busy}
                    onClick={() => {
                      setQuestScope('own')
                      setMessage('')
                    }}
                  >
                    <strong>Own</strong>
                    <span>Only quests created by this member.</span>
                  </button>
                  <button
                    type="button"
                    className={
                      effectiveQuestScope === 'all'
                        ? 'authority-editor__scope-option authority-editor__scope-option--active'
                        : 'authority-editor__scope-option'
                    }
                    disabled={busy || !canUseAllQuestScope}
                    onClick={() => {
                      setQuestScope('all')
                      setMessage('')
                    }}
                  >
                    <strong>All</strong>
                    <span>Any Holdfast quest.</span>
                  </button>
                </div>

                {!canUseAllQuestScope ? (
                  <small className="authority-editor__ceiling-note">
                    All scope is above your own quest authority.
                  </small>
                ) : null}
              </section>
            ) : null}

            {hasRewardAuthority ? (
              <section className="authority-editor__section authority-editor__reward-scope">
                <div className="authority-editor__section-heading">
                  <div>
                    <span>Reward bracket</span>
                    <h2>How much economy authority?</h2>
                  </div>
                </div>

                <p className="authority-editor__help">
                  These limits apply to reward approval and/or issuance granted
                  by this scope. Rank and billet brackets stack upward, but can
                  never exceed the guild-wide guardrails.
                </p>

                <div className="authority-editor__reward-limits">
                  {[
                    [
                      'repPerObjective',
                      'Rep / objective',
                      actorRewardCeiling.repPerObjective,
                    ],
                    [
                      'marksPerObjective',
                      'Marks / objective',
                      actorRewardCeiling.marksPerObjective,
                    ],
                    [
                      'marksPerQuest',
                      'Marks / quest',
                      actorRewardCeiling.marksPerQuest,
                    ],
                  ].map(([key, label, max]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input
                        type="number"
                        min="0"
                        max={max}
                        step="1"
                        value={effectiveRewardLimits[key]}
                        disabled={busy}
                        onChange={(event) => {
                          const value = Math.max(
                            0,
                            Math.min(
                              Number(max) || 0,
                              Number(event.target.value) || 0,
                            ),
                          )
                          setRewardLimits((current) => ({
                            ...current,
                            [key]: value,
                          }))
                          setMessage('')
                        }}
                      />
                      <small>
                        Max {max}
                        {economyPolicy?.[key] !== undefined
                          ? ` · guild cap ${economyPolicy[key]}`
                          : ''}
                      </small>
                    </label>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="authority-editor__section authority-editor__section--ceiling">
              <div className="authority-editor__section-heading">
                <div>
                  <span>Delegation boundary</span>
                  <h2>Member-management ceiling</h2>
                </div>
              </div>

              <p className="authority-editor__help">
                This only matters when this scope grants Promote &amp; demote or
                Assign billets. It is the highest-ranked member this authority
                can modify.
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
                  <span
                    className="authority-editor__message"
                    aria-live="polite"
                  >
                    {message}
                  </span>
                ) : authorityDirty ? (
                  <span>Unsaved authority changes</span>
                ) : (
                  <span>Authority up to date</span>
                )}
              </div>

              <button
                className="authority-editor__cancel"
                type="button"
                disabled={busy}
                onClick={onClose}
              >
                Close
              </button>
              <button
                className="authority-editor__save"
                type="button"
                disabled={busy || !authorityDirty}
                onClick={() => void saveAuthority()}
              >
                {authorityBusy ? 'Saving…' : 'Save authority'}
              </button>
            </footer>
          </>
        ) : null}

        {type === 'billet' && session.hasPermission('billets.delete') ? (
          <section className="authority-editor__danger">
            <div>
              <span>Danger zone</span>
              <strong>
                {scope.discordManaged
                  ? 'Infrastructure billet'
                  : 'Delete this billet'}
              </strong>
              <p>
                {scope.discordManaged
                  ? 'This billet is used by Holdfast Discord infrastructure and cannot be deleted.'
                  : 'Deletion removes the billet from every member and deletes its Holdfast Discord role.'}
              </p>
            </div>

            {!scope.discordManaged ? (
              confirmDelete ? (
                <div className="authority-editor__delete-confirm">
                  <span>This cannot be undone.</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteBillet()}
                  >
                    {deleteBusy ? 'Deleting…' : `Delete ${billetName}`}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep billet
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy || !canDeleteBillet}
                  onClick={() => {
                    setConfirmDelete(true)
                    setDeleteMessage('')
                  }}
                >
                  Delete billet
                </button>
              )
            ) : null}

            {deleteMessage ? (
              <small className="authority-editor__danger-message" aria-live="polite">
                {deleteMessage}
              </small>
            ) : null}
          </section>
        ) : null}
      </div>
    </Modal>
  )
}

export default AuthorityScopeEditor
