import './CharacterStats.css'

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const BASE_RUN_SPEED = 7

const LABEL_OVERRIDES = {
  pvp: 'PvP',
  xp: 'XP',
}

const ATTRIBUTE_ORDER = ['strength', 'agility', 'stamina', 'intellect', 'spirit']

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function label(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w+/g, (word) => LABEL_OVERRIDES[word] || `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
}

function formatNumber(value) {
  const parsed = number(value)
  return parsed === null ? null : numberFormat.format(parsed)
}

function formatPercent(value) {
  const parsed = number(value)
  return parsed === null ? null : `${numberFormat.format(parsed)}%`
}

function currentMax(current, max) {
  const currentValue = formatNumber(current)
  const maxValue = formatNumber(max)
  if (!currentValue && !maxValue) return null
  return currentValue && maxValue ? `${currentValue} / ${maxValue}` : currentValue || maxValue
}

function damageRange(min, max) {
  const first = formatNumber(min)
  const second = formatNumber(max)
  if (!first && !second) return null
  return first && second ? `${first}–${second}` : first || second
}

function hasGroup(value) {
  return value && typeof value === 'object' && Object.keys(value).length > 0
}

function hasAnyValue(values) {
  return values.some((value) => value !== null && value !== undefined && value !== '')
}

function isNonZero(value) {
  const parsed = number(value)
  return parsed !== null && parsed !== 0
}

function StatRow({ name, value, hint, emphasis = false, hideZero = false }) {
  if (value === null || value === undefined || value === '') return null
  if (hideZero && !isNonZero(String(value).replace('%', ''))) return null
  return (
    <div className={`character-stat-row${emphasis ? ' character-stat-row--emphasis' : ''}`}>
      <dt>{name}</dt>
      <dd>
        <strong>{value}</strong>
        {hint ? <small>{hint}</small> : null}
      </dd>
    </div>
  )
}

function StatGroup({ title, children }) {
  return (
    <details className="character-stats__group" open>
      <summary className="character-stats__heading">
        <span className="character-stats__heading-line" aria-hidden="true" />
        <span className="character-stats__heading-title">{title}</span>
        <span className="character-stats__heading-line" aria-hidden="true" />
        <span className="character-stats__chevron" aria-hidden="true">›</span>
      </summary>
      <dl className="character-stats__rows">{children}</dl>
    </details>
  )
}

function attributeHint(attribute) {
  if (!attribute || typeof attribute !== 'object') return null
  const positive = number(attribute.positive)
  const negative = number(attribute.negative)
  const parts = []
  if (positive) parts.push(`+${formatNumber(positive)} bonus`)
  if (negative) parts.push(`${formatNumber(negative)} penalty`)
  return parts.join(' · ') || null
}

function movementPercent(movement = {}) {
  const direct = number(movement.percent ?? movement.speedPercent ?? movement.runPercent)
  if (direct !== null) return formatPercent(direct)
  const runSpeed = number(movement.runYardsPerSecond)
  if (runSpeed === null) return null
  return formatPercent((runSpeed / BASE_RUN_SPEED) * 100)
}

function ItemLevelSummary({ utility = {} }) {
  const itemLevel = utility.itemLevel || {}
  const headline = itemLevel.overall ?? itemLevel.equipped ?? itemLevel.pvp
  if (headline === null || headline === undefined) return null

  const headlineNumber = number(headline)
  const secondary = [
    ['Equipped', itemLevel.equipped],
    ['PvP', itemLevel.pvp],
  ].filter(([, value]) => {
    const parsed = number(value)
    return parsed !== null && parsed !== headlineNumber
  })

  return (
    <section className="character-stats__item-level">
      <div className="character-stats__item-level-main">
        <span>iLvl</span>
        <strong>{formatNumber(headline)}</strong>
      </div>
      {secondary.length ? (
        <dl>
          {secondary.map(([name, value]) => <StatRow key={name} name={name} value={formatNumber(value)} />)}
        </dl>
      ) : null}
    </section>
  )
}

function General({ resources = {}, utility = {} }) {
  const health = resources.health || {}
  const power = resources.power || {}
  const powerName = power.token ? label(power.token) : 'Power'

  return (
    <StatGroup title="General">
      <StatRow name="Health" value={formatNumber(health.max ?? health.current)} emphasis />
      <StatRow name={powerName} value={formatNumber(power.max ?? power.current)} emphasis />
      <StatRow name="Movement Speed" value={movementPercent(utility.movement)} />
    </StatGroup>
  )
}

function Attributes({ attributes = {} }) {
  const ordered = ATTRIBUTE_ORDER
    .filter((key) => attributes[key])
    .map((key) => [key, attributes[key]])
  const remaining = Object.entries(attributes).filter(([key]) => !ATTRIBUTE_ORDER.includes(key))

  return (
    <StatGroup title="Primary Attributes">
      {[...ordered, ...remaining].map(([key, stat]) => (
        <StatRow key={key} name={label(key)} value={formatNumber(stat?.effective ?? stat?.current)} hint={attributeHint(stat)} />
      ))}
    </StatGroup>
  )
}

function Weapons({ offense = {} }) {
  return (
    <StatGroup title="Weapons">
      <StatRow name="Damage" value={damageRange(offense.meleeDamage?.min, offense.meleeDamage?.max)} />
      <StatRow name="Main Hand Speed" value={formatNumber(offense.attackSpeed?.mainHand)} />
      <StatRow name="Off Hand Speed" value={formatNumber(offense.attackSpeed?.offHand)} hideZero />
      <StatRow name="Ranged Damage" value={damageRange(offense.rangedDamage?.min, offense.rangedDamage?.max)} />
    </StatGroup>
  )
}

function Attack({ offense = {} }) {
  return (
    <StatGroup title="Attack">
      <StatRow name="Attack Power" value={formatNumber(offense.attackPower?.effective ?? offense.attackPower?.base)} />
      <StatRow name="Critical Strike" value={formatPercent(offense.crit?.melee)} />
      <StatRow name="Hit" value={formatPercent(offense.hit?.melee)} hideZero />
      <StatRow name="Expertise" value={formatNumber(offense.expertise?.mainHand)} hideZero />
      <StatRow name="Armor Penetration" value={formatPercent(offense.armorPenetration)} hideZero />
      <StatRow name="Haste" value={formatPercent(offense.haste?.melee)} hideZero />
    </StatGroup>
  )
}

function Defense({ defense = {} }) {
  return (
    <StatGroup title="Defense">
      <StatRow name="Armor" value={formatNumber(defense.armor?.effective ?? defense.armor?.armor ?? defense.armor?.base)} />
      <StatRow name="Dodge" value={formatPercent(defense.dodge)} />
      <StatRow name="Parry" value={formatPercent(defense.parry)} hideZero />
      <StatRow name="Block" value={formatPercent(defense.block)} hideZero />
      <StatRow name="Block Value" value={formatNumber(defense.shieldBlock)} hideZero />
      <StatRow name="Defense" value={formatNumber(defense.defenseSkill?.effective ?? defense.defenseSkill?.base)} hideZero />
      <StatRow name="Resilience" value={formatPercent(defense.resilience)} hideZero />
    </StatGroup>
  )
}

function Enhancements({ utility = {}, defense = {} }) {
  const rows = [
    ['Mastery', formatPercent(utility.mastery)],
    ['Versatility', formatPercent(utility.versatility)],
    ['Leech', formatPercent(utility.leech)],
    ['Avoidance', formatPercent(utility.avoidance ?? defense.avoidance)],
  ].filter(([, value]) => isNonZero(String(value || '').replace('%', '')))

  if (!rows.length) return null

  return (
    <StatGroup title="Enhancements">
      {rows.map(([name, value]) => <StatRow key={name} name={name} value={value} />)}
    </StatGroup>
  )
}

function MoreStats({ stats = {} }) {
  const offense = stats.offense || {}
  const defense = stats.defense || {}
  const resources = stats.resources || {}
  const utility = stats.utility || {}
  const ratings = stats.ratings || {}
  const spell = offense.spell || {}
  const resistances = defense.resistances || {}
  const movement = utility.movement || {}
  const experience = utility.experience || {}

  const hasCombat = hasAnyValue([
    offense.rangedAttackPower?.effective ?? offense.rangedAttackPower?.base,
    offense.crit?.ranged,
    offense.hit?.ranged,
    offense.haste?.ranged,
    spell.healing,
    spell.hit,
    spell.penetration,
    spell.haste,
    ...(offense.weaponSkills || []).map((skill) => skill?.current),
    ...Object.values(spell.schools || {}).flatMap((school) => [school?.damage, school?.crit]),
  ])
  const hasCharacter = hasAnyValue([
    resources.powerRegen?.inactive,
    resources.powerRegen?.active,
    resources.manaRegen?.inactive,
    resources.manaRegen?.active,
    movement.runYardsPerSecond,
    movement.currentYardsPerSecond,
    experience.current,
    experience.max,
    experience.rested,
  ])

  if (!hasCombat && !hasGroup(ratings) && !hasGroup(resistances) && !hasCharacter) return null

  return (
    <details className="character-stats__advanced">
      <summary>More Stats</summary>
      <div className="character-stats__advanced-body">
        {hasCombat ? (
          <section>
            <h3>Combat</h3>
            <dl className="character-stats__rows">
              <StatRow name="Ranged Attack Power" value={formatNumber(offense.rangedAttackPower?.effective ?? offense.rangedAttackPower?.base)} />
              <StatRow name="Ranged Critical Strike" value={formatPercent(offense.crit?.ranged)} />
              <StatRow name="Ranged Hit" value={formatPercent(offense.hit?.ranged)} />
              <StatRow name="Ranged Haste" value={formatPercent(offense.haste?.ranged)} />
              <StatRow name="Spell Healing" value={formatNumber(spell.healing)} />
              <StatRow name="Spell Hit" value={formatPercent(spell.hit)} />
              <StatRow name="Spell Penetration" value={formatNumber(spell.penetration)} />
              <StatRow name="Spell Haste" value={formatPercent(spell.haste)} />
              {Object.entries(spell.schools || {}).map(([key, school]) => (
                <StatRow key={`spell-${key}`} name={`${label(key)} Spell`} value={formatNumber(school?.damage)} hint={school?.crit !== undefined ? `${formatPercent(school.crit)} crit` : null} />
              ))}
              {(offense.weaponSkills || []).map((skill) => (
                <StatRow key={`weapon-${skill.name}`} name={skill.name} value={currentMax(skill.current, skill.max)} hint={skill.modifier ? `+${formatNumber(skill.modifier)} modifier` : null} />
              ))}
            </dl>
          </section>
        ) : null}

        {hasGroup(ratings) ? (
          <section>
            <h3>Ratings</h3>
            <dl className="character-stats__rows">
              {Object.entries(ratings).map(([key, rating]) => (
                <StatRow key={key} name={label(key)} value={formatNumber(rating?.rating)} hint={rating?.bonus !== undefined ? `${formatPercent(rating.bonus)} bonus` : null} />
              ))}
            </dl>
          </section>
        ) : null}

        {hasGroup(resistances) ? (
          <section>
            <h3>Resistances</h3>
            <dl className="character-stats__rows">
              {Object.entries(resistances).map(([key, resistance]) => (
                <StatRow key={`resistance-${key}`} name={label(key)} value={formatNumber(resistance?.total ?? resistance?.base)} />
              ))}
            </dl>
          </section>
        ) : null}

        {hasCharacter ? (
          <section>
            <h3>Character</h3>
            <dl className="character-stats__rows">
              <StatRow name="Power Regeneration" value={formatNumber(resources.powerRegen?.inactive)} hint={resources.powerRegen?.active !== undefined ? `${formatNumber(resources.powerRegen.active)} active` : null} />
              <StatRow name="Mana Regeneration" value={formatNumber(resources.manaRegen?.inactive)} hint={resources.manaRegen?.active !== undefined ? `${formatNumber(resources.manaRegen.active)} while casting` : null} />
              <StatRow name="Run Speed" value={formatNumber(movement.runYardsPerSecond)} hint="yards / second" />
              <StatRow name="Current Speed" value={formatNumber(movement.currentYardsPerSecond)} hint="yards / second" />
              <StatRow name="Experience" value={currentMax(experience.current, experience.max)} hint={experience.rested ? `${formatNumber(experience.rested)} rested XP` : null} />
            </dl>
          </section>
        ) : null}
      </div>
    </details>
  )
}

function hasStats(stats) {
  return stats && typeof stats === 'object' && Object.keys(stats).some((key) => key !== 'schemaVersion' && hasGroup(stats[key]))
}

export function CharacterStatHighlights({ stats = {} }) {
  if (!hasStats(stats)) return <p className="armory-muted">No character-sheet stats were included in this snapshot.</p>
  const attributes = stats.attributes || {}
  const offense = stats.offense || {}
  const defense = stats.defense || {}
  const resources = stats.resources || {}
  const itemLevel = stats.utility?.itemLevel || {}
  const rows = [
    ['Item Level', itemLevel.overall ?? itemLevel.equipped],
    ['Health', resources.health?.max],
    ['Strength', attributes.strength?.effective ?? attributes.strength?.current],
    ['Agility', attributes.agility?.effective ?? attributes.agility?.current],
    ['Stamina', attributes.stamina?.effective ?? attributes.stamina?.current],
    ['Attack Power', offense.attackPower?.effective ?? offense.attackPower?.base],
    ['Armor', defense.armor?.effective ?? defense.armor?.armor],
    ['Melee Crit', offense.crit?.melee !== undefined ? formatPercent(offense.crit.melee) : null],
  ].filter(([, value]) => value !== null && value !== undefined)

  return (
    <dl className="armory-stats">
      {rows.slice(0, 8).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{typeof value === 'string' ? value : formatNumber(value)}</dd></div>)}
    </dl>
  )
}

export default function CharacterStats({ stats = {} }) {
  if (!hasStats(stats)) {
    return <section className="talent-empty"><span aria-hidden="true">◆</span><h3>No character-sheet telemetry yet.</h3><p>Sync this character with the current Guildweaver addon to populate live stats.</p></section>
  }

  return (
    <div className="character-stats">
      <ItemLevelSummary utility={stats.utility} />
      {hasGroup(stats.resources) || hasGroup(stats.utility?.movement) ? <General resources={stats.resources} utility={stats.utility} /> : null}
      {hasGroup(stats.attributes) ? <Attributes attributes={stats.attributes} /> : null}
      {hasGroup(stats.offense) ? <Weapons offense={stats.offense} /> : null}
      {hasGroup(stats.offense) ? <Attack offense={stats.offense} /> : null}
      {hasGroup(stats.defense) ? <Defense defense={stats.defense} /> : null}
      <Enhancements utility={stats.utility} defense={stats.defense} />
      <MoreStats stats={stats} />
    </div>
  )
}
