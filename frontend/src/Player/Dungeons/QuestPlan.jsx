import { useId, useMemo, useState } from 'react'

import { relativeTime } from '../playerModel.js'
import { Icon, SkeletonRows } from '../ui.jsx'
import { STEP_STATUS_COPY, coordsText, laterQuests, questPlanModel, waypointMapHref, waypointSourceText } from './questPlanModel.js'

// The quest preparation checklist, as the add-on's Dungeon Journal shows it:
// the readiness, the next action, then numbered steps with lettered parts.
// Every state comes from the plan (the character's synced quest data); this
// only lays it out.

// "View on map" for a waypoint, with its coordinates and how sure we are of it.
export function WaypointLink({ waypoint, compact = false }) {
  if (!waypoint) return null
  const where = [waypoint.zoneName, coordsText(waypoint)].filter(Boolean).join(' ')
  return (
    <span className="gw-qplan__where">
      <a className="gw-qplan__map" href={waypointMapHref(waypoint)} aria-label={`View ${waypoint.target || 'this spot'} on the world map (${where})`}>
        <Icon name="map" size={12} /> {compact ? coordsText(waypoint) : where}
      </a>
      {waypoint.verified ? null : <span className="gw-qplan__unverified" title={waypointSourceText(waypoint)}>unverified</span>}
    </span>
  )
}

function StatusMark({ status }) {
  const copy = STEP_STATUS_COPY[status] || STEP_STATUS_COPY.unknown
  return <span className={`gw-qplan__mark gw-qplan__mark--${status}`} aria-label={copy.label} title={copy.label}>{copy.mark}</span>
}

// A prerequisite's line: the quest's name and who gives it, since chains often
// repeat one name ("The Defias Brotherhood" six times).
function chainTitle(step, waypoint) {
  const name = step.text.replace(/^Prerequisite: /, '')
  return waypoint?.target ? `${name} — ${waypoint.target}` : name
}

function SubStep({ label, step, model, nextId, title = null, nested = false, leaf = false }) {
  const waypoint = model.waypoints.get(step.waypoint) || null
  // A leaf (go, accept, turn in) waits for the same reason as its step: said once, above it.
  const why = leaf ? '' : model.explain(step)
  const isNext = step.id === nextId
  // A chain link's own parts show while it is the one to do; later links stay one line.
  const leaves = nested && step.children.length && (step.status === 'todo' || step.children.some((child) => child.id === nextId))
  return (
    <li className={`gw-qplan__sub gw-qplan__sub--${step.status}${isNext ? ' is-next' : ''}`} data-step={step.id} aria-current={isNext ? 'step' : undefined}>
      <span className="gw-qplan__label">{label}{label ? '.' : ''}</span>
      <StatusMark status={step.status} />
      <span className="gw-qplan__text">
        {title || step.text}
        {step.optional ? <span className="gw-muted"> (if nobody can share)</span> : null}
        {isNext ? <span className="gw-tag gw-tag--warn gw-qplan__nexttag">Next</span> : null}
      </span>
      {waypoint && !leaves ? <WaypointLink waypoint={waypoint} compact /> : null}
      {why && step.status !== 'done' ? <span className="gw-qplan__why">{why}</span> : null}
      {leaves ? (
        <ul className="gw-qplan__leaves">
          {step.children.map((child) => <SubStep key={child.id} label="" step={child} model={model} nextId={nextId} leaf />)}
        </ul>
      ) : null}
    </li>
  )
}

function shareNote(item, model) {
  const travel = item.step.children.find((child) => child.kind === 'travel')
  const waypoint = travel ? model.waypoints.get(travel.waypoint) : null
  return waypoint?.target ? `Sharing saves the trip to ${waypoint.target}${waypoint.zoneName ? ` in ${waypoint.zoneName}` : ''}.` : 'Sharing saves collecting it yourself.'
}

// A done quest step is either in the quest log or completed: the plan's text says which.
function doneCopy(item) {
  if (item.status !== 'done' || item.step.kind !== 'quest') return null
  if (/: in your quest log$/.test(item.step.text)) return { label: 'In quest log', tone: 'info', accepted: true }
  if (/: completed$/.test(item.step.text)) return { label: 'Completed', tone: 'ok' }
  return null
}

