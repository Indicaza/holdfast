import { useMemo } from 'react'

import { dungeonHref, formatRunDuration } from '../dungeonRunModel.js'
import { relativeTime } from '../playerModel.js'
import { ErrorState, Icon, SkeletonRows } from '../ui.jsx'
import {
  ROLES,
  bossKey,
  dungeonItems,
  gearTargets,
  needsUnverifiedBadge,
  questModel,
  quickGuide,
  runHistory,
} from './atlasModel.js'
import { LootList, UnverifiedBadge } from './AtlasLoot.jsx'
import { useDungeonRuns } from './useAtlasData.js'

// Tank / Healer / Damage (or every role): orders the quick guides.
export function RoleSelect({ role, onRole, character = null }) {
  return (
    <div className="gw-atlas-rolebar">
      <div className="gw-seg gw-atlas-roles" role="group" aria-label="Quick guide role">
        <button type="button" aria-pressed={!role} onClick={() => onRole('')}>All roles</button>
        {ROLES.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={role === id} onClick={() => onRole(id)}>{label}</button>
        ))}
      </div>
      {character && !role ? <span className="gw-muted gw-atlas-roles__hint">{character.name}'s role is not known: pick one</span> : null}
    </div>
  )
}

// The 2–4 abilities that matter most for the role, from the ability data
// only (category, priority, interruptible, summary). No tactics are made up.
export function QuickGuide({ abilities = [], role = '', title = 'Quick guide' }) {
  const lines = quickGuide(abilities, role)
  if (!lines.length) return null
  const roleLabel = ROLES.find(([id]) => id === role)?.[1]
  return (
    <section className="gw-atlas-guide" aria-label={`${title}${roleLabel ? ` for ${roleLabel.toLowerCase()}` : ''}`}>
      <h4>{title}{roleLabel ? <span className="gw-muted"> · {roleLabel}</span> : null}</h4>
      <ol>
        {lines.map(({ ability, action, interruptible, unverified, forRole }) => (
          <li key={ability.spellId || ability.name} className={`gw-atlas-guide__line gw-atlas-guide__line--${ability.priority || 'low'}`}>
            <span className={`gw-tag ${forRole ? 'gw-tag--info' : 'gw-tag--quiet'}`}>{action}</span>
            <strong>{ability.name}</strong>
            {interruptible && action !== 'Interrupt' ? <span className="gw-tag gw-tag--ok">Interruptible</span> : null}
            {ability.priority === 'high' ? <span className="gw-tag gw-tag--warn">High priority</span> : null}
            {ability.summary ? <span className="gw-atlas-guide__summary">{ability.summary}</span> : null}
            {unverified ? <UnverifiedBadge /> : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

// One quest with everything the atlas knows; facts it lacks are left out.
function QuestLine({ quest: raw, rewardProps, open = false }) {
  const quest = questModel(raw)
  const meta = [quest.level ? `Level ${quest.level}` : null, quest.minLevel ? `from level ${quest.minLevel}` : null, quest.faction || null].filter(Boolean)
  const rewards = quest.rewards.map((item) => ({ item, source: `Quest: ${quest.name}`, hideSource: true, sourceKey: `quest:${quest.id}`, observed: item.observed === true, reference: true, sourceKind: 'quest', choice: item.choice === true }))
  const details = quest.giver || quest.objective || quest.prerequisites.length || quest.location || rewards.length
  return (
    <li className="gw-atlas-quest">
      <details open={open}>
        <summary>
          <strong>{quest.name}</strong>
          <span className="gw-muted">{meta.join(' · ')}</span>
        </summary>
        {details ? (
          <dl className="gw-atlas-quest__facts">
            {quest.giver ? <div><dt>Giver</dt><dd>{quest.giver}</dd></div> : null}
            {quest.location ? (
              <div><dt>Location</dt><dd>
                {[quest.location.zoneName, quest.location.coords].filter(Boolean).join(' ') || 'Not known'}
                {quest.location.mapId ? <> <a className="gw-link" href={`/map?zone=${quest.location.mapId}`}><Icon name="map" size={12} /> Map</a></> : null}
              </dd></div>
            ) : null}
            {quest.objective ? <div><dt>Objective</dt><dd>{quest.objective}</dd></div> : null}
            {quest.prerequisites.length ? <div><dt>Requires</dt><dd>{quest.prerequisites.join(', ')}</dd></div> : null}
          </dl>
        ) : <p className="gw-muted">No objective, location or rewards in the atlas yet.</p>}
        {rewards.length ? (
          <>
            <h5 className="gw-atlas-quest__rewards">Rewards{rewards.some((row) => row.choice) ? ' (choose one)' : ''}</h5>
            <LootList rows={rewards} {...rewardProps} />
          </>
        ) : null}
      </details>
    </li>
  )
}

export function QuestList({ quests = [], rewardProps, empty = 'No quests for this dungeon in the atlas yet.' }) {
  if (!quests.length) return <p className="gw-muted">{empty}</p>
  return <ul className="gw-atlas-quests">{quests.map((quest) => <QuestLine key={quest.questId || quest.name} quest={quest} rewardProps={rewardProps} />)}</ul>
}

// The player's own runs of this dungeon (by the selected character).
export function Runs({ entry, character, server, compact = false }) {
  const name = entry?.name || ''
  const { status, data } = useDungeonRuns({ server, dungeon: name, character: character?.id || '' })
  const runs = useMemo(() => data?.runs || [], [data])
  const summary = useMemo(() => runHistory(runs).get({ name }), [runs, name])
  if (status === 'loading') return <SkeletonRows rows={3} label="Loading your runs" />
  if (status === 'error' || status === 'missing') return <ErrorState>Your runs could not be loaded.</ErrorState>
  const all = dungeonHref({ filters: { dungeon: name, character: character?.id || '' }, server })
  if (!runs.length) {
    return (
      <p className="gw-muted gw-atlas-empty">
        No runs of {name}{character ? ` by ${character.name}` : ''} synced yet. Run it with Guildweaver on, then <kbd>/reload</kbd>: your time, deaths and loot show here.
      </p>
    )
  }
  return (
    <>
      {summary ? (
        <p className="gw-atlas-history">
          {summary.count} run{summary.count === 1 ? '' : 's'}, {summary.completed} completed
          {summary.bestSeconds ? ` · best ${formatRunDuration(summary.bestSeconds)}` : ''}
          {summary.lastStartedAt ? ` · last ${relativeTime(new Date(summary.lastStartedAt * 1000).toISOString())}` : ''}
        </p>
      ) : null}
      <ul className="gw-atlas-runs">
        {runs.slice(0, compact ? 3 : 8).map((run) => (
          <li key={run.id}>
            <a href={dungeonHref({ filters: { dungeon: name }, runId: run.id, server })}>{run.character?.name || 'Run'}</a>
            <span className="gw-muted">{[formatRunDuration(run.timer?.seconds ?? run.durationSeconds), run.status === 'completed' ? null : 'not completed', run.deaths ? `${run.deaths} death${run.deaths === 1 ? '' : 's'}` : null, relativeTime(run.startedAt ? new Date(run.startedAt * 1000).toISOString() : null)].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
      </ul>
      <a className="gw-link" href={all}>All runs here</a>
    </>
  )
}

function Block({ title, count = null, open = true, children, id }) {
  return (
    <details className="gw-atlas-prep__block" open={open} data-block={id}>
      <summary><h3>{title}</h3>{count !== null ? <span className="gw-tag gw-tag--quiet">{count}</span> : null}</summary>
      <div className="gw-atlas-prep__body">{children}</div>
    </details>
  )
}

// What to know before going in, for the selected character: gear they can
// use, quests, the dangerous encounters for their role, and their history.
export function PrepareView({ entry, atlas, detail, character, server, role, onRole, wishes, lootProps, onBoss, onPlan }) {
  const items = useMemo(() => dungeonItems(detail || {}, atlas), [detail, atlas])
  const targets = useMemo(() => gearTargets(items, character, atlas), [items, character, atlas])
  const wanted = targets.filter((row) => wishes.has(row.item.itemKey))
  const ordered = [...wanted, ...targets.filter((row) => !wishes.has(row.item.itemKey))]
  const bosses = atlas.bosses.filter((boss) => (boss.abilities || []).length)
  const trash = atlas.creatures.filter((creature) => (creature.abilities || []).length)
  const unverified = [...bosses, ...trash].some((entry) => entry.abilities.some(needsUnverifiedBadge))
  return (
    <div className="gw-atlas-section gw-atlas-prep">
      <Block id="gear" title="Gear targets" count={character ? targets.length : null}>
        {!character ? <p className="gw-muted gw-atlas-empty">Choose a character to see the gear they can use from here.</p> : (
          <>
            <p className="gw-muted">
              Items {character.name} ({[character.className, character.level ? `level ${character.level}` : null].filter(Boolean).join(', ') || 'class unknown'}) can use, from
              {' '}{atlas.levelMax ? `now up to level ${atlas.levelMax}` : 'their current level'}: class restrictions and required level only.
              {wanted.length ? ` ${wanted.length} already on the wishlist.` : ''}
            </p>
            <LootList rows={ordered} limit={8} empty={items.length ? `Nothing here that ${character.name} can use.` : 'No loot known for this dungeon yet.'} {...lootProps} />
            {onPlan ? <button type="button" className="gw-btn gw-btn--sm" onClick={onPlan}><Icon name="sparkle" size={14} /> Plan my gear with AI</button> : null}
          </>
        )}
      </Block>
      <Block id="quests" title="Quests" count={atlas.quests.length}>
        <QuestList quests={atlas.quests} rewardProps={lootProps} />
      </Block>
      <Block id="danger" title="Dangerous encounters" count={bosses.length + trash.length}>
        <RoleSelect role={role} onRole={onRole} character={character} />
        {!bosses.length && !trash.length ? <p className="gw-muted gw-atlas-empty">No boss or trash abilities in the atlas yet.</p> : null}
        {bosses.map((boss) => (
          <div key={bossKey(boss)} className="gw-atlas-prep__encounter">
            <button type="button" className="gw-link gw-atlas-prep__boss" onClick={() => onBoss(boss)}>{boss.name}</button>
            <QuickGuide abilities={boss.abilities} role={role} title="Key abilities" />
          </div>
        ))}
        {trash.map((creature) => (
          <div key={`trash-${creature.npcId || creature.name}`} className="gw-atlas-prep__encounter">
            <strong>{creature.name} <span className="gw-muted">(trash{creature.count > 1 ? ` ×${creature.count}` : ''})</span></strong>
            <QuickGuide abilities={creature.abilities} role={role} title="Key abilities" />
          </div>
        ))}
        {unverified ? <p className="gw-muted gw-atlas-provenance">Abilities labelled Classic reference come from Classic data and have not been checked on Forever.</p> : null}
      </Block>
      <Block id="history" title="My history" open={false}>
        <Runs entry={entry} character={character} server={server} compact />
      </Block>
    </div>
  )
}
