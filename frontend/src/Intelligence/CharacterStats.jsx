import './CharacterStats.css'

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function label(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = /^[A-Z0-9_ -]+$/.test(raw) ? raw.toLowerCase() : raw
  return normalized
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

function present(value) {
  return value !== null && value !== undefined && value !== ''
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

function StatRow({ name, value, hint }) {
  if (!present(value)) return null
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

function StatSection({ title, children }) {
  return (
    <section className="character-stats__section">
      <h3>{title}</h3>
      <dl className="character-stats__rows">{children}</dl>
    </section>
  )
}

function Accordion({ title, subtitle, children }) {
  return (
    <details className="character-stats__accordion">
      <summary>
        <span>{title}</span>
        {subtitle ? <small>{subtitle}</small> : null}
      </summary>
      <dl className="character-stats__rows character-stats__rows--advanced">{children}</dl>
    </details>
  )
}

function PrimaryPower({ stats }) {
  const resources = stats.resources || {}
  const offense = stats.offense || {}
  const defense = stats.defense || {}
  const utility = stats.utility || {}
  const power = resources.power || {}
  const itemLevel = utility.itemLevel || {}
  const spellSchools = Object.values(offense.spell?.schools || {})
  const spellPower = spellSchools
    .map((school) => number(school?.damage))
    .filter((value) => value !== null)
    .sort((a, b) => b - a)[0]
  const attackPower = offense.attackPower?.effective ?? offense.attackPower?.base
  const rangedAttackPower = offense.rangedAttackPower?.effective ?? offense.rangedAttackPower?.base
  const primaryPower = attackPower ?? rangedAttackPower ?? spellPower ?? offense.spell?.healing
  const primaryPowerLabel = attackPower !== undefined
    ? 'Attack Power'
    : rangedAttackPower !== undefined
      ? 'Ranged Attack Power'
      : spellPower !== undefined
        ? 'Spell Power'
        : offense.spell?.healing !== undefined
          ? 'Healing Power'
          : 'Power'
  const crit = offense.crit?.melee ?? offense.crit?.ranged ?? spellSchools.find((school) => school?.crit !== undefined)?.crit
  const itemLevelValue = itemLevel.overall ?? itemLevel.equipped
  const itemLevelHint = itemLevel.equipped !== undefined && itemLevel.overall !== itemLevel.equipped
    ? `${formatNumber(itemLevel.equipped)} equipped`
    : itemLevel.equipped !== undefined
      ? 'equipped'
      : null

  const cards = [
    ['Item Level', formatNumber(itemLevelValue), itemLevelHint, 'item-level'],
    ['Health', formatNumber(resources.health?.max ?? resources.health?.current), null, 'health'],
    [power.token ? label(power.token) : 'Power', currentMax(power.current, power.max), null, 'resource'],
    ['Armor', formatNumber(defense.armor?.effective ?? defense.armor?.armor ?? defense.armor?.base), null, 'armor'],
    [primaryPowerLabel, formatNumber(primaryPower), null, 'power'],
    ['Critical Strike', formatPercent(crit), null, 'crit'],
  ].filter(([, value]) => present(value))

  if (!cards.length) return null

  return (
    <section className="character-power" aria-label="Character power summary">
      <div className="character-power__heading">
        <span>Character</span>
        <strong>Power</strong>
      </div>
      <div className="character-power__grid">
        {cards.map(([name, value, hint, kind]) => (
          <div key={name} className={`character-power__stat character-power__stat--${kind}`}>
            <span>{name}</span>
            <strong>{value}</strong>
            {hint ? <small>{hint}</small> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function Attributes({ attributes = {} }) {
  const order = ['strength', 'agility', 'stamina', 'intellect', 'spirit']
  return (
    <StatSection title="Attributes">
      {order.map((key) => {
        const stat = attributes[key]
        return stat ? (
          <StatRow
            key={key}
            name={label(key)}
            value={formatNumber(stat.effective ?? stat.current)}
            hint={attributeHint(stat)}
          />
        ) : null
      })}
    </StatSection>
  )
}

function Offense({ offense = {} }) {
  const spell = offense.spell || {}
  const schoolCrit = Object.values(spell.schools || {}).find((school) => school?.crit !== undefined)?.crit
  const rows = [
    ['Attack Power', formatNumber(offense.attackPower?.effective ?? offense.attackPower?.base)],
    ['Ranged Attack Power', formatNumber(offense.rangedAttackPower?.effective ?? offense.rangedAttackPower?.base)],
    ['Melee Damage', damageRange(offense.meleeDamage?.min, offense.meleeDamage?.max)],
    ['Ranged Damage', damageRange(offense.rangedDamage?.min, offense.rangedDamage?.max)],
    ['Critical Strike', formatPercent(offense.crit?.melee ?? offense.crit?.ranged ?? schoolCrit)],
    ['Hit Chance', formatPercent(offense.hit?.melee ?? offense.hit?.ranged ?? spell.hit)],
    ['Haste', formatPercent(offense.haste?.melee ?? offense.haste?.ranged ?? spell.haste)],
  ].filter(([, value]) => present(value))

  if (!rows.length) return null
  return (
    <StatSection title="Offense">
      {rows.map(([name, value]) => <StatRow key={name} name={name} value={value} />)}
    </StatSection>
  )
}

function Defense({ defense = {} }) {
  const rows = [
    ['Armor', formatNumber(defense.armor?.effective ?? defense.armor?.armor ?? defense.armor?.base)],
    ['Defense', formatNumber(defense.defenseSkill?.effective ?? defense.defenseSkill?.base)],
    ['Dodge', formatPercent(defense.dodge)],
    ['Parry', formatPercent(defense.parry)],
    ['Block', formatPercent(defense.block)],
  ].filter(([, value]) => present(value))

  if (!rows.length) return null
  return (
    <StatSection title="Defense">
      {rows.map(([name, value]) => <StatRow key={name} name={name} value={value} />)}
    </StatSection>
  )
}

function AdvancedStats({ stats }) {
  const resources = stats.resources || {}
  const offense = stats.offense || {}
  const spell = offense.spell || {}
  const defense = stats.defense || {}
  const ratings = stats.ratings || {}
  const utility = stats.utility || {}
  const movement = utility.movement || {}
  const itemLevel = utility.itemLevel || {}
  const experience = utility.experience || {}

  const combatRows = [
    ['Main-Hand Speed', formatNumber(offense.attackSpeed?.mainHand), 'seconds'],
    ['Off-Hand Speed', formatNumber(offense.attackSpeed?.offHand), 'seconds'],
    ['Melee Crit', formatPercent(offense.crit?.melee)],
    ['Ranged Crit', formatPercent(offense.crit?.ranged)],
    ['Melee Hit', formatPercent(offense.hit?.melee)],
    ['Ranged Hit', formatPercent(offense.hit?.ranged)],
    ['Melee Haste', formatPercent(offense.haste?.melee)],
    ['Ranged Haste', formatPercent(offense.haste?.ranged)],
    ['Expertise', formatNumber(offense.expertise?.mainHand), offense.expertise?.mainHandPercent !== undefined ? `${formatPercent(offense.expertise.mainHandPercent)} dodge/parry reduction` : null],
    ['Armor Penetration', formatPercent(offense.armorPenetration)],
    ['Spell Healing', formatNumber(spell.healing)],
    ['Spell Hit', formatPercent(spell.hit)],
    ['Spell Penetration', formatNumber(spell.penetration)],
    ['Spell Haste', formatPercent(spell.haste)],
    ['Shield Block', formatNumber(defense.shieldBlock)],
    ['Avoidance', formatPercent(defense.avoidance)],
    ['Resilience', formatPercent(defense.resilience)],
  ].filter(([, value]) => present(value))

  const regenRows = [
    ['Power Regen', formatNumber(resources.powerRegen?.inactive), resources.powerRegen?.active !== undefined ? `${formatNumber(resources.powerRegen.active)} active` : null],
    ['Mana Regen', formatNumber(resources.manaRegen?.inactive), resources.manaRegen?.active !== undefined ? `${formatNumber(resources.manaRegen.active)} while casting` : null],
  ].filter(([, value]) => present(value))

  const utilityRows = [
    ['Overall Item Level', formatNumber(itemLevel.overall)],
    ['PvP Item Level', formatNumber(itemLevel.pvp)],
    ['Run Speed', formatNumber(movement.runYardsPerSecond), 'yards / second'],
    ['Current Speed', formatNumber(movement.currentYardsPerSecond), 'yards / second'],
    ['Experience', currentMax(experience.current, experience.max), experience.rested ? `${formatNumber(experience.rested)} rested XP` : null],
    ['Mastery', formatPercent(utility.mastery)],
    ['Versatility', formatPercent(utility.versatility)],
    ['Leech', formatPercent(utility.leech)],
    ['Avoidance', formatPercent(utility.avoidance)],
  ].filter(([, value]) => present(value))

  const spellSchools = Object.entries(spell.schools || {})
  const weaponSkills = offense.weaponSkills || []
  const resistanceRows = Object.entries(defense.resistances || {})
  const ratingRows = Object.entries(ratings)

  const accordions = []
  if (combatRows.length || regenRows.length) accordions.push(
    <Accordion key="combat" title="Combat Details" subtitle="Speeds, regen, expertise and secondary combat values">
      {combatRows.map(([name, value, hint]) => <StatRow key={name} name={name} value={value} hint={hint} />)}
      {regenRows.map(([name, value, hint]) => <StatRow key={name} name={name} value={value} hint={hint} />)}
    </Accordion>,
  )
  if (spellSchools.length) accordions.push(
    <Accordion key="spells" title="Spell Schools" subtitle="School damage and critical strike values">
      {spellSchools.map(([key, school]) => (
        <StatRow
          key={key}
          name={label(key)}
          value={formatNumber(school?.damage)}
          hint={school?.crit !== undefined ? `${formatPercent(school.crit)} crit` : null}
        />
      ))}
    </Accordion>,
  )
  if (weaponSkills.length) accordions.push(
    <Accordion key="weapons" title="Weapon Skills" subtitle="Current weapon proficiency">
      {weaponSkills.map((skill) => (
        <StatRow
          key={skill.name}
          name={skill.name}
          value={currentMax(skill.current, skill.max)}
          hint={skill.modifier ? `+${formatNumber(skill.modifier)} modifier` : null}
        />
      ))}
    </Accordion>,
  )
  if (ratingRows.length) accordions.push(
    <Accordion key="ratings" title="Combat Ratings" subtitle="Raw ratings and converted bonuses">
      {ratingRows.map(([key, rating]) => (
        <StatRow
          key={key}
          name={label(key)}
          value={formatNumber(rating?.rating)}
          hint={rating?.bonus !== undefined ? `${formatPercent(rating.bonus)} bonus` : null}
        />
      ))}
    </Accordion>,
  )
  if (resistanceRows.length) accordions.push(
    <Accordion key="resistances" title="Resistances" subtitle="Magic-school resistance values">
      {resistanceRows.map(([key, resistance]) => (
        <StatRow key={key} name={label(key)} value={formatNumber(resistance?.total ?? resistance?.base)} />
      ))}
    </Accordion>,
  )
  if (utilityRows.length) accordions.push(
    <Accordion key="utility" title="Other" subtitle="Movement, progression and uncommon stats">
      {utilityRows.map(([name, value, hint]) => <StatRow key={name} name={name} value={value} hint={hint} />)}
    </Accordion>,
  )

  if (!accordions.length) return null
  return <section className="character-stats__advanced"><h3>More Stats</h3>{accordions}</section>
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
  const utility = stats.utility || {}
  const rows = [
    ['Item Level', utility.itemLevel?.overall ?? utility.itemLevel?.equipped],
    ['Health', resources.health?.max],
    ['Strength', attributes.strength?.effective ?? attributes.strength?.current],
    ['Agility', attributes.agility?.effective ?? attributes.agility?.current],
    ['Stamina', attributes.stamina?.effective ?? attributes.stamina?.current],
    ['Attack Power', offense.attackPower?.effective ?? offense.attackPower?.base],
    ['Armor', defense.armor?.effective ?? defense.armor?.armor],
    ['Crit', offense.crit?.melee !== undefined ? formatPercent(offense.crit.melee) : null],
  ].filter(([, value]) => present(value))

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
    <div className="character-stats character-stats--sheet">
      <PrimaryPower stats={stats} />
      {hasGroup(stats.attributes) ? <Attributes attributes={stats.attributes} /> : null}
      {hasGroup(stats.offense) ? <Offense offense={stats.offense} /> : null}
      {hasGroup(stats.defense) ? <Defense defense={stats.defense} /> : null}
      <AdvancedStats stats={stats} />
    </div>
  )
}
