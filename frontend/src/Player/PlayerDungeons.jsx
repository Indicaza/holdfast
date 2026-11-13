import { useMemo, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { classIdentity } from '../Intelligence/classIdentity.js'
import { GameTooltipHover } from '../Intelligence/GameTooltip.jsx'
import { itemTooltipPending } from '../Intelligence/gameTooltipModel.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import { Coins, MarketPriceCell } from '../Market/MarketComponents.jsx'
import { auctionHref } from '../Market/marketFormat.js'
import { navigate } from '../Navigation/navigation.js'
import {
  COMPLETION_LABELS,
  STATUS_FILTERS,
  STATUS_LABELS,
  bossLabel,
  checkpointPace,
  contextLine,
  dungeonApiFilters,
  dungeonHref,
  endReasonLabel,
  formatCopper,
  formatDelta,
  formatNumber,
  formatOffset,
  formatRunDuration,
  formatSignedDuration,
  performanceSummary,
  readDungeonQuery,
  runMarkers,
  statusTone,
  timelineTrack,
  xpSummary,
} from './dungeonRunModel.js'
import { playerApiUrl, relativeTime } from './playerModel.js'
import { EmptyState, ErrorState, Icon, ItemLabel, Panel, SkeletonRows, Stat, Tip } from './ui.jsx'
import './PlayerDungeons.css'

const TOPICS = ['player']

function dateLabel(seconds) {
  if (!seconds) return '—'
  return new Date(seconds * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function shortDate(seconds) {
  if (!seconds) return '—'
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function StatusTag({ status }) {
  return <span className={`gw-tag gw-run-status gw-run-status--${statusTone(status)}`}>{STATUS_LABELS[status] || status}</span>
}

function Markers({ run }) {
  const markers = runMarkers(run)
  if (!markers.length) return null
  return (
    <span className="gw-run-marks">
      {markers.map((marker) => (
        <Tip key={marker.key} label={marker.title}>
          <span className={`gw-run-mark gw-run-mark--${marker.key}`} tabIndex={0}>{marker.label}</span>
        </Tip>
      ))}
    </span>
  )
}

function ClassName({ character, children }) {
  const color = classIdentity(character?.classToken).color
  return <span className="gw-class-name" style={{ '--class-color': color || 'var(--gw-text)' }}>{children}</span>
}

function difficultyText(dungeon = {}) {
  return dungeon.difficultyName || (dungeon.type === 'raid' ? 'Raid' : null)
}

// What the page knows and how old it is: the add-on writes on /reload or
// logout, so this is never live.
function SyncLine({ lastReceivedAt }) {
  return (
    <p className="gw-dcc__sync">
      Tracked by Guildweaver per run: time, XP, bosses, deaths and wallet change. Sent when WoW saves (<kbd>/reload</kbd>, logout, <kbd>/gw sync</kbd>), not live.
      {lastReceivedAt ? <> Last synced <strong>{relativeTime(lastReceivedAt)}</strong>.</> : null}
    </p>
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
      <label className={`gw-filter${on('status')}`}>
        <span>Status</span>
        <select value={filters.status} onChange={set('status')}>
          {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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

function Summary({ summary }) {
  const focus = summary.focus
  const scope = focus ? `${[focus.name, focus.difficultyName].filter(Boolean).join(' · ')}${focus.chosen === 'latest' ? ' (latest run)' : ''}` : null
  return (
    <section className="gw-stats gw-stats--6 gw-dcc__stats" aria-label="Performance summary">
      <Stat label="Completed runs" icon="dungeon" value={summary.completed} foot={`${summary.verified} verified · ${summary.runs} in view`} />
      <Stat label="Personal best" icon="bolt" value={focus?.pb ? formatRunDuration(focus.pb.durationSeconds) : '—'}
        foot={focus ? (focus.pb ? scope : `${scope}: no verified clear yet`) : 'No runs'} />
      <Stat label="Best XP/hour" icon="sparkle" value={focus?.bestXpPerHour ? formatNumber(focus.bestXpPerHour.value) : '—'}
        foot={focus ? (focus.bestXpPerHour ? scope : 'No rated run below max level') : 'One dungeon at a time'} />
      <Stat label="Typical XP/hour" icon="sparkle" value={focus?.typicalXpPerHour ? formatNumber(focus.typicalXpPerHour) : '—'}
        foot={focus ? (focus.typicalXpPerHour ? `Median of ${focus.ratedRuns} runs` : 'Needs 2 rated runs') : 'Median, per dungeon'} />
      <Stat label="Bosses" icon="target" value={summary.bosses} foot="Defeated in these runs" />
      <Stat label="Deaths" icon="close" value={summary.deaths} foot="Your character's own" />
    </section>
  )
}

function RunList({ runs, filters, server }) {
  return (
    <Panel id="player-dungeon-runs" title="Runs" description="Newest first. Wallet change is gold in minus gold out, not profit." flush>
      <div className="gw-table-wrap">
        <table className="gw-table gw-table--compact gw-runs">
          <thead>
            <tr>
              <th scope="col">Dungeon</th>
              <th scope="col" className="gw-hide-sm">Character</th>
              <th scope="col" className="gw-col-num">Time</th>
              <th scope="col" className="gw-col-num gw-hide-sm">XP</th>
              <th scope="col" className="gw-col-num gw-hide-sm">XP/h</th>
              <th scope="col" className="gw-col-num">Bosses</th>
              <th scope="col" className="gw-col-num gw-hide-sm">Deaths</th>
              <th scope="col" className="gw-col-num gw-hide-md">Wallet change</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const xp = xpSummary(run.xp)
              const change = run.marks?.vsPrevious?.durationSeconds
              return (
                <tr key={run.id}>
                  <td>
                    <a className="gw-row-link gw-runs__name" href={dungeonHref({ filters, runId: run.id, server })}>
                      <strong>{run.dungeon.name}</strong>
                      <span className="gw-muted">{[difficultyText(run.dungeon), dateLabel(run.startedAt)].filter(Boolean).join(' · ')}</span>
                    </a>
                    <Markers run={run} />
                  </td>
                  <td className="gw-hide-sm">
                    <ClassName character={run.character}>{run.character.name || 'Unknown'}</ClassName>
                    <span className="gw-muted gw-runs__sub">{run.character.levelAtEntry ? `Level ${run.character.levelAtExit && run.character.levelAtExit !== run.character.levelAtEntry ? `${run.character.levelAtEntry}→${run.character.levelAtExit}` : run.character.levelAtEntry}` : 'Level unknown'}</span>
                  </td>
                  <td className="gw-col-num">
                    {formatRunDuration(run.durationSeconds)}
                    {change !== null && change !== undefined ? <small className={`gw-runs__sub gw-pace gw-pace--${change < 0 ? 'ahead' : change > 0 ? 'behind' : 'even'}`} title="Against this character's previous verified clear here">{formatSignedDuration(change)}</small> : null}
                  </td>
                  <td className="gw-col-num gw-hide-sm">{xp.value}</td>
                  <td className="gw-col-num gw-hide-sm">{run.xp.perHour ? formatNumber(run.xp.perHour) : <span className="gw-muted" title={run.xp.atLevelCap ? 'No XP at max level' : 'Shown for runs of 5 minutes or more with XP readings'}>—</span>}</td>
                  <td className="gw-col-num">{bossLabel(run.bosses)}</td>
                  <td className="gw-col-num gw-hide-sm">{run.deaths}</td>
                  <td className="gw-col-num gw-hide-md">{run.wallet.available ? formatCopper(run.wallet.netCopper) : <span className="gw-muted" title="Money was not readable">—</span>}</td>
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

// Per dungeon, difficulty and character: never across them.
function Comparisons({ groups, filters, server }) {
  if (!groups.length) return null
  return (
    <Panel id="player-dungeon-compare" title="Comparisons" description="All-time, per character, dungeon and difficulty." flush>
      <ul className="gw-dcc-compare">
        {groups.slice(0, 12).map((group) => (
          <li key={group.key}>
            <div className="gw-dcc-compare__head">
              <a className="gw-link" href={dungeonHref({ filters: { ...filters, dungeon: group.dungeon.name, character: group.character.id || '' }, server })}>
                <strong>{group.dungeon.name}</strong>
              </a>
              <span className="gw-muted">{[difficultyText(group.dungeon), group.character.name].filter(Boolean).join(' · ')}</span>
            </div>
            {group.enough ? (
              <dl className="gw-dcc-compare__facts">
                <div><dt>Fastest</dt><dd>{group.fastest ? <a href={dungeonHref({ filters, runId: group.fastest.id, server })}>{formatRunDuration(group.fastest.durationSeconds)}</a> : '—'}</dd></div>
                <div><dt>Median</dt><dd>{group.medianDurationSeconds ? formatRunDuration(group.medianDurationSeconds) : '—'}</dd></div>
                <div><dt>Best XP/h</dt><dd>{group.bestXpPerHour ? formatNumber(group.bestXpPerHour.value) : '—'}</dd></div>
                <div><dt>Median XP/h</dt><dd>{group.medianXpPerHour ? formatNumber(group.medianXpPerHour) : '—'}</dd></div>
                <div><dt>Clears</dt><dd>{group.clears}<span className="gw-muted">/{group.runs}</span></dd></div>
              </dl>
            ) : (
              <p className="gw-muted gw-dcc-compare__few">
                {group.runs} run{group.runs === 1 ? '' : 's'}, {group.clears} verified clear{group.clears === 1 ? '' : 's'}. Comparisons start at 2.
                {group.fastest ? <> Fastest so far {formatRunDuration(group.fastest.durationSeconds)}.</> : null}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function useObjectiveMutation() {
  const session = useSession()
  return (path, method, body) => runAuthenticatedMutation({
    request: () => apiJson(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }),
    refresh: session.refresh,
    reauthenticate: () => session.signIn(signInReturnTo()),
  })
}

// A small checklist per character. Boss objectives tick themselves when a
// synced run shows the client reported that boss's kill.
function Objectives({ character, characterName }) {
  const url = character ? `/api/player/dungeon-objectives?character=${encodeURIComponent(character)}` : ''
  const resource = useLiveResource(url, { topics: TOPICS, enabled: Boolean(character) })
  const mutate = useObjectiveMutation()
  const [draft, setDraft] = useState('')
  const [boss, setBoss] = useState('')
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const data = resource.data
  const objectives = data?.objectives || []

  async function run(path, method, body) {
    setBusy(true)
    setError('')
    try {
      const result = await mutate(path, method, body)
      if (result) resource.mutate(result)
      return true
    } catch (failure) {
      setError(failure?.status === 409 ? 'This list is full (30 objectives).' : 'That change was not saved. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    if (await run('/api/player/dungeon-objectives', 'POST', { character, text, targetBoss: boss.trim() || undefined })) {
      setDraft('')
      setBoss('')
    }
  }

  async function saveEdit(event, objective) {
    event.preventDefault()
    const text = editing.text.trim()
    if (!text || text === objective.text) { setEditing(null); return }
    if (await run(`/api/player/dungeon-objectives/${objective.id}`, 'PATCH', { text })) setEditing(null)
  }

  return (
    <Panel id="player-dungeon-objectives" title="Objectives" description={character ? `${characterName || 'This character'}: the first open one shows as current.` : null} flush>
      {!character ? <p className="gw-muted gw-run-empty">Choose a character to keep a checklist for it.</p> : null}
      {character && resource.status === 'loading' ? <SkeletonRows rows={2} label="Loading objectives" /> : null}
      {character && resource.status === 'error' ? <p className="gw-muted gw-run-empty">Objectives could not be loaded.</p> : null}
      {character && data ? (
        <>
          {objectives.length ? (
            <ol className="gw-objectives">
              {objectives.map((objective, index) => (
                <li key={objective.id} className={`${objective.completed ? 'is-done' : ''}${objective.id === data.currentId ? ' is-current' : ''}`}>
                  <input type="checkbox" checked={objective.completed} disabled={busy || objective.completion?.source === 'boss_kill'}
                    aria-label={`${objective.completed ? 'Reopen' : 'Complete'} ${objective.text}`}
                    onChange={() => run(`/api/player/dungeon-objectives/${objective.id}`, 'PATCH', { completed: !objective.completed })} />
                  {editing?.id === objective.id ? (
                    <form className="gw-objectives__edit" onSubmit={(event) => saveEdit(event, objective)}>
                      <input className="gw-objectives__input" value={editing.text} maxLength={140} autoFocus aria-label="Objective text"
                        onChange={(event) => setEditing({ ...editing, text: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape') setEditing(null) }} />
                      <button type="submit" className="gw-btn gw-btn--sm" disabled={busy}>Save</button>
                    </form>
                  ) : (
                    <span className="gw-objectives__text">
                      {objective.id === data.currentId ? <span className="gw-objectives__current">Current</span> : null}
                      {objective.text}
                      {objective.target ? <small className="gw-muted"> · boss: {objective.target.name}{objective.target.dungeon ? ` (${objective.target.dungeon})` : ''}</small> : null}
                      {objective.completion?.source === 'boss_kill' ? <small className="gw-objectives__proof"> · done by a reported kill</small> : null}
                    </span>
                  )}
                  <span className="gw-objectives__tools">
                    <button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label={`Move ${objective.text} up`} disabled={busy || index === 0}
                      onClick={() => run(`/api/player/dungeon-objectives/${objective.id}`, 'PATCH', { move: 'up' })}><Icon name="arrowUp" size={14} /></button>
                    <button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label={`Move ${objective.text} down`} disabled={busy || index === objectives.length - 1}
                      onClick={() => run(`/api/player/dungeon-objectives/${objective.id}`, 'PATCH', { move: 'down' })}><Icon name="arrowDown" size={14} /></button>
                    <button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label={`Edit ${objective.text}`} disabled={busy}
                      onClick={() => setEditing({ id: objective.id, text: objective.text })}><Icon name="edit" size={14} /></button>
                    <button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label={`Remove ${objective.text}`} disabled={busy}
                      onClick={() => run(`/api/player/dungeon-objectives/${objective.id}`, 'DELETE')}><Icon name="close" size={14} /></button>
                  </span>
                </li>
              ))}
            </ol>
          ) : <p className="gw-muted gw-run-empty">No objectives yet.</p>}
          <form className="gw-objectives__add" onSubmit={add}>
            <input className="gw-objectives__input" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={140} placeholder="Add an objective" aria-label="New objective" />
            <input className="gw-objectives__input gw-objectives__input--boss" value={boss} onChange={(event) => setBoss(event.target.value)} maxLength={120} placeholder="Boss (optional)" aria-label="Boss that completes it (optional)" />
            <button type="submit" className="gw-btn gw-btn--sm" disabled={busy || !draft.trim()}><Icon name="plus" size={14} /> Add</button>
          </form>
          {error ? <p className="gw-objectives__error" role="alert">{error}</p> : null}
          <p className="gw-muted gw-objectives__note">Kept on the website. The in-game tracker has its own list (<kbd>/gw obj</kbd>); syncing this one into WoW is not available yet.</p>
        </>
      ) : null}
    </Panel>
  )
}

function TimelineTrack({ run }) {
  const track = timelineTrack(run)
  if (!track.markers.length) return <p className="gw-muted gw-run-empty">No events recorded.</p>
  return (
    <div className="gw-track">
      <div className="gw-track__rail" role="img" aria-label={`Run timeline, ${track.markers.length} events over ${formatRunDuration(track.end)}`}>
        {track.outside.map((span, index) => <span key={index} className="gw-track__outside" style={{ left: `${span.from}%`, width: `${Math.max(0.5, span.to - span.from)}%` }} />)}
        {track.markers.map((marker) => (
          <span key={`${marker.index}`} className={`gw-track__mark gw-track__mark--${marker.kind}`} style={{ left: `${marker.pct}%` }} title={`${formatOffset(marker.at)} · ${marker.label}`} />
        ))}
      </div>
      <div className="gw-track__scale" aria-hidden="true"><span>0:00</span><span>{formatOffset(track.end / 2)}</span><span>{formatOffset(track.end)}</span></div>
      <ol className="gw-run-timeline">
        {track.markers.map((marker) => (
          <li key={`${marker.at}-${marker.kind}-${marker.index}`} className={`gw-run-timeline__item gw-run-timeline__item--${marker.tone}`}>
            <time>{formatOffset(marker.at)}</time>
            <span><i className={`gw-track__dot gw-track__mark--${marker.kind}`} aria-hidden="true" />{marker.label}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Checkpoints({ run, filters, server }) {
  const pace = checkpointPace(run)
  return (
    <Panel id="player-dungeon-checkpoints" title="Checkpoints"
      description={pace.reference ? <>Against your best clear here, {formatRunDuration(pace.reference.durationSeconds)} on <a href={dungeonHref({ filters, runId: pace.reference.id, server })}>{shortDate(pace.reference.startedAt)}</a>.</> : 'No earlier verified clear of this dungeon by this character to compare with.'}
      flush>
      {pace.rows.length ? (
        <div className="gw-table-wrap">
          <table className="gw-table gw-table--compact">
            <thead><tr><th scope="col">Checkpoint</th><th scope="col" className="gw-col-num">At</th><th scope="col" className="gw-col-num">Split</th><th scope="col" className="gw-col-num">PB pace</th></tr></thead>
            <tbody>
              {pace.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}{row.manual ? <small className="gw-muted"> · manual split</small> : null}</td>
                  <td className="gw-col-num">{formatOffset(row.at)}</td>
                  <td className="gw-col-num">{formatOffset(row.split)}</td>
                  <td className="gw-col-num">
                    {row.delta !== null ? <span className={`gw-pace gw-pace--${row.delta < 0 ? 'ahead' : row.delta > 0 ? 'behind' : 'even'}`}>{formatDelta(row.delta)}</span>
                      : <span className="gw-muted" title={row.reason === 'not_in_reference' ? 'Your best clear has no matching checkpoint' : row.reason === 'not_comparable' ? 'Recorded differently in the two runs' : 'Nothing to compare with'}>—</span>}
                  </td>
                </tr>
              ))}
              {pace.finalDelta !== null ? (
                <tr className="gw-dcc__total"><th scope="row">Finish</th><td className="gw-col-num">{formatOffset(run.durationSeconds)}</td><td /><td className="gw-col-num">
                  <span className={`gw-pace gw-pace--${pace.finalDelta < 0 ? 'ahead' : pace.finalDelta > 0 ? 'behind' : 'even'}`}>{formatDelta(pace.finalDelta)}</span></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : <p className="gw-muted gw-run-empty">No boss kills or splits recorded. {run.bosses.encounterEvents ? '' : 'The client sent no boss events; use Split in the in-game tracker to mark checkpoints.'}</p>}
      {run.checkpointBasis === 'timeline' ? <p className="gw-muted gw-run-empty">From the run's timeline (add-on before 0.6).</p> : null}
    </Panel>
  )
}

function LootValue({ value, market }) {
  return (
    <dl className="gw-dcc-value">
      <div><dt>Items seen</dt><dd>{formatNumber(value.itemsObserved)}</dd><small>In loot windows ({value.distinctItems} kinds)</small></div>
      <div><dt>Confirmed acquired</dt><dd className="gw-muted">Not recorded</dd><small title={value.confirmedAcquiredReason}>Group loot may go to others</small></div>
      <div><dt>Estimated AH value</dt><dd>{value.estimatedAuctionCopper !== null ? <Coins value={value.estimatedAuctionCopper} /> : '—'}</dd>
        <small>{market?.marketKey && market.known ? `${value.pricedItems} priced${value.unpricedItems ? `, ${value.unpricedItems} not` : ''}${value.stalePrices ? ` · ${value.stalePrices} stale` : ''}` : (market?.reason || 'No market')}</small></div>
      <div><dt>Vendor value</dt><dd>{value.vendorCopper !== null ? <Coins value={value.vendorCopper} /> : '—'}</dd><small>{value.vendorKnownItems} with a known sell price</small></div>
      <div><dt>Realized revenue</dt><dd className="gw-muted">None recorded</dd><small title={value.realizedRevenueReason}>Needs sale evidence</small></div>
    </dl>
  )
}

// The item as the game shows it, linked to its Auction House research. The
// tooltip wraps the link, so keyboard focus shows it as hover does.
function LootItemLink({ item, market }) {
  const shown = { ...item, name: item.name || `Item ${item.itemId}` }
  const link = (
    <a className="gw-dcc-loot__item" href={auctionHref({ item: item.itemId, q: item.name || '', market: market?.known ? market.marketKey : '' })}
      aria-label={`${shown.name}: research on the Auction House`}>
      <ItemLabel item={shown} size={22} tooltip={false} />
    </a>
  )
  return itemTooltipPending(shown) ? link : <GameTooltipHover item={shown}>{link}</GameTooltipHover>
}

function LootPanel({ loot }) {
  const items = loot.items || []
  const market = loot.market
  return (
    <Panel id="player-dungeon-loot" title="Loot seen in this run"
      description="From corpse loot windows and your own gathering. An estimate is not profit and is never added to the wallet change." flush>
      {loot.value ? <LootValue value={loot.value} market={market} /> : null}
      {items.length ? (
        <div className="gw-table-wrap">
          <table className="gw-table gw-table--compact gw-dcc-loot">
            <thead><tr><th scope="col">Item</th><th scope="col" className="gw-col-num">Qty</th><th scope="col" className="gw-col-num">AH price (each)</th><th scope="col" className="gw-col-num gw-hide-sm">Vendor</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.itemId}>
                  <td>
                    <LootItemLink item={item} market={market} />
                    {item.itemLevel || item.slotName ? <small className="gw-muted gw-runs__sub">{[item.slotName, item.itemLevel ? `ilvl ${item.itemLevel}` : null, item.requiredLevel ? `req ${item.requiredLevel}` : null].filter(Boolean).join(' · ')}</small> : null}
                  </td>
                  <td className="gw-col-num">{item.quantity}{item.gatheredQuantity ? <small className="gw-muted gw-runs__sub" title="From your own gathering">{item.gatheredQuantity} gathered</small> : null}</td>
                  <td className="gw-col-num">{market?.known ? <MarketPriceCell price={item.price} /> : <span className="gw-muted">—</span>}</td>
                  <td className="gw-col-num gw-hide-sm">{Number(item.sellPrice) > 0 ? <Coins value={item.sellPrice} compact /> : <span className="gw-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="gw-muted gw-run-empty">No loot linked to this run yet. Corpse loot and gathering inside the instance appear here once synced.</p>}
      {market?.known ? <p className="gw-muted gw-run-empty">Prices: {market.name || market.marketKey}, lowest ask: asking prices people listed, not sales. Select an item to research it on the Auction House.</p> : null}
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
  const marks = run.marks || {}
  return (
    <div className="gw-stack gw-dcc">
      <div className="gw-run-head">
        {back}
        <div>
          <h2>{run.dungeon.name}{difficultyText(run.dungeon) ? <span className="gw-muted"> · {difficultyText(run.dungeon)}</span> : null}</h2>
          <p className="gw-muted">
            <ClassName character={run.character}>{run.character.name || 'Unknown character'}</ClassName>
            {' · '}{[run.character.levelAtEntry ? `level ${run.character.levelAtExit && run.character.levelAtExit !== run.character.levelAtEntry ? `${run.character.levelAtEntry}→${run.character.levelAtExit}` : run.character.levelAtEntry}` : null, run.realm, dateLabel(run.startedAt)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Markers run={run} />
        <StatusTag status={run.status} />
      </div>
      <p className="gw-muted gw-run-end">
        {run.status === 'open' ? 'Still open when WoW last saved. ' : run.endReason ? `Ended: ${endReasonLabel(run.endReason)}. ` : ''}
        {marks.completion ? `${COMPLETION_LABELS[marks.completion] || marks.completion}${marks.completionReasons?.length ? `: ${marks.completionReasons.join(' ')}` : ''}` : ''}
      </p>

      <section className="gw-stats gw-stats--6" aria-label="Run summary">
        <Stat label="Elapsed" icon="bolt" value={formatRunDuration(run.durationSeconds)} foot={run.insideSeconds !== null ? `${formatRunDuration(run.insideSeconds)} inside` : 'Inside time unknown'} />
        <Stat label="XP" icon="sparkle" value={xp.value} foot={run.xp.atLevelCap ? 'No XP at max level' : run.xp.levelUps ? `${run.xp.levelUps} level-up${run.xp.levelUps === 1 ? '' : 's'}${run.xp.partial ? ', partly measured' : ''}` : 'Quests and kills'} />
        <Stat label="XP/hour" icon="sparkle" value={run.xp.perHour ? formatNumber(run.xp.perHour) : '—'} foot={run.xp.perHour ? 'Per elapsed hour' : run.xp.partial ? 'Not rated: a multi-level jump' : 'Needs 5 min of XP data'} />
        <Stat label="Bosses" icon="target" value={bossLabel(run.bosses)} foot={run.bosses.encounterEvents ? 'From boss events' : 'No boss events; manual splits'} />
        <Stat label="Deaths" icon="close" value={run.deaths} foot="Your character's own" />
        <Stat label="Wallet change" icon="loot" value={run.wallet.available ? formatCopper(run.wallet.netCopper) : '—'} foot={run.wallet.available ? 'Gold in − out, not profit' : 'Money was not readable'} />
      </section>

      <Panel id="player-dungeon-timeline" title="Timeline" description={run.timelineTruncated ? 'Later events were not kept; the counts above are complete.' : 'Entry to exit, in order. Shaded: outside the instance.'} flush>
        <TimelineTrack run={run} />
      </Panel>

      <div className="gw-grid gw-grid--2 gw-dcc__detail-grid">
        <Checkpoints run={run} filters={filters} server={server} />
        <LootPanel loot={run.loot} />
      </div>
      <p className="gw-muted gw-dcc__footnote">
        Last synced {relativeTime(run.sync?.receivedAt || run.receivedAt)} (update {run.sync?.sequence ?? run.sequence}, payload v{run.sync?.schemaVersion ?? run.schemaVersion}). Times are what the add-on measured in your client; offline time never counts.
      </p>
    </div>
  )
}

// The player's own dungeon and raid runs. Private: only the signed-in
// account's runs are ever requested, and no party members are recorded.
export default function PlayerDungeons({ server, queryString = '' }) {
  const { filters, runId } = useMemo(() => readDungeonQuery(queryString), [queryString])
  const url = playerApiUrl('dungeon-runs', server, dungeonApiFilters(filters))
  const { status, data } = useLiveResource(url, { topics: TOPICS, enabled: !runId })
  const runs = useMemo(() => data?.runs || [], [data])
  const summary = useMemo(() => performanceSummary(runs, filters), [runs, filters])

  if (runId) return <RunDetail runId={runId} filters={filters} server={server} />
  if (status === 'loading') return <SkeletonRows rows={8} label="Loading your dungeon runs" />
  if (status === 'error' || status === 'missing') return <ErrorState>Your dungeon runs could not be loaded.</ErrorState>

  const options = data?.filters || { characters: [], realms: [], dungeons: [] }
  const filtered = Object.values(filters).some(Boolean)
  if (!runs.length && !filtered) {
    return (
      <div className="gw-stack">
        <EmptyState title="No dungeon runs synced yet." icon="dungeon">
          Enter a dungeon or raid with Guildweaver running. The run is tracked automatically; <kbd>/reload</kbd> or log out afterwards to send it.
        </EmptyState>
        <SyncLine lastReceivedAt={null} />
      </div>
    )
  }

  const objectiveCharacter = filters.character || (options.characters.length === 1 ? options.characters[0].id : '')
  const objectiveName = options.characters.find((entry) => entry.id === objectiveCharacter)?.name
  return (
    <div className="gw-stack gw-dcc">
      <header className="gw-dcc__head">
        <h2>{contextLine({ runs, filters, options })}</h2>
        <SyncLine lastReceivedAt={data?.lastReceivedAt} />
      </header>
      <Filters filters={filters} options={options} server={server} />
      <Summary summary={summary} />
      <div className="gw-dcc__main">
        {runs.length ? <RunList runs={runs} filters={filters} server={server} /> : <EmptyState title="No runs match these filters." icon="dungeon" />}
        <div className="gw-dcc__side">
          <Objectives character={objectiveCharacter} characterName={objectiveName} />
          <Comparisons groups={data?.comparisons || []} filters={filters} server={server} />
        </div>
      </div>
    </div>
  )
}
