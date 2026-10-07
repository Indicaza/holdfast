import './CharacterStats.css'

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

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

function StatRow({ name, value, hint, emphasis = false }) {
  if (value === null || value === undefined || value === '') return null
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

function StatGroup({ title, children, wide = false }) {
  return (
    <section className={`character-stats__group armory-panel${wide ? ' character-stats__group--wide' : ''}`}>
      <div className="character-stats__heading"><h2>{title}</h2></div>
      <dl className="character-stats__rows">{children}</dl>
    </section>
  )
}

function AdvancedGroup({ title, description, children }) {
  return (
    <details className="character-stats__advanced armory-panel">
      <summary>
        <span>{title}</span>
        {description ? <small>{description}</small> : null}
      </summary>
      <dl className="character-stats__rows character-stats__rows--advanced">{children}</dl>
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

function ItemLevelSummary({ utility = {} }) {
  const itemLevel = utility.itemLevel || {}
  const headline = itemLevel.overall ?? itemLevel.equipped ?? itemLevel.pvp
  if (headline === null || headline === undefined) return null

  return (
    <section className="character-stats__item-level armory-panel">
      <div>
        <span>Item Level</span>
        <strong>{formatNumber(headline)}</strong>
      </div>
      <dl>
        <StatRow name="Equipped" value={formatNumber(itemLevel.equipped)} />
        <StatRow name="Overall" value={formatNumber(itemLevel.overall)} />
        <StatRow name="PvP" value={formatNumber(itemLevel.pvp)} />
      </dl>
    </section>
  )
}

function Resources({ resources = {} }) {
  const health = resources.health || {}
  const power = resources.power || {}
  const powerName = power.token ? label(power.token) : 'Power'

  return (
    <StatGroup title="Resources">
      <StatRow name="Health" value={currentMax(health.current, health.max)} emphasis />
      <StatRow name={powerName} value={currentMax(power.current, power.max)} emphasis />
    </StatGroup>
  )
}

function Attributes({ attributes = {} }) {
  const ordered = ATTRIBUTE_ORDER
    .filter((key) => attributes[key])
    .map((key) => [key, attributes[key]])
  const remaining = Object.entries(attributes).filter(([key]) => !ATTRIBUTE_ORDER.includes(key))

  return (
    <StatGroup title="Attributes">
      {[...ordered, ...remaining].map(([key, stat]) => (
        <StatRow key={key} name={label(key)} value={formatNumber(stat?.effective ?? stat?.current)} hint={attributeHint(stat)} />
      ))}
    </StatGroup>
  )
}

function Offense({ offense = {} }) {
  return (
    <StatGroup title="Offense">
      <StatRow name="Attack Power" value={formatNumber(offense.attackPower?.effective ?? offense.attackPower?.base)} />
      <StatRow name="Melee Damage" value={damageRange(offense.meleeDamage?.min, offense.meleeDamage?.max)} />
      <StatRow name="Attack Speed" value={formatNumber(offense.attackSpeed?.mainHand)} hint={offense.attackSpeed?.mainHand !== undefined ? 'seconds' : null} />
      <StatRow name="Melee Critical Strike" value={formatPercent(offense.crit?.melee)} />
      <StatRow name="Melee Hit" value={formatPercent(offense.hit?.melee)} />
      <StatRow name="Expertise" value={formatNumber(offense.expertise?.mainHand)} hint={offense.expertise?.mainHandPercent !== undefined ? `${formatPercent(offense.expertise.mainHandPercent)} dodge/parry reduction` : null} />
      <StatRow name="Armor Penetration" value={formatPercent(offense.armorPenetration)} />
    </StatGroup>
  )
}

function Defense({ defense = {} }) {
  return (
    <StatGroup title="Defense">
      <StatRow name="Armor" value={formatNumber(defense.armor?.effective ?? defense.armor?.armor ?? defense.armor?.base)} />
      <StatRow name="Defense" value={formatNumber(defense.defenseSkill?.effective ?? defense.defenseSkill?.base)} />
      <StatRow name="Dodge" value={formatPercent(defense.dodge)} />
      <StatRow name="Parry" value={formatPercent(defense.parry)} />
      <StatRow name="Block" value={formatPercent(defense.block)} />
      <StatRow name="Block Value" value={formatNumber(defense.shieldBlock)} />
      <StatRow name="Resilience" value={formatPercent(defense.resilience)} />
    </StatGroup>
  )
}

function SecondaryStats({ utility = {}, offense = {}, defense = {} }) {
  const rows = [
    ['Melee Haste', formatPercent(offense.haste?.melee)],
    ['Mastery', formatPercent(utility.mastery)],
    ['Versatility', formatPercent(utility.versatility)],
    ['Leech', formatPercent(utility.leech)],
    ['Avoidance', formatPercent(utility.avoidance ?? defense.avoidance)],
  ]
  const meaningfulRows = rows.filter(([, value]) => {
    const parsed = number(String(value || '').replace('%', ''))
    return parsed !== null && parsed !== 0
  })

  if (!meaningfulRows.length) return null

  return (
    <StatGroup title="Enhancements" wide>
      {meaningfulRows.map(([name, value]) => <StatRow key={name} name={name} value={value} />)}
    </StatGroup>
  )
}

function CombatDetails({ offense = {} }) {
  const spell = offense.spell || {}
  const values = [
    offense.rangedAttackPower?.effective ?? offense.rangedAttackPower?.base,
    offense.rangedDamage?.min,
    offense.attackSpeed?.offHand,
    offense.crit?.ranged,
    offense.hit?.ranged,
    offense.haste?.melee,
    offense.haste?.ranged,
    spell.healing,
    spell.hit,
    spell.penetration,
    spell.haste,
    ...(offense.weaponSkills || []).map((skill) => skill?.current),
    ...Object.values(spell.schools || {}).flatMap((school) => [school?.damage, school?.crit]),
  ]
  if (!hasAnyValue(values)) return null

  return (
    <AdvancedGroup title="Combat Details" description="Ranged, spell, haste, and weapon-skill telemetry">
      <StatRow name="Ranged Attack Power" value={formatNumber(offense.rangedAttackPower?.effective ?? offense.rangedAttackPower?.base)} />
      <StatRow name="Ranged Damage" value={damageRange(offense.rangedDamage?.min, offense.rangedDamage?.max)} />
      <StatRow name="Off Hand Speed" value={formatNumber(offense.attackSpeed?.offHand)} hint={offense.attackSpeed?.offHand !== undefined ? 'seconds' : null} />
      <StatRow name="Ranged Critical Strike" value={formatPercent(offense.crit?.ranged)} />
      <StatRow name="Ranged Hit" value={formatPercent(offense.hit?.ranged)} />
      <StatRow name="Melee Haste" value={formatPercent(offense.haste?.melee)} />
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
    </AdvancedGroup>
  )
}

function Ratings({ ratings = {} }) {
  if (!hasGroup(ratings)) return null
  return (
    <AdvancedGroup title="Ratings & Conversions" description="Raw combat ratings reported by the game client">
      {Object.entries(ratings).map(([key, rating]) => (
        <StatRow key={key} name={label(key)} value={formatNumber(rating?.rating)} hint={rating?.bonus !== undefined ? `${formatPercent(rating.bonus)} bonus` : null} />
      ))}
    </AdvancedGroup>
  )
}

function Resistances({ defense = {} }) {
  const resistances = defense.resistances || {}
  if (!hasGroup(resistances)) return null
  return (
    <AdvancedGroup title="Resistances" description="School-specific defensive values">
      {Object.entries(resistances).map(([key, resistance]) => (
        <StatRow key={`resistance-${key}`} name={label(key)} value={formatNumber(resistance?.total ?? resistance?.base)} />
      ))}
    </AdvancedGroup>
  )
}

function CharacterDetails({ resources = {}, utility = {}, defense = {} }) {
  const movement = utility.movement || {}
  const experience = utility.experience || {}
  const values = [
    resources.powerRegen?.inactive,
    resources.powerRegen?.active,
    resources.manaRegen?.inactive,
    resources.manaRegen?.active,
    movement.runYardsPerSecond,
    movement.currentYardsPerSecond,
    experience.current,
    experience.max,
    experience.rested,
    utility.mastery,
    utility.versatility,
    utility.leech,
    utility.avoidance,
    defense.avoidance,
  ]
  if (!hasAnyValue(values)) return null

  return (
    <AdvancedGroup title="Character Details" description="Regeneration, movement, experience, and tertiary stats">
      <StatRow name="Power Regeneration" value={formatNumber(resources.powerRegen?.inactive)} hint={resources.powerRegen?.active !== undefined ? `${formatNumber(resources.powerRegen.active)} active` : null} />
      <StatRow name="Mana Regeneration" value={formatNumber(resources.manaRegen?.inactive)} hint={resources.manaRegen?.active !== undefined ? `${formatNumber(resources.manaRegen.active)} while casting` : null} />
      <StatRow name="Run Speed" value={formatNumber(movement.runYardsPerSecond)} hint="yards / second" />
      <StatRow name="Current Speed" value={formatNumber(movement.currentYardsPerSecond)} hint="yards / second" />
      <StatRow name="Experience" value={currentMax(experience.current, experience.max)} hint={experience.rested ? `${formatNumber(experience.rested)} rested XP` : null} />
      <StatRow name="Mastery" value={formatPercent(utility.mastery)} />
      <StatRow name="Versatility" value={formatPercent(utility.versatility)} />
      <StatRow name="Leech" value={formatPercent(utility.leech)} />
      <StatRow name="Avoidance" value={formatPercent(utility.avoidance ?? defense.avoidance)} />
    </AdvancedGroup>
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
      <div className="character-stats__primary">
        {hasGroup(stats.resources) ? <Resources resources={stats.resources} /> : null}
        {hasGroup(stats.attributes) ? <Attributes attributes={stats.attributes} /> : null}
        {hasGroup(stats.offense) ? <Offense offense={stats.offense} /> : null}
        {hasGroup(stats.defense) ? <Defense defense={stats.defense} /> : null}
        <SecondaryStats utility={stats.utility} offense={stats.offense} defense={stats.defense} />
      </div>
      <div className="character-stats__more">
        <CombatDetails offense={stats.offense} />
        <Ratings ratings={stats.ratings} />
        <Resistances defense={stats.defense} />
        <CharacterDetails resources={stats.resources} utility={stats.utility} defense={stats.defense} />
      </div>
    </div>
  )
}