function PlanItem({ item, group, model, nextId, open, onToggle, said = null }) {
  const bodyId = useId()
  const parts = item.chain.length + item.children.length
  // Said only when nothing in the item can be done yet.
  const explained = item.status === 'blocked' || item.status === 'unknown' || item.status === 'ineligible' ? model.explain(item.step) : ''
  // A reason the group already states once is not repeated on each step.
  const why = said?.has(explained) ? '' : explained
  const title = group === 'share' ? item.step.text.replace(/: shareable$/, '') : item.status === 'done' ? item.step.text.replace(/: (in your quest log|completed)$/, '') : item.step.text
  return (
    <li className={`gw-qplan__item gw-qplan__item--${item.status}${doneCopy(item)?.accepted ? ' is-accepted' : ''}${item.containsNext ? ' contains-next' : ''}`} data-step={item.key}>
      <div className="gw-qplan__row">
        <span className="gw-qplan__label gw-qplan__label--top">{item.label}{item.label === 'or' ? '' : '.'}</span>
        <StatusMark status={item.status} />
        <span className="gw-qplan__title">
          <strong>{title}</strong>
          {item.status !== 'todo' ? <span className={`gw-tag gw-tag--${doneCopy(item)?.tone || STEP_STATUS_COPY[item.status]?.tone || 'quiet'} gw-qplan__state`}>{doneCopy(item)?.label || STEP_STATUS_COPY[item.status]?.label}</span> : null}
          {item.chain.length ? <span className="gw-tag gw-tag--quiet">{item.chain.length}-quest chain</span> : null}
        </span>
        {item.waypoint && !item.children.some((child) => child.step.waypoint === item.step.waypoint) ? <WaypointLink waypoint={item.waypoint} /> : null}
        {parts ? (
          <button type="button" className="gw-qplan__toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(item.key)}>
            {open ? 'Hide steps' : `Show ${parts} step${parts === 1 ? '' : 's'}`}
            <Icon name="chevron" size={12} />
          </button>
        ) : null}
      </div>
      {group === 'share' ? <p className="gw-qplan__why gw-qplan__why--info">{shareNote(item, model)}</p> : null}
      {why ? <p className="gw-qplan__why">{why}</p> : null}
      {item.shared.length && !why ? (
        <p className="gw-qplan__why gw-qplan__why--info">Uses the same quest chain as {[...new Set(item.shared.map((id) => model.labelOf(id)).filter(Boolean))].map((label) => `step ${label}`).join(' and ') || 'an earlier step'}.</p>
      ) : null}
      {parts && open ? (
        <ol id={bodyId} className="gw-qplan__subs">
          {item.chain.map(({ label, step }) => (
            <SubStep key={step.id} label={label} step={step} model={model} nextId={nextId} title={chainTitle(step, model.waypoints.get(step.waypoint))} nested />
          ))}
          {item.children.map(({ label, step }) => <SubStep key={step.id} label={label} step={step} model={model} nextId={nextId} leaf />)}
        </ol>
      ) : null}
    </li>
  )
}

