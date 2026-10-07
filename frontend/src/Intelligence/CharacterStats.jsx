import './CharacterStats.css'

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const BASE_RUN_SPEED = 7

const LABEL_OVERRIDES = {
  pvp: 'PvP',
  xp: 'XP',
}

const ATTRIBUTE_ORDER = ['strength', 'agility', 'stamina', 'intellect', 'spirit']
const RESISTANCE_ORDER = ['arcane', 'fire', 'frost', 'nature', 'shadow']

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

function maxNumber(...values) {
  const parsed = values.flat(Infinity).map(number).filter((value) => value !== null)
  return parsed.length ? Math.max(...parsed) : null
}

function damageRangeHasValue(damage = {}) {
  return isNonZero(damage?.min) || isNonZero(damage?.max)
}

function resistanceValue(resistances = {}, key) {
  const entry = resistances[key]
  if (entry === null || entry === undefined) return 0
  if (typeof entry !== 'object') return number(entry) ?? 0
  return number(entry.total ?? entry.effective ?? entry.current ?? entry.base) ?? 0
}

function StatRow({ name, value, hint, emphasis = false, hideZero = false, icon = null }) {
  if (value === null || value === undefined || value === '') return null
  if (hideZero && !isNonZero(String(value).replace('%', ''))) return null
  return (
    <div className={`character-stat-row${emphasis ? ' character-stat-row--emphasis' : ''}${icon ? ' character-stat-row--icon' : ''}`}>
      <dt>
        {icon}
        <span>{name}</span>
      </dt>
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

function ResistanceIcon({ school }) {
  return (
    <span className={`character-resistance-icon character-resistance-icon--${school}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {school === 'arcane' ? <path d="M12 2.5l1.8 6.1 5.7-2.8-3.5 5.3 5.5 2.2-6.3.8.8 6.4-4-5-4 5 .8-6.4-6.3-.8 5.5-2.2-3.5-5.3 5.7 2.8z" /> : null}
        {school === 'fire' ? <path d="M13.8 2.2c.8 4.4-2.9 5.8-1.3 9.1 1.1-1.8 2.9-2.9 4.7-3.4.2 1.2.3 2.2.3 3.2 0 5.5-3 9.7-7.1 9.7-3.3 0-5.9-2.6-5.9-6.1 0-3 1.8-5.5 4.5-7.7-.1 2.6.5 4.2 1.6 5.2-.4-4.1 1.3-7.4 3.2-10z" /> : null}
        {school === 'frost' ? <path d="M11 2h2v7.1l4.9-4.9 1.4 1.4-4.9 4.9H22v2h-7.6l4.9 4.9-1.4 1.4-4.9-4.9V22h-2v-8.1l-4.9 4.9-1.4-1.4 4.9-4.9H2v-2h7.6L4.7 5.6l1.4-1.4L11 9.1z" /> : null}
        {school === 'nature' ? <path d="M20.6 3.4C13 3.2 7.2 5.4 4.4 9.8c-2.2 3.5-1.3 7.2.6 9.6 1.8-4.5 5.2-8.1 10.3-10.8-4 3.4-6.7 7.1-8.1 11.2 3.3.8 7.2-.4 9.3-3.4 2.6-3.7 2.2-8.3 4.1-13z" /> : null}
        {school === 'shadow' ? <path d="M17.8 3.1a9.4 9.4 0 1 0 2.9 14.3 8 8 0 1 1-2.9-14.3zm-2.1 5.1 1.2 2.4 2.7.4-1.9 1.9.4 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z" /> : null}
      </svg>
    </span>
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
  const mainHand = offense.mainHandDamage || offense.mainhandDamage || offense.meleeDamage || {}
  const offHand = offense.offHandDamage || offense.offhandDamage || offense.meleeDamage?.offHand || offense.meleeDamage?.offhand || {}
  const ranged = offense.rangedDamage || {}

  return (
    <StatGroup title="Weapons">
      <StatRow name="Main Hand" value={damageRange(mainHand.min, mainHand.max)} />
      {damageRangeHasValue(offHand) ? <StatRow name="Off Hand" value={damageRange(offHand.min, offHand.max)} /> : null}
      {damageRangeHasValue(ranged) ? <StatRow name="Ranged" value={damageRange(ranged.min, ranged.max)} /> : null}
      <StatRow name="Attack Power" value={formatNumber(offense.attackPower?.effective ?? offense.attackPower?.base)} hideZero />
      <StatRow name="Ranged Attack Power" value={formatNumber(offense.rangedAttackPower?.effective ?? offense.rangedAttackPower?.base)} hideZero />
    </StatGroup>
  )
}

function Modifiers({ offense = {} }) {
  const spell = offense.spell || {}
  const schoolValues = Object.values(spell.schools || {})
  const hit = maxNumber(offense.hit?.melee, offense.hit?.ranged, offense.hit?.spell, spell.hit)
  const crit = maxNumber(offense.crit?.melee, offense.crit?.ranged, offense.crit?.spell, schoolValues.map((school) => school?.crit))
  const haste = maxNumber(offense.haste?.melee, offense.haste?.ranged, offense.haste?.spell, spell.haste)
  const spellPower = maxNumber(spell.power, spell.damage, schoolValues.map((school) => school?.damage))

  return (
    <StatGroup title="Modifiers">
      <StatRow name="Hit Chance" value={formatPercent(hit)} hideZero />
      <StatRow name="Critical Strike" value={formatPercent(crit)} hideZero />
      <StatRow name="Haste" value={formatPercent(haste)} hideZero />
      <StatRow name="Expertise" value={formatNumber(offense.expertise?.mainHand ?? offense.expertise?.effective)} hideZero />
      <StatRow name="Armor Penetration" value={formatPercent(offense.armorPenetration)} hideZero />
      <StatRow name="Spell Power" value={formatNumber(spellPower)} hideZero />
      <StatRow name="Spell Healing" value={formatNumber(spell.healing)} hideZero />
      <StatRow name="Spell Penetration" value={formatNumber(spell.penetration)} hideZero />
    </StatGroup>
  )
}

function Defense({ defense = {} }) {
  return (
    <StatGroup title="Defense">
      <StatRow name="Defense" value={formatNumber(defense.defenseSkill?.effective ?? defense.defenseSkill?.base ?? defense.defense)} />
      <StatRow name="Dodge" value={formatPercent(defense.dodge)} hideZero />
      <StatRow name="Block" value={formatPercent(defense.block)} hideZero />
      <StatRow name="Parry" value={formatPercent(defense.parry)} hideZero />
      <StatRow name="Armor" value={formatNumber(defense.armor?.effective ?? defense.armor?.armor ?? defense.armor?.base)} />
    </StatGroup>
  )
}

function Resistances({ resistances = {} }) {
  return (
    <StatGroup title="Resistances">
      {RESISTANCE_ORDER.map((school) => (
        <StatRow
          key={school}
          name={label(school)}
          value={formatNumber(resistanceValue(resistances, school))}
          icon={<ResistanceIcon school={school} />}
        />
      ))}
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
  const movement = utility.movement || {}
  const experience = utility.experience || {}

  const hasCombat = hasAnyValue([
    offense.attackSpeed?.mainHand,
    offense.attackSpeed?.offHand,
    offense.crit?.ranged,
    offense.hit?.ranged,
    offense.haste?.ranged,
    ...(offense.weaponSkills || []).map((skill) => skill?.current),
    ...Object.values(spell.schools || {}).flatMap((school) => [school?.damage, school?.crit]),
  ])
  const hasOther = hasAnyValue([
    utility.mastery,
    utility.versatility,
    utility.leech,
    utility.avoidance ?? defense.avoidance,
    defense.shieldBlock,
    defense.resilience,
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

  if (!hasCombat && !hasGroup(ratings) && !hasOther && !hasCharacter) return null

  return (
    <details className="character-stats__advanced">
      <summary>More Stats</summary>
      <div className="character-stats__advanced-body">
        {hasCombat ? (
          <section>
            <h3>Combat Details</h3>
            <dl className="character-stats__rows">
              <StatRow name="Main Hand Speed" value={formatNumber(offense.attackSpeed?.mainHand)} />
              <StatRow name="Off Hand Speed" value={formatNumber(offense.attackSpeed?.offHand)} hideZero />
              <StatRow name="Ranged Critical Strike" value={formatPercent(offense.crit?.ranged)} />
              <StatRow name="Ranged Hit" value={formatPercent(offense.hit?.ranged)} />
              <StatRow name="Ranged Haste" value={formatPercent(offense.haste?.ranged)} />
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

        {hasOther ? (
          <section>
            <h3>Other</h3>
            <dl className="character-stats__rows">
              <StatRow name="Mastery" value={formatPercent(utility.mastery)} hideZero />
              <StatRow name="Versatility" value={formatPercent(utility.versatility)} hideZero />
              <StatRow name="Leech" value={formatPercent(utility.leech)} hideZero />
              <StatRow name="Avoidance" value={formatPercent(utility.avoidance ?? defense.avoidance)} hideZero />
              <StatRow name="Block Value" value={formatNumber(defense.shieldBlock)} hideZero />
              <StatRow name="Resilience" value={formatPercent(defense.resilience)} hideZero />
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
      {hasGroup(stats.offense) ? <Modifiers offense={stats.offense} /> : null}
      {hasGroup(stats.defense) ? <Defense defense={stats.defense} /> : null}
      <Resistances resistances={stats.defense?.resistances} />
      <MoreStats stats={stats} />
    </div>
  )
}
