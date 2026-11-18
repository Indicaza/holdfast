import { useCallback, useEffect, useMemo, useState } from 'react'

import { navigate } from '../../Navigation/navigation.js'
import { resolveCharacter } from '../lootModel.js'
import { onServerKey } from '../playerModel.js'
import { formatRunDuration } from '../dungeonRunModel.js'
import { relativeTime } from '../playerModel.js'
import { EmptyState, ErrorState, Icon, SkeletonRows } from '../ui.jsx'
import {
  FIT_COPY,
  cardModel,
  countsOf,
  dungeonItems,
  exploreHref,
  exploreOptions,
  filterDungeons,
  gearTargets,
  levelFit,
  readAtlasQuery,
  recommendDungeon,
  runHistory,
  wishlistTargets,
} from './atlasModel.js'
import PlanMyGear from './PlanMyGear.jsx'
import { useDungeonDetails, useDungeonList, useDungeonRuns, useWishlist } from './useAtlasData.js'

// How many dungeons' details the cards load to count usable gear.
const DETAIL_BUDGET = 12
import './DungeonAtlas.css'

function runLine(history) {
  if (!history) return 'Not run yet'
  const parts = [`Run ${history.count}×`]
  if (history.bestSeconds) parts.push(`best ${formatRunDuration(history.bestSeconds)}`)
  if (history.lastStartedAt) parts.push(`last ${relativeTime(new Date(history.lastStartedAt * 1000).toISOString())}`)
  return parts.join(' · ')
}

function DungeonCard({ card, character, href, gear = null, history, historyKnown = false, recommendation = null }) {
  const fit = card.fit && character ? FIT_COPY[card.fit] : null
  return (
    <li className={`gw-atlas-card${card.fit === 'fit' ? ' is-fit' : ''}${recommendation?.recommended ? ' is-recommended' : ''}`} data-dungeon={card.id}>
      <a className="gw-atlas-card__link" href={href}
        aria-label={`${card.name}${card.levels ? `, ${card.levels}` : ''}${card.zone ? `, ${card.zone}` : ''}${recommendation?.recommended ? ', recommended' : ''}`}>
        <span className="gw-atlas-card__art" style={card.artworkUrl ? { backgroundImage: `url("${card.artworkUrl}")` } : undefined} aria-hidden="true">
          {card.artworkUrl ? null : <Icon name="dungeon" size={28} />}
          {card.kind === 'raid' ? <span className="gw-tag gw-atlas-card__kind">Raid</span> : null}
        </span>
        <span className="gw-atlas-card__body">
          <strong className="gw-atlas-card__name">{card.name}</strong>
          <span className="gw-muted">{[card.levels, card.zone].filter(Boolean).join(' · ') || 'Level and zone not known yet'}</span>
          <span className="gw-atlas-card__stats">
            {card.bossCount ? <span>{card.bossCount} boss{card.bossCount === 1 ? '' : 'es'}</span> : null}
            {card.questCount ? <span>{card.questCount} quest{card.questCount === 1 ? '' : 's'}</span> : null}
            <span>{card.itemCount} item{card.itemCount === 1 ? '' : 's'} seen</span>
            {card.referenceLootCount ? <span title="Classic reference — not verified for Forever">{card.referenceLootCount} reference</span> : null}
          </span>
          {character ? (
            <span className="gw-atlas-card__mine">
              {card.wishlistDrops ? <span className="gw-atlas-card__wish"><Icon name="loot" size={12} /> {card.wishlistDrops} wishlist target{card.wishlistDrops === 1 ? '' : 's'}</span> : null}
              {gear?.gear ? <span>{gear.gear} drop{gear.gear === 1 ? '' : 's'} for {character.className || character.name}{gear.rewards ? ` · ${gear.rewards} quest reward${gear.rewards === 1 ? '' : 's'}` : ''}</span> : null}
              {historyKnown ? <span className="gw-muted">{runLine(history)}</span> : null}
            </span>
          ) : null}
          {recommendation?.recommended ? (
            <span className="gw-atlas-card__why">
              <span className="gw-tag gw-tag--ok"><Icon name="check" size={12} /> Recommended</span>
              <span className="gw-muted">Why: {recommendation.reasons.join(' · ')}</span>
            </span>
          ) : fit ? <span className={`gw-tag gw-tag--${fit.tone} gw-atlas-card__fit`}>{card.fit === 'fit' ? <Icon name="check" size={12} /> : null} {fit.label} {character.name}</span> : null}
        </span>
      </a>
    </li>
  )
}