function PlanGroup({ group, model, nextId, isOpen, onToggle }) {
  const headingId = useId()
  // Long plans: what is done folds into one line at the end.
  const fold = model.long && group.done > 0 && group.done < group.items.length
  const shown = fold ? group.items.filter((item) => item.status !== 'done') : group.items
  const done = fold ? group.items.filter((item) => item.status === 'done') : []
  // The same reason on several steps ("its quest chain is not known") is said
  // once, above them, with how many it covers.
  const reasons = new Map()
  for (const item of group.items) {
    if (item.status !== 'unknown' && item.status !== 'ineligible') continue
    const why = model.explain(item.step)
    if (why) reasons.set(why, (reasons.get(why) || 0) + 1)
  }
  const said = new Set([...reasons].filter(([, count]) => count > 1).map(([why]) => why))
  const render = (item) => <PlanItem key={item.key} item={item} group={group.key} model={model} nextId={nextId} open={isOpen(item)} onToggle={onToggle} said={said} />
  return (
    <section className={`gw-qplan__group gw-qplan__group--${group.key}`} aria-labelledby={headingId}>
      <h4 id={headingId}>
        {group.title}
        {group.items.length > 1 && group.key !== 'share' ? <span className="gw-muted gw-qplan__count"> {group.done} of {group.items.length} done</span> : null}
      </h4>
      {group.key === 'share' ? <p className="gw-muted gw-qplan__note">Only if someone in your group already has the quest: Guildweaver cannot see other players' quest logs.</p> : null}
      {group.key === 'enter' ? <p className="gw-muted gw-qplan__note">These steps prepare quests: they are not what the game requires to enter. Any key or attunement the dungeon needs is not tracked here.</p> : null}
      {[...said].map((why) => (
        <p key={why} className="gw-qplan__note gw-qplan__note--unknown">{reasons.get(why)} steps · {why}</p>
      ))}
      {group.notes.map((note) => (
        <p key={note.text} className="gw-qplan__note gw-qplan__note--editorial">
          {note.text}{note.verified ? null : <span className="gw-qplan__unverified" title="From the Guildweaver editors, not checked in game yet">unverified</span>}
        </p>
      ))}
      <ol className="gw-qplan__list">{shown.map(render)}</ol>
      {done.length ? (
        <details className="gw-qplan__done">
          <summary>{done.length} already collected</summary>
          <ol className="gw-qplan__list">{done.map(render)}</ol>
        </details>
      ) : null}
    </section>
  )
}

function Freshness({ freshness, character }) {
  if (!freshness.synced) {
    return <p className="gw-qplan__fresh gw-qplan__fresh--warn">No quest data synced for {character.name} yet. Play with Guildweaver on, then <kbd>/reload</kbd>: until then no step can be marked done.</p>
  }
  const parts = [`Quest log read in game ${relativeTime(freshness.capturedAt)}${freshness.receivedAt && freshness.receivedAt !== freshness.capturedAt ? `, uploaded ${relativeTime(freshness.receivedAt)}` : ''}.`]
  if (freshness.stale) parts.push('That may be out of date: /reload or log out in WoW to update.')
  if (freshness.missing.length) parts.push(`The game did not report ${freshness.missing.join(' or ')}, so those quests show as not known.`)
  else if (freshness.partial) parts.push('Only some completed quests were checked: the rest show as not known.')
  return <p className={`gw-qplan__fresh${freshness.stale || freshness.partial ? ' gw-qplan__fresh--warn' : ''}`}>{parts.join(' ')}</p>
}

// No next step: say why, from what the plan knows.
function noNextText(model, character) {
  if (model.readiness.key === 'ready') return `${character.name} has every dungeon quest. Ready to enter.`
  if (model.readiness.key === 'none') return model.readiness.line
  if (!model.freshness.synced) return 'Sync quest data to get a next step.'
  if (model.readiness.key === 'unknown') return 'Nothing is known to be doable yet: some quests\' givers or chains are not in our data.'
  return 'Nothing is doable yet from the synced quest data.'
}

function NextAction({ model, character, onJump }) {
  const { next } = model
  if (!next) return <p className={`gw-qplan__next gw-qplan__next--none${model.readiness.key === 'ready' ? ' is-ready' : ''}`} role="status">{noNextText(model, character)}</p>
  const context = next.owner !== next.step ? next.owner.text.replace(/^Prerequisite: /, '') : next.item.step !== next.step ? next.item.step.text : ''
  // A next step from incomplete or old quest data is a suggestion, and says so.
  const tentative = model.freshness.partial || model.freshness.stale || model.readiness.key === 'unknown'
  return (
    <section className={`gw-qplan__next${tentative ? ' gw-qplan__next--tentative' : ''}`} aria-label="Next step">
      <span className="gw-qplan__nextlabel">{tentative ? 'Suggested next' : 'Next'} · step {next.label}{next.sublabel}</span>
      <strong className="gw-qplan__nexttext">{next.step.text}</strong>
      {context ? <span className="gw-muted gw-qplan__nextfor">For {context}</span> : null}
      {tentative ? <span className="gw-qplan__nextfor gw-qplan__tentative">From incomplete quest data: check it in game before you travel.</span> : null}
      <span className="gw-qplan__nextactions">
        {next.waypoint ? <WaypointLink waypoint={next.waypoint} /> : null}
        <button type="button" className="gw-link" onClick={onJump}>Show in the checklist</button>
      </span>
    </section>
  )
}

// Quests the character's level does not allow yet: not hidden, but said
// with the level they open at.
function LaterQuests({ quests, character }) {
  if (!quests.length) return null
  return (
    <details className="gw-qplan__extra gw-qplan__later">
      <summary><h4>Available at a higher level</h4><span className="gw-tag gw-tag--quiet">{quests.length}</span></summary>
      <ul className="gw-qplan__subs gw-qplan__subs--plain">
        {quests.map((quest) => (
          <li key={quest.questId} className="gw-qplan__sub gw-qplan__sub--ineligible">
            <span className="gw-qplan__label" />
            <span className="gw-qplan__mark gw-qplan__mark--ineligible" aria-hidden="true">–</span>
            <span className="gw-qplan__text">{quest.name}{quest.relevance === 'optional' ? <span className="gw-muted"> (optional)</span> : null}</span>
            <span className="gw-qplan__where">From level {quest.minLevel}{character?.level ? ` · ${character.name} is ${character.level}` : ''}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function ExtraGroup({ group, model }) {
  return (
    <details className="gw-qplan__extra">
      <summary><h4>{group.title}</h4><span className="gw-tag gw-tag--quiet">{group.steps.length}</span></summary>
      <ul className="gw-qplan__subs gw-qplan__subs--plain">
        {group.steps.map((step) => <SubStep key={step.id} label="" step={step} model={model} nextId="" />)}
      </ul>
    </details>
  )
}

// The plan for one character: summary, next step, checklist, extras.
// `fallback` is drawn when there is no plan (a dungeon without a quest list).
export default function QuestPlan({ resource, character, fallback = null, now = undefined, readiness = null }) {
  const model = useMemo(() => questPlanModel(resource?.data, now === undefined ? {} : { now }), [resource?.data, now])
  const later = useMemo(() => laterQuests(readiness?.data), [readiness?.data])
  // Open or closed, by item: what the player chose wins over the default
  // (the next step and short plans open, done steps closed).
  const [choices, setChoices] = useState(() => new Map())
  const [all, setAll] = useState(null)
  if (resource?.status === 'loading' && !resource.data) return <SkeletonRows rows={4} label="Loading the quest plan" />
  if (!model) return fallback
  const nextId = model.next?.step.id || ''
  const isOpen = (item) => (choices.has(item.key) ? choices.get(item.key) : all !== null ? all : item.containsNext || (!model.long && item.status !== 'done' && item.status !== 'ineligible'))
  const onToggle = (key) => setChoices((current) => {
    const next = new Map(current)
    const item = model.groups.flatMap((group) => group.items).find((entry) => entry.key === key)
    next.set(key, !isOpen(item))
    return next
  })
  const setEvery = (value) => {
    setChoices(new Map())
    setAll(value)
  }
  const jump = () => {
    if (!model.next) return
    setChoices((current) => new Map(current).set(model.next.item.key, true))
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-step="${model.next.step.id}"]`) || document.querySelector(`[data-step="${model.next.item.key}"]`)
      target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    })
  }
  const steps = model.groups.reduce((sum, group) => sum + group.items.length, 0)
  return (
    <section className="gw-qplan" aria-label={`Quest preparation for ${character.name}`} data-readiness={model.readiness.key}>
      <header className={`gw-qplan__summary gw-qplan__summary--${model.readiness.tone}`}>
        <div className="gw-qplan__headline">
          <span className={`gw-tag gw-atlas-qstate gw-atlas-qstate--${model.readiness.tone}`}>{model.readiness.label}</span>
          <span>{model.readiness.line}</span>
        </div>
        <Freshness freshness={model.freshness} character={character} />
        {model.hiddenIneligible > later.length ? (
          <p className="gw-muted gw-qplan__fresh">{model.hiddenIneligible - later.length} dungeon quest{model.hiddenIneligible - later.length === 1 ? ' is' : 's are'} not for {character.name} (faction, race or class) and {model.hiddenIneligible - later.length === 1 ? 'is' : 'are'} left out.</p>
        ) : null}
      </header>
      <NextAction model={model} character={character} onJump={jump} />
      {model.long || steps > 8 ? (
        <div className="gw-qplan__tools">
          <button type="button" className="gw-btn gw-btn--sm gw-btn--quiet" onClick={() => setEvery(true)}>Expand all</button>
          <button type="button" className="gw-btn gw-btn--sm gw-btn--quiet" onClick={() => setEvery(false)}>Collapse all</button>
        </div>
      ) : null}
      {model.groups.map((group) => <PlanGroup key={group.key} group={group} model={model} nextId={nextId} isOpen={isOpen} onToggle={onToggle} />)}
      {model.extras.map((group) => <ExtraGroup key={group.key} group={group} model={model} />)}
      <LaterQuests quests={later} character={character} />
      <p className="gw-muted gw-qplan__source">
        Quest facts are Classic reference data unless marked otherwise{model.editorial ? '; this dungeon also has notes from the Guildweaver editors' : ''}. Locations marked unverified have not been checked on Forever.
      </p>
    </section>
  )
}
