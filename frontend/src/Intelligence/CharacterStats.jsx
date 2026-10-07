import './CharacterStats.css'

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function label(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
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

function StatRow({ name, value, hint }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="character-stat-row">
      <dt>{name}</dt>
      <dd>
        <strong>{value}</strong>
        {hint ? <small>{hint}</small> : null}
      </dd>
    </div>
  )
}

function StatGroup({ eyebrow, title, children }) {
  return (
    <section className="character-stats__group armory-panel">
      <div className="armory-panel__heading"><span>{eyebrow}</span><h2>{title}</h2></div>
      <dl className="character-stats__rows">{children}</dl>
    </section>
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

function Resources({ resources = {} }) {
  const health = resources.health || {}
  const power = resources.power || {}
  return (
    <StatGroup eyebrow="Vitals" title="Resources">
      <StatRow name="Health" value={currentMax(health.current, health.max)} />
      <StatRow name={power.token ? label(power.token) : 'Power'} value={currentMax(power.current, power.max)} />
      <StatRow name="Power regen" value={formatNumber(resources.powerRegen?.inactive)} hint={resources.powerRegen?.active !== undefined ? `${formatNumber(resources.powerRegen.active)} active` : null} />
      <StatRow name="Mana regen" value={formatNumber(resources.manaRegen?.inactive)} hint={resources.manaRegen?.active !== undefined ? `${formatNumber(resources.manaRegen.active)} while casting` : null} />
    </StatGroup>
  )
}

function Attributes({ attributes = {} }) {
  return (
    <StatGroup eyebrow="Core" title="Attributes">
      {Object.entries(attributes).map(([key, stat]) => (
        <StatRow key={key} name={label(key)} value={formatNumber(stat?.effective ?? stat?.current)} hint={attributeHint(stat)} />
      ))}
    </StatGroup>
  )
}

function Offense({ offense = {} }) {
  const spell = offense.spell || {}
  return (
    <StatGroup eyebrow="Combat" title="Offense">
      <StatRow name="Attack power" value={formatNumber(offense.attackPower?.effective ?? offense.attackPower?.base)} />
      <StatRow name="Ranged attack power" value={formatNumber(offense.rangedAttackPower?.effective ?? offense.rangedAttackPower?.base)} />
      <StatRow name="Melee damage" value={damageRange(offense.meleeDamage?.min, offense.meleeDamage?.max)} />
      <StatRow name="Ranged damage" value={damageRange(offense.rangedDamage?.min, offense.rangedDamage?.max)} />
      <StatRow name="Main-hand speed" value={formatNumber(offense.attackSpeed?.mainHand)} hint="seconds" />
      <StatRow name="Off-hand speed" value={formatNumber(offense.attackSpeed?.offHand)} hint="seconds" />
      <StatRow name="Melee crit" value={formatPercent(offense.crit?.melee)} />
      <StatRow name="Ranged crit" value={formatPercent(offense.crit?.ranged)} />
      <StatRow name="Melee hit" value={formatPercent(offense.hit?.melee)} />
      <StatRow name="Ranged hit" value={formatPercent(offense.hit?.ranged)} />
      <StatRow name="Melee haste" value={formatPercent(offense.haste?.melee)} />
      <StatRow name="Ranged haste" value={formatPercent(offense.haste?.ranged)} />
      <StatRow name="Expertise" value={formatNumber(offense.expertise?.mainHand)} hint={offense.expertise?.mainHandPercent !== undefined ? `${formatPercent(offense.expertise.mainHandPercent)} dodge/parry reduction` : null} />
      <StatRow name="Armor penetration" value={formatPercent(offense.armorPenetration)} />
      <StatRow name="Spell healing" value={formatNumber(spell.healing)} />
      <StatRow name="Spell hit" value={formatPercent(spell.hit)} />
      <StatRow name="Spell penetration" value={formatNumber(spell.penetration)} />
      <StatRow name="Spell haste" value={formatPercent(spell.haste)} />
      {Object.entries(spell.schools || {}).map(([key, school]) => (
        <StatRow key={`spell-${key}`} name={`${label(key)} spell`} value={formatNumber(school?.damage)} hint={school?.crit !== undefined ? `${formatPercent(school.crit)} crit` : null} />
      ))}
      {(offense.weaponSkills || []).map((skill) => (
        <StatRow key={`weapon-${skill.name}`} name={skill.name} value={currentMax(skill.current, skill.max)} hint={skill.modifier ? `+${formatNumber(skill.modifier)} modifier` : null} />
      ))}
    </StatGroup>
  )
}

function Defense({ defense = {} }) {
  return (
    <StatGroup eyebrow="Survival" title="Defense">
      <StatRow name="Armor" value={formatNumber(defense.armor?.effective ?? defense.armor?.armor ?? defense.armor?.base)} />
      <StatRow name="Defense skill" value={formatNumber(defense.defenseSkill?.effective ?? defense.defenseSkill?.base)} />
      <StatRow name="Dodge" value={formatPercent(defense.dodge)} />
      <StatRow name="Parry" value={formatPercent(defense.parry)} />
      <StatRow name="Block" value={formatPercent(defense.block)} />
      <StatRow name="Shield block" value={formatNumber(defense.shieldBlock)} />
      <StatRow name="Avoidance" value={formatPercent(defense.avoidance)} />
      <StatRow name="Resilience" value={formatPercent(defense.resilience)} />
      {Object.entries(defense.resistances || {}).map(([key, resistance]) => (
        <StatRow key={`resistance-${key}`} name={`${label(key)} resistance`} value={formatNumber(resistance?.total ?? resistance?.base)} />
      ))}
    </StatGroup>
  )
}

function Ratings({ ratings = {} }) {
  return (
    <StatGroup eyebrow="Conversion" title="Ratings">
      {Object.entries(ratings).map(([key, rating]) => (
        <StatRow key={key} name={label(key)} value={formatNumber(rating?.rating)} hint={rating?.bonus !== undefined ? `${formatPercent(rating.bonus)} bonus` : null} />
      ))}
    </StatGroup>
  )
}

function Utility({ utility = {} }) {
  const movement = utility.movement || {}
  const itemLevel = utility.itemLevel || {}
  const experience = utility.experience || {}
  return (
    <StatGroup eyebrow="Character" title="Utility">
      <StatRow name="Equipped item level" value={formatNumber(itemLevel.equipped)} />
      <StatRow name="Overall item level" value={formatNumber(itemLevel.overall)} />
      <StatRow name="PvP item level" value={formatNumber(itemLevel.pvp)} />
      <StatRow name="Run speed" value={formatNumber(movement.runYardsPerSecond)} hint="yards / second" />
      <StatRow name="Current speed" value={formatNumber(movement.currentYardsPerSecond)} hint="yards / second" />
      <StatRow name="Experience" value={currentMax(experience.current, experience.max)} hint={experience.rested ? `${formatNumber(experience.rested)} rested XP` : null} />
      <StatRow name="Mastery" value={formatPercent(utility.mastery)} />
      <StatRow name="Versatility" value={formatPercent(utility.versatility)} />
      <StatRow name="Leech" value={formatPercent(utility.leech)} />
      <StatRow name="Avoidance" value={formatPercent(utility.avoidance)} />
    </StatGroup>
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
  const rows = [
    ['Health', resources.health?.max],
    ['Strength', attributes.strength?.effective ?? attributes.strength?.current],
    ['Agility', attributes.agility?.effective ?? attributes.agility?.current],
    ['Stamina', attributes.stamina?.effective ?? attributes.stamina?.current],
    ['Intellect', attributes.intellect?.effective ?? attributes.intellect?.current],
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
      {hasGroup(stats.resources) ? <Resources resources={stats.resources} /> : null}
      {hasGroup(stats.attributes) ? <Attributes attributes={stats.attributes} /> : null}
      {hasGroup(stats.offense) ? <Offense offense={stats.offense} /> : null}
      {hasGroup(stats.defense) ? <Defense defense={stats.defense} /> : null}
      {hasGroup(stats.ratings) ? <Ratings ratings={stats.ratings} /> : null}
      {hasGroup(stats.utility) ? <Utility utility={stats.utility} /> : null}
    </div>
  )
}