function Filters({ filters, options, characters, character, onChange, onCharacter, recommendedCount = 0 }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.type === 'checkbox' ? (event.target.checked ? '1' : '') : event.target.value })
  // The search box keeps its own text while typing; the URL follows.
  const [text, setText] = useState(filters.find)
  const [synced, setSynced] = useState(filters.find)
  if (filters.find !== synced) {
    setSynced(filters.find)
    if (filters.find !== text.trim()) setText(filters.find)
  }
  useEffect(() => {
    if (text.trim() === filters.find) return undefined
    const timer = setTimeout(() => onChange({ ...filters, find: text.trim() }), 200)
    return () => clearTimeout(timer)
  }, [text, filters, onChange])
  const active = Object.values(filters).some(Boolean)
  return (
    <div className="gw-filterbar gw-atlas-filters" role="group" aria-label="Filter dungeons">
      <label className={`gw-filter gw-atlas-filters__search${filters.find ? ' is-active' : ''}`}>
        <span>Search</span>
        <input type="search" value={text} placeholder="Dungeon or zone" aria-label="Search dungeons" onChange={(event) => setText(event.target.value)} />
      </label>
      <label className="gw-filter">
        <span>Character</span>
        <select value={character?.id || ''} disabled={!characters.length} onChange={(event) => onCharacter(event.target.value)}>
          {characters.length ? null : <option value="">No character synced</option>}
          {characters.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.level ? ` · ${entry.level}` : ''}</option>)}
        </select>
      </label>
      {options.levels ? (
        <fieldset className={`gw-filter gw-atlas-filters__levels${filters.lmin || filters.lmax ? ' is-active' : ''}`}>
          <legend>Levels</legend>
          <input type="number" min="1" max="80" inputMode="numeric" value={filters.lmin} placeholder="min" aria-label="Lowest level" onChange={set('lmin')} />
          <span aria-hidden="true">–</span>
          <input type="number" min="1" max="80" inputMode="numeric" value={filters.lmax} placeholder="max" aria-label="Highest level" onChange={set('lmax')} />
        </fieldset>
      ) : null}
      {options.zones.length ? (
        <label className={`gw-filter${filters.zone ? ' is-active' : ''}`}>
          <span>Zone</span>
          <select value={filters.zone} onChange={set('zone')}>
            <option value="">Any</option>
            {options.zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </label>
      ) : null}
      {options.kinds.length > 1 ? (
        <label className={`gw-filter${filters.kind ? ' is-active' : ''}`}>
          <span>Type</span>
          <select value={filters.kind} onChange={set('kind')}>
            <option value="">Dungeons &amp; raids</option>
            <option value="dungeon">Dungeons</option>
            <option value="raid">Raids</option>
          </select>
        </label>
      ) : null}
      {options.slots.length ? (
        <label className={`gw-filter${filters.lootSlot ? ' is-active' : ''}`}>
          <span>Loot slot</span>
          <select value={filters.lootSlot} onChange={set('lootSlot')}>
            <option value="">Any</option>
            {options.slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
          </select>
        </label>
      ) : null}
      {character ? (
        <>
          <label className="gw-loot__check gw-atlas-filters__rec"><input type="checkbox" checked={Boolean(filters.rec)} onChange={set('rec')} /> Recommended for {character.name} ({recommendedCount})</label>
          <label className="gw-loot__check"><input type="checkbox" checked={Boolean(filters.wish)} onChange={set('wish')} /> Has {character.name}'s wishlist drops</label>
          {options.levels ? <label className="gw-loot__check"><input type="checkbox" checked={Boolean(filters.fit)} onChange={set('fit')} /> Right level for {character.name}</label> : null}
        </>
      ) : null}
      {active ? <button type="button" className="gw-btn gw-btn--sm" onClick={() => onChange({})}>Clear</button> : null}
    </div>
  )
}

