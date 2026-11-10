import { useMemo } from 'react'

import { classIdentity } from '../Intelligence/classIdentity.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import { navigate } from '../Navigation/navigation.js'
import {
  STATUS_LABELS,
  bossLabel,
  characterLabel,
  dungeonApiFilters,
  dungeonHref,
  endReasonLabel,
  formatCopper,
  formatOffset,
  formatRunDuration,
  readDungeonQuery,
  statusTone,
  timelineLabel,
  timelineTone,
  xpSummary,
} from './dungeonRunModel.js'
import { playerApiUrl, relativeTime } from './playerModel.js'
import { EmptyState, ErrorState, Icon, ItemLabel, Panel, SkeletonRows, Stat } from './ui.jsx'
import './PlayerDungeons.css'

const TOPICS = ['player']

function dateLabel(seconds) {
  if (!seconds) return '—'
  return new Date(seconds * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function StatusTag({ status }) {
  return <span className={`gw-tag gw-run-status gw-run-status--${statusTone(status)}`}>{STATUS_LABELS[status] || status}</span>
}

// The website only has what WoW wrote to disk: runs arrive after a /reload
// or logout, never live.
function SyncNote() {
  return (
    <div className="gw-callout" role="note">
      <div>
        <strong>Runs show up after WoW saves.</strong>
        <p>WoW writes addon data only on <kbd>/reload</kbd>, logout or <kbd>/gw sync</kbd>. A run in progress appears as “In progress” until then. Gold is your wallet change during the run (repairs and sales included), not profit.</p>
      </div>
    </div>
  )
}

function Filters({ filters, options, server }) {
  const set = (key) => (event) => navigate(dungeonHref({ filters: { ...filters, [key]: event.target.value }, server }), { preserveScroll: true })
  const on = (key) => (filters[key] ? ' is-active' : '')
  return (
    <div className="gw-filterbar" role="group" aria-label="Filter dungeon runs">
      <span className="gw-filterbar__label">Filter</span>
      <label className={`gw-filter${on('character')}`}>
        <span>Character</span>
        <select value={filters.character} onChange={set('character')}>
          <option value="">All</option>
          {options.characters.map((entry) => <option key={entry.id} value={entry.id}>{entry.name || 'Unknown character'}</option>)}
        </select>
      </label>
      {options.realms.length > 1 || filters.realm ? (
        <label className={`gw-filter${on('realm')}`}>
          <span>Realm</span>
          <select value={filters.realm} onChange={set('realm')}>
            <option value="">All</option>
            {options.realms.map((realm) => <option key={realm} value={realm}>{realm}</option>)}
          </select>
        </label>
      ) : null}
      <label className={`gw-filter${on('dungeon')}`}>
        <span>Dungeon</span>
        <select value={filters.dungeon} onChange={set('dungeon')}>
          <option value="">All</option>
          {options.dungeons.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className={`gw-filter${on('from')}`}>
        <span>From</span>
        <input type="date" aria-label="From date" value={filters.from} onChange={set('from')} />
      </label>
      <label className={`gw-filter${on('to')}`}>
        <span>To</span>
        <input type="date" aria-label="To date" value={filters.to} onChange={set('to')} />
      </label>
      {Object.values(filters).some(Boolean) ? (
        <a className="gw-btn gw-btn--sm" href={dungeonHref({ server })}>Clear</a>
      ) : null}
    </div>
  )
}

function RunList({ runs, filters, server }) {
  return (
    <Panel id="player-dungeon-runs" title="Your runs" flush>
      <div className="gw-table-wrap">
        <table className="gw-table gw-runs">
          <thead>
            <tr>
              <th scope="col">Dungeon</th>
              <th scope="col" className="gw-hide-sm">Character</th>
              <th scope="col" className="gw-col-num">Time</th>
              <th scope="col" className="gw-col-num">XP</th>
              <th scope="col" className="gw-col-num gw-hide-sm">Gold</th>
              <th scope="col" className="gw-col-num">Bosses</th>
              <th scope="col" className="gw-col-num gw-hide-sm">Deaths</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const xp = xpSummary(run.xp)
              const color = classIdentity(run.character.classToken).color
              return (
                <tr key={run.id}>
                  <td>
                    <a className="gw-row-link" href={dungeonHref({ filters, runId: run.id, server })}>
                      <strong>{run.dungeon.name}</strong>
                      <span className="gw-muted">{[run.dungeon.difficultyName, dateLabel(run.startedAt)].filter(Boolean).join(' · ')}</span>
                    </a>
                  </td>
                  <td className="gw-hide-sm">
                    <span className="gw-class-name" style={{ '--class-color': color || 'var(--gw-text)' }}>{characterLabel(run.character)}</span>
                  </td>
                  <td className="gw-col-num">{formatRunDuration(run.durationSeconds)}</td>
                  <td className="gw-col-num">
                    {xp.value}
                    {xp.perHour ? <small className="gw-muted gw-runs__sub">{xp.perHour}</small> : null}
                  </td>
                  <td className="gw-col-num gw-hide-sm">{run.wallet.available ? formatCopper(run.wallet.netCopper) : '—'}</td>
                  <td className="gw-col-num">{bossLabel(run.bosses)}</td>
                  <td className="gw-col-num gw-hide-sm">{run.deaths}</td>
                  <td><StatusTag status={run.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function RunDetail({ runId, filters, server }) {
  const { status, data, error } = useLiveResource(`/api/player/dungeon-runs/${runId}`, { topics: TOPICS })
  const back = <a className="gw-btn gw-btn--sm" href={dungeonHref({ filters, server })}><Icon name="back" size={14} /> All runs</a>
  if (status === 'loading') return <SkeletonRows rows={6} label="Loading the run" />
  if (status === 'missing' || error?.status === 404) return <ErrorState>That run is not one of yours, or it no longer exists. {back}</ErrorState>
  if (status === 'error') return <ErrorState>This run could not be loaded.</ErrorState>
  const run = data?.run
  if (!run) return null
  const xp = xpSummary(run.xp)
  return (
    <div className="gw-stack">
      <div className="gw-run-head">
        {back}
        <div>
          <h2>{run.dungeon.name}</h2>
          <p className="gw-muted">
            {[run.dungeon.difficultyName, run.dungeon.type === 'raid' ? 'Raid' : 'Dungeon', characterLabel(run.character), run.realm, dateLabel(run.startedAt)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <StatusTag status={run.status} />
      </div>
      {run.status !== 'open' && run.endReason ? <p className="gw-muted gw-run-end">Ended: {endReasonLabel(run.endReason)}.</p> : null}
      {run.status === 'open' ? <p className="gw-muted gw-run-end">Still open when WoW last saved ({relativeTime(run.receivedAt)}).</p> : null}

      <section className="gw-stats gw-stats--4" aria-label="Run summary">
        <Stat label="Time" icon="bolt" value={formatRunDuration(run.durationSeconds)} foot={run.insideSeconds !== null ? `${formatRunDuration(run.insideSeconds)} inside` : 'Online time in the run'} />
        <Stat label="XP" icon="sparkle" value={xp.value} foot={xp.perHour || (run.xp.atLevelCap ? 'No XP at max level' : 'XP/hour after 5 minutes')} />
        <Stat label="Wallet change" icon="loot" value={run.wallet.available ? formatCopper(run.wallet.netCopper) : '—'} foot="Not profit: includes repairs and sales" />
        <Stat label="Bosses · deaths" icon="target" value={`${bossLabel(run.bosses)} · ${run.deaths}`} foot={run.bosses.encounterEvents ? 'From boss events' : 'No boss events; splits are manual'} />
      </section>

      <div className="gw-grid gw-grid--2">
        <Panel id="player-dungeon-timeline" title="Timeline" flush>
          {run.timeline.length ? (
            <ol className="gw-run-timeline">
              {run.timeline.map((entry, index) => (
                <li key={`${entry.at}-${entry.kind}-${index}`} className={`gw-run-timeline__item gw-run-timeline__item--${timelineTone(entry.kind)}`}>
                  <time>{formatOffset(entry.at)}</time>
                  <span>{timelineLabel(entry)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="gw-muted gw-run-empty">No events recorded.</p>}
          {run.timelineTruncated ? <p className="gw-muted gw-run-empty">Later events were not kept; the counts above are complete.</p> : null}
        </Panel>
        <Panel id="player-dungeon-loot" title="Loot recorded in this run" flush>
          {run.loot.items.length ? (
            <ul className="gw-bars">
              {run.loot.items.map((item) => (
                <li key={item.itemId}>
                  <ItemLabel item={{ itemId: item.itemId, name: item.name || `Item ${item.itemId}` }} size={22} />
                  <strong>{item.quantity}×</strong>
                </li>
              ))}
            </ul>
          ) : <p className="gw-muted gw-run-empty">No loot linked to this run yet. Corpse loot and gathering inside the instance appear here once synced.</p>}
        </Panel>
      </div>
    </div>
  )
}

// The player's own dungeon and raid runs. Private: only the signed-in
// account's runs are ever requested, and no party members are recorded.
export default function PlayerDungeons({ server, queryString = '' }) {
  const { filters, runId } = useMemo(() => readDungeonQuery(queryString), [queryString])
  const url = playerApiUrl('dungeon-runs', server, dungeonApiFilters(filters))
  const { status, data } = useLiveResource(url, { topics: TOPICS, enabled: !runId })

  if (runId) return <RunDetail runId={runId} filters={filters} server={server} />
  if (status === 'loading') return <SkeletonRows rows={8} label="Loading your dungeon runs" />
  if (status === 'error' || status === 'missing') return <ErrorState>Your dungeon runs could not be loaded.</ErrorState>

  const runs = data?.runs || []
  const options = data?.filters || { characters: [], realms: [], dungeons: [] }
  const filtered = Object.values(filters).some(Boolean)
  if (!runs.length && !filtered) {
    return (
      <div className="gw-stack">
        <EmptyState title="No dungeon runs synced yet." icon="dungeon">
          Enter a dungeon or raid with Guildweaver running. The run is tracked automatically; <kbd>/reload</kbd> or log out afterwards to send it.
        </EmptyState>
        <SyncNote />
      </div>
    )
  }

  const finished = runs.filter((run) => run.status !== 'open')
  const xpRuns = finished.filter((run) => run.xp.perHour)
  return (
    <div className="gw-stack">
      <section className="gw-stats gw-stats--3" aria-label="Dungeon run summary">
        <Stat label="Runs" icon="dungeon" value={runs.length} foot={`${finished.filter((run) => run.status === 'completed').length} completed`} />
        <Stat label="Bosses defeated" icon="target" value={runs.reduce((sum, run) => sum + (run.bosses.defeated || 0), 0)} foot={`${runs.reduce((sum, run) => sum + (run.deaths || 0), 0)} deaths`} />
        <Stat
          label="Typical XP/hour"
          icon="sparkle"
          value={xpRuns.length ? `${Math.round(xpRuns.reduce((sum, run) => sum + run.xp.perHour, 0) / xpRuns.length).toLocaleString('en-US')}` : '—'}
          foot={xpRuns.length ? `Average of ${xpRuns.length} run${xpRuns.length === 1 ? '' : 's'} below max level` : 'Needs a finished run below max level'}
        />
      </section>
      <Filters filters={filters} options={options} server={server} />
      {runs.length ? <RunList runs={runs} filters={filters} server={server} /> : <EmptyState title="No runs match these filters." icon="dungeon" />}
      <SyncNote />
    </div>
  )
}
