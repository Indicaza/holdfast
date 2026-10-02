import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import PageShell from '../PageShell/PageShell.jsx'
import RankInsignia from '../Members/RankInsignia.jsx'
import PublicJoinCallout from '../PublicJoinCallout/PublicJoinCallout.jsx'
import AuthorityScopeEditor from './AuthorityScopeEditor.jsx'
import BilletCreateModal from './BilletCreateModal.jsx'
import './Ranks.css'

const RANK_ORDER = [
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

const rankDefinitions = [
  {
    name: 'Recruit',
    group: 'Joining',
    marker: 'Starting point',
    description: 'A new member learning the guild and finding their place.',
  },
  {
    name: 'Private',
    group: 'Member',
    marker: 'After onboarding',
    description: 'A full member in good standing. No leadership expected.',
  },
  {
    name: 'Corporal',
    group: 'Member',
    marker: '3,000 Rep floor',
    description:
      'The first level of earned trust. Leadership is optional; this can be a permanent rank.',
  },
  {
    name: 'Sergeant',
    group: 'Leadership',
    marker: '9,000 Rep floor',
    description: 'A proven small-group leader and mentor.',
  },
  {
    name: 'Master Sergeant',
    group: 'Leadership',
    marker: '21,000 Rep floor',
    description:
      'An experienced leader who develops others and keeps recurring work moving.',
  },
  {
    name: 'Sergeant Major',
    group: 'Senior leadership',
    marker: '42,000 Rep floor',
    description:
      'The senior enlisted leader, focused on mentorship, continuity, and judgment.',
  },
  {
    name: 'Lieutenant',
    group: 'Officer',
    marker: 'Appointment',
    description:
      'The first officer rank, appointed when Holdfast needs broader leadership.',
  },
  {
    name: 'Captain',
    group: 'Officer',
    marker: 'Appointment',
    description:
      'An experienced officer trusted with major programs or recurring operations.',
  },
  {
    name: 'Major',
    group: 'Officer',
    marker: 'Appointment',
    description:
      'A senior officer trusted with broad responsibility and cross-guild coordination.',
  },
  {
    name: 'Commander',
    group: 'Guildmaster',
    marker: 'Unique rank',
    description:
      'The guildmaster, responsible for direction and continuity while delegating day-to-day work.',
  },
]

const billetDefinitions = [
  {
    name: 'Steward',
    description: 'Deputy to the Commander and continuity during an absence.',
  },
  {
    name: 'Quartermaster',
    description: 'Guild bank, crafting, professions, materials, and economy.',
  },
  {
    name: 'Raid Leader',
    description: 'Raid schedules, rosters, preparation, and calls.',
  },
  {
    name: 'PvP Lead',
    description: 'Premades, response groups, PvP events, and training.',
  },
]

const systemDefinitions = [
  {
    label: 'Rep',
    description: 'Permanent record of useful guild contribution. It only goes up.',
  },
  {
    label: 'Rank',
    description: 'Trust earned over time. Rep can qualify you; it cannot buy authority.',
  },
  {
    label: 'Billet',
    description: 'A current guild job. Jobs rotate as people step forward or take breaks.',
  },
  {
    label: 'Marks',
    description: 'Spendable rewards used to ask something back from the guild.',
  },
]

function rankOrder(rank) {
  return RANK_ORDER.indexOf(rank)
}

function scopeWithinActor(scope, authority) {
  if (authority?.isOwner) return true

  const actorPermissions = new Set(authority?.permissions || [])

  if (
    (scope?.permissions || []).some(
      (permission) => !actorPermissions.has(permission),
    )
  ) {
    return false
  }

  const grantsMemberManagement = (scope?.permissions || []).some(
    (permission) => MEMBER_MANAGEMENT_PERMISSIONS.has(permission),
  )

  if (!grantsMemberManagement || !scope?.maxManagedRank) return true
  if (!authority?.maxManagedRank) return false

  return (
    rankOrder(scope.maxManagedRank) <= rankOrder(authority.maxManagedRank)
  )
}

function canEditScope(type, scope, session) {
  if (!scope || !session.hasPermission('authority.manage')) return false
  if (session.authority?.isOwner) return true
  if (!scopeWithinActor(scope, session.authority)) return false

  if (type === 'rank') {
    return (
      rankOrder(scope.rank) >= 0 &&
      rankOrder(scope.rank) < rankOrder(session.authority?.memberRank)
    )
  }

  return true
}

function authoritySummary(scope) {
  if (!scope) return null

  const permissionCount = Array.isArray(scope.permissions)
    ? scope.permissions.length
    : 0
  const permissionLabel =
    permissionCount === 1 ? '1 permission' : `${permissionCount} permissions`
  const grantsMemberManagement = (scope.permissions || []).some(
    (permission) => MEMBER_MANAGEMENT_PERMISSIONS.has(permission),
  )
  const ceiling =
    grantsMemberManagement && scope.maxManagedRank
      ? `manage through ${scope.maxManagedRank}`
      : 'no member management'

  return `${permissionLabel} · ${ceiling}`
}

function interactiveCardProps(editable, onEdit, label) {
  if (!editable) return {}

  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': `Edit authority for ${label}`,
    onClick: onEdit,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onEdit()
      }
    },
  }
}