// Explore: every dungeon the catalog knows, as a searchable grid of cards.
export default function DungeonExplore({ server, queryString = '', characters = [] }) {
  const query = useMemo(() => readAtlasQuery(queryString), [queryString])
  const mine = useMemo(() => characters.filter((entry) => onServerKey(entry, server)), [characters, server])
  const character = resolveCharacter(mine, query.character)
  const list = useDungeonList()
  const wishlist = useWishlist(character?.id || '')
  const runs = useDungeonRuns({ server, character: character?.id || '', enabled: Boolean(character) })
  const [planning, setPlanning] = useState(false)
  const wishCounts = useMemo(() => countsOf(wishlistTargets(wishlist.data?.items || [], list.dungeons)), [wishlist.data, list.dungeons])
  const history = useMemo(() => runHistory(runs.data?.runs || []), [runs.data])
  // Details of the dungeons that matter to the character (their level, or
  // their wishlist), to count the gear they can use. Bounded.
  const candidates = useMemo(() => (character ? list.dungeons
    .filter((dungeon) => levelFit(dungeon.atlas, character) === 'fit' || wishCounts.get(dungeon.instanceId) > 0)
    .map((dungeon) => dungeon.instanceId).slice(0, DETAIL_BUDGET) : []), [list.dungeons, character, wishCounts])
  const details = useDungeonDetails(candidates)
  const gear = useMemo(() => {
    const counts = new Map()
    if (!character) return counts
    for (const id of candidates) {
      const detail = details.get(id)
      if (!detail) continue
      const targets = gearTargets(dungeonItems(detail), character, detail.atlas)
      counts.set(id, { gear: targets.length, rewards: targets.filter((row) => row.sourceKind === 'quest').length })
    }
    return counts
  }, [candidates, details, character])
  const recommendations = useMemo(() => new Map(list.dungeons.map((dungeon) => [dungeon.instanceId,
    recommendDungeon(dungeon, { character, wishCount: wishCounts.get(dungeon.instanceId) || 0, usable: gear.get(dungeon.instanceId)?.gear ?? null })])), [list.dungeons, character, wishCounts, gear])
  const recommendedCount = useMemo(() => [...recommendations.values()].filter((entry) => entry.recommended).length, [recommendations])
  const options = useMemo(() => exploreOptions(list.dungeons), [list.dungeons])
  const shown = useMemo(() => filterDungeons(list.dungeons, query.filters, { character, wishCounts, recommendations }), [list.dungeons, query.filters, character, wishCounts, recommendations])

  const characterId = character?.id || ''
  const go = useCallback((next) => navigate(exploreHref({ server, character: characterId, filters: query.filters, open: query.open, section: query.section, boss: query.boss, ...next }),
    { preserveScroll: true, replace: true }), [server, characterId, query])
  const setFilters = useCallback((filters) => go({ filters }), [go])

  if (list.status === 'loading') return <SkeletonRows rows={6} label="Loading dungeons" />
  if (list.status === 'error' || list.status === 'missing') return <ErrorState>The dungeon list could not be loaded.</ErrorState>

  return (
    <div className="gw-stack gw-atlas">
      {list.fixtures ? <p className="gw-callout gw-callout--warning" role="note">Development fixture data is merged in (?atlasFixtures=1). Not real game data.</p> : null}
      <div className="gw-atlas__bar">
        <Filters filters={query.filters} options={options} characters={mine} character={character} onChange={setFilters} onCharacter={(id) => go({ character: id })} recommendedCount={recommendedCount} />
        <button type="button" className={`gw-btn gw-btn--sm${planning ? '' : ' gw-btn--primary'}`} disabled={!character} aria-expanded={planning} onClick={() => setPlanning((open) => !open)}>
          <Icon name="sparkle" size={14} /> Plan my gear
        </button>
      </div>
      {planning && character ? (
        <PlanMyGear character={character} characters={mine} onCharacter={(id) => go({ character: id })} dungeons={list.dungeons} onClose={() => setPlanning(false)} onImported={(next) => { if (next) wishlist.mutate(next) }} />
      ) : null}
      {!list.dungeons.length ? (
        <EmptyState title="No dungeons in the catalog yet." icon="dungeon">
          Dungeons appear once players loot them with Guildweaver running: run one, then <kbd>/reload</kbd> or log out.
        </EmptyState>
      ) : !shown.length ? (
        <EmptyState title="No dungeons match these filters." icon="dungeon" action={<button type="button" className="gw-btn gw-btn--sm" onClick={() => setFilters({})}>Clear filters</button>} />
      ) : (
        <>
          <p className="gw-muted gw-atlas__count" role="status">{shown.length} of {list.dungeons.length} dungeon{list.dungeons.length === 1 ? '' : 's'}</p>
          <ul className="gw-atlas-grid">
            {shown.map((dungeon) => <DungeonCard key={dungeon.instanceId} card={cardModel(dungeon, { character, wishCounts })} character={character}
              gear={gear.get(dungeon.instanceId) || null} history={history.get(dungeon)} historyKnown={runs.status === 'ready'}
              recommendation={recommendations.get(dungeon.instanceId)}
              href={exploreHref({ server, character: characterId, filters: query.filters, open: dungeon.instanceId })} />)}
          </ul>
        </>
      )}
    </div>
  )
}