function Ranks() {
  const session = useSession()
  const [catalog, setCatalog] = useState(null)
  const [catalogStatus, setCatalogStatus] = useState('idle')
  const [editing, setEditing] = useState(null)
  const [creatingBillet, setCreatingBillet] = useState(false)
  const canManageAuthority = session.hasPermission('authority.manage')
  const canCreateBillets = session.hasPermission('billets.create')
  const canEditBillets = session.hasPermission('billets.edit')
  const canDeleteBillets = session.hasPermission('billets.delete')
  const canManageBilletDefinitions =
    canCreateBillets || canEditBillets || canDeleteBillets

  useEffect(() => {
    if (!session.authenticated) {
      setCatalog(null)
      setCatalogStatus('idle')
      setEditing(null)
      setCreatingBillet(false)
      return undefined
    }

    const controller = new AbortController()
    let active = true

    async function loadAuthority() {
      setCatalogStatus('loading')

      try {
        const result = await apiJson('/api/guild/authority', {
          signal: controller.signal,
        })

        if (!active) return
        setCatalog(result)
        setCatalogStatus('ready')
      } catch (error) {
        if (!active || error?.name === 'AbortError') return
        setCatalogStatus('error')
      }
    }

    void loadAuthority()

    return () => {
      active = false
      controller.abort()
    }
  }, [session.authenticated])

  const rankScopes = useMemo(
    () =>
      new Map(
        (catalog?.ranks || []).map((scope) => [scope.rank, scope]),
      ),
    [catalog],
  )

  const billetScopes = useMemo(
    () =>
      new Map(
        (catalog?.billets || []).map((scope) => [scope.name, scope]),
      ),
    [catalog],
  )

  const visibleBillets = useMemo(() => {
    if (!catalog?.billets?.length) {
      return billetDefinitions
    }

    const staticByName = new Map(
      billetDefinitions.map((billet) => [billet.name, billet]),
    )

    return catalog.billets.map((scope) => ({
      name: scope.name,
      description:
        scope.responsibility ||
        staticByName.get(scope.name)?.description ||
        'A delegated Holdfast responsibility.',
    }))
  }, [catalog])

  function openScope(type, scope) {
    if (!scope) return

    if (type === 'rank') {
      if (!canEditScope(type, scope, session)) return
    } else {
      const canEditAuthority = canEditScope(type, scope, session)
      const canDeleteWithinScope =
        canDeleteBillets && scopeWithinActor(scope, session.authority)
      const canOpen =
        canEditAuthority || canEditBillets || canDeleteWithinScope

      if (!canOpen) return
    }

    setEditing({ type, scope })
  }

  function updateScope(type, updatedScope) {
    setCatalog((current) => {
      if (!current) return current

      const key = type === 'rank' ? 'ranks' : 'billets'
      const idKey = type === 'rank' ? 'rank' : 'id'

      return {
        ...current,
        [key]: current[key].map((scope) =>
          scope[idKey] === updatedScope[idKey]
            ? { ...scope, ...updatedScope }
            : scope,
        ),
      }
    })
    setEditing(null)
  }

  function updateBilletDefinition(updatedBillet) {
    setCatalog((current) => {
      if (!current) return current

      return {
        ...current,
        billets: current.billets.map((billet) =>
          billet.id === updatedBillet.id
            ? { ...billet, ...updatedBillet }
            : billet,
        ),
      }
    })

    setEditing((current) =>
      current?.type === 'billet' && current.scope.id === updatedBillet.id
        ? {
            ...current,
            scope: { ...current.scope, ...updatedBillet },
          }
        : current,
    )
  }

  function removeBilletDefinition(billetId) {
    setCatalog((current) => {
      if (!current) return current

      return {
        ...current,
        billets: current.billets.filter((billet) => billet.id !== billetId),
      }
    })
    setEditing(null)
  }

  function addBillet(createdBillet) {
    setCatalog((current) => {
      if (!current) return current

      const billets = [...current.billets, createdBillet].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: 'base',
        }),
      )

      return {
        ...current,
        billets,
      }
    })
    setCreatingBillet(false)
  }

  return (
    <PageShell
      title="Ranks & Roles"
      intro="Contribution earns Rep. Trust earns rank. Roles rotate with the work."
    >
      <article className="ranks-page">
        <section className="ranks-page__system" aria-label="How Holdfast works">
          <div className="ranks-page__system-grid">
            {systemDefinitions.map((item) => (
              <article className="ranks-page__system-card" key={item.label}>
                <span className="ranks-page__label">{item.label}</span>
                <p>{item.description}</p>
              </article>
            ))}
          </div>

          <p className="ranks-page__promotion-line">
            <strong>Rep creates eligibility.</strong> Trust, leadership,
            recommendation, and guild need decide promotion. Officers are
            appointed separately.
          </p>
        </section>

        <section className="ranks-page__section ranks-page__section--ranks">
          <header className="ranks-page__major-heading">
            <h2>Ranks</h2>
            {canManageAuthority ? (
              <p className="ranks-page__authority-hint">
                Authority controls enabled. Select an editable rank to change
                its baseline permissions.
              </p>
            ) : null}
          </header>

          <div className="ranks-page__rank-grid">
            {rankDefinitions.map((rank) => {
              const scope = rankScopes.get(rank.name)
              const editable = canEditScope('rank', scope, session)
              const protectedScope =
                canManageAuthority &&
                catalogStatus === 'ready' &&
                scope &&
                !editable

              return (
                <article
                  className={
                    editable
                      ? 'ranks-page__rank-card ranks-page__rank-card--editable'
                      : 'ranks-page__rank-card'
                  }
                  key={rank.name}
                  {...interactiveCardProps(
                    editable,
                    () => openScope('rank', scope),
                    rank.name,
                  )}
                >
                  <div className="ranks-page__rank-insignia">
                    <RankInsignia rank={rank.name} />
                  </div>
                  <div className="ranks-page__rank-copy">
                    <div className="ranks-page__card-kicker">
                      <span className="ranks-page__rank-group">{rank.group}</span>
                      {editable ? (
                        <span className="ranks-page__edit-affordance">
                          Edit authority
                        </span>
                      ) : protectedScope ? (
                        <span className="ranks-page__protected">Protected</span>
                      ) : null}
                    </div>
                    <h3>{rank.name}</h3>
                    <span className="ranks-page__rank-marker">{rank.marker}</span>
                    <p>{rank.description}</p>
                    {canManageAuthority && scope ? (
                      <small className="ranks-page__authority-summary">
                        {authoritySummary(scope)}
                      </small>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="ranks-page__section ranks-page__section--billets">
          <header className="ranks-page__major-heading ranks-page__major-heading--with-action">
            <div>
              <h2>Billets</h2>
              {canManageAuthority || canManageBilletDefinitions ? (
                <p className="ranks-page__authority-hint">
                  Select a manageable billet to edit its job, authority, or lifecycle.
                </p>
              ) : null}
            </div>

            {canCreateBillets ? (
              <button
                className="ranks-page__create-billet"
                type="button"
                disabled={catalogStatus !== 'ready'}
                onClick={() => setCreatingBillet(true)}
              >
                <span aria-hidden="true">＋</span>
                Create billet
              </button>
            ) : null}
          </header>

          {canManageAuthority && catalogStatus === 'error' ? (
            <p className="ranks-page__authority-error">
              Authority controls could not be loaded. The public rank and billet
              information is still available.
            </p>
          ) : null}

          <div className="ranks-page__billet-grid">
            {visibleBillets.map((billet) => {
              const scope = billetScopes.get(billet.name)
              const authorityEditable = canEditScope('billet', scope, session)
              const deleteWithinScope =
                Boolean(scope) &&
                !scope.discordManaged &&
                canDeleteBillets &&
                scopeWithinActor(scope, session.authority)
              const editable =
                Boolean(scope) &&
                (authorityEditable || canEditBillets || deleteWithinScope)
              const protectedScope =
                (canManageAuthority || canManageBilletDefinitions) &&
                catalogStatus === 'ready' &&
                scope &&
                !editable

              return (
                <article
                  className={
                    editable
                      ? 'ranks-page__billet-card ranks-page__billet-card--editable'
                      : 'ranks-page__billet-card'
                  }
                  key={billet.name}
                  {...interactiveCardProps(
                    editable,
                    () => openScope('billet', scope),
                    billet.name,
                  )}
                >
                  <div className="ranks-page__card-kicker">
                    <span className="ranks-page__rank-group">Billet</span>
                    {editable ? (
                      <span className="ranks-page__edit-affordance">
                        Manage billet
                      </span>
                    ) : protectedScope ? (
                      <span className="ranks-page__protected">Protected</span>
                    ) : null}
                  </div>
                  <h3>{billet.name}</h3>
                  <p>{billet.description}</p>
                  {canManageAuthority && scope ? (
                    <small className="ranks-page__authority-summary">
                      {authoritySummary(scope)}
                    </small>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>

        <PublicJoinCallout
          title="You do not need a rank to belong here."
          description="Join Holdfast, play at your own pace, and contribute in whatever way fits you."
        />
      </article>

      {creatingBillet ? (
        <BilletCreateModal
          onCreated={addBillet}
          onClose={() => setCreatingBillet(false)}
        />
      ) : null}

      {editing && catalog ? (
        <AuthorityScopeEditor
          key={`${editing.type}:${
            editing.type === 'rank' ? editing.scope.rank : editing.scope.id
          }`}
          type={editing.type}
          scope={editing.scope}
          capabilities={catalog.capabilities}
          actorAuthority={session.authority}
          onSaved={updateScope}
          onBilletUpdated={updateBilletDefinition}
          onBilletDeleted={removeBilletDefinition}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </PageShell>
  )
}

export default Ranks
