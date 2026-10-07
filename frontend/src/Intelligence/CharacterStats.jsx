import './CharacterStats.css'

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function label(value) {
  let text = String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')

  if (text && text === text.toUpperCase()) text = text.toLowerCase()
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase())
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

function cleanRows(rows) {
  return rows.filter((row) => row?.value !== null && row?.value !== undefined && row?.value !== '')
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

function StatRows({ rows }) {
  const visible = cleanRows(rows)
  if (!visible.length) return null
  return (
    <dl className="character-stats__rows">
      {visible.map((row) => <StatRow key={row.name} {...row} />)}
    </dl>
  )
}

function StatSection({ title, rows }) {
  const visible = cleanRows(rows)
  if (!visible.length) return null
  return (
    <section className="character-stats__section">
      <h3>{title}</h3>
      <StatRows rows={visible} />
    </section>
  )
}

function AdvancedSection({ title, rows, children }) {
  const visible = rows ? cleanRows(rows) : []
  if (!visible.length && !children) return null
  return (
    <details className="character-stats__advanced">
      <summary>
        <span>{title}</span>
        <span className="character-stats__chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="character-stats__advanced-body">
        {visible.length ? <StatRows rows={visible} /> : null}
        {children}
      </div>
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

function attributeRows(attributes = {}) {
  const ordered = ['strength', 'agility', 'stamina', 'intellect', 'spirit']
  const seen = new Set()
  const rows = []

  for (const key of ordered) {
    const stat = attributes[key]
    if (!stat) continue
    seen.add(key)
    rows.push({
      name: label(key),
      value: formatNumber(stat?.effective ?? stat?.current),
      hint: attributeHint(stat),
    })
  }

  for (const [key, stat] of Object.entries(attributes)) {
    if (seen.has(key)) continue
    rows.push({
      name: label(key),
      value: formatNumber(stat?.effective ?? stat?.current),
      hint: attributeHint(stat),
    })
  }

  return rows
}

function bestSpellValue(schools = {}, field) {
  const values = Object.values(schools)
    .map((school) => number(school?.[field]))
    .filter((value) => value !== null)
  return values.length ? Math.max(...values) : null
}

function ItemLevelSummary({ utility = {} }) {
  const itemLevel = utility.itemLevel || {}
  const equipped = formatNumber(itemLevel.equipped)
  const overall = formatNumber(itemLevel.overall)
  const pvp = formatNumber(itemLevel.pvp)
  const primary = equipped || overall || '—'
  const meta = []
  if (overall && overall !== primary) meta.push(`Overall ${overall}`)
  if (pvp && pvp !== primary) meta.push(`PvP ${pvp}`)

  return (
    <section className="character-power-card" aria-label="Item level">
      <span>Item Level</span>
      <strong>{primary}</strong>
      <small>{meta.length ? meta.join(' · ') : equipped ? 'Equipped' : 'Not reported'}</small>
    </section>
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

  const resources = stats.resources || {}
  const attributes = stats.attributes || {}
  const offense = stats.offense || {}
  const defense = stats.defense || {}
  const ratings = stats.ratings || {}
  const utility = stats.utility || {}
  const power = resources.power || {}
  const spell = offense.spell || {}
  const spellSchools = spell.schools || {}
  const movement = utility.movement || {}
  const experience = utility.experience || {}

  const vitals = [
    {
      name: 'Health',
      value: formatNumber(resources.health?.max ?? resources.health?.current),
      hint: resources.health?.current !== undefined && resources.health?.max !== undefined && resources.health.current !== resources.health.max
        ? `${formatNumber(resources.health.current)} current`
        : null,
    },
    {
      name: power.token ? label(power.token) : 'Power',
      value: formatNumber(power.max ?? power.current),
      hint: power.current !== undefined && power.max !== undefined && power.current !== power.max
        ? `${formatNumber(power.current)} current`
        : null,
    },
  ]

  const meleeCrit = offense.crit?.melee ?? offense.crit?.ranged
  const meleeHit = offense.hit?.melee ?? offense.hit?.ranged
  const meleeHaste = offense.haste?.melee ?? offense.haste?.ranged
  const spellPower = bestSpellValue(spellSchools, 'damage')
  const spellCrit = bestSpellValue(spellSchools, 'crit')

  const offenseRows = [
    { name: 'Damage', value: damageRange(offense.meleeDamage?.min, offense.meleeDamage?.max) || damageRange(offense.rangedDamage?.min, offense.rangedDamage?.max) },
    { name: 'Attack Power', value: formatNumber(offense.attackPower?.effective ?? offense.attackPower?.base ?? offense.rangedAttackPower?.effective ?? offense.rangedAttackPower?.base) },
    { name: 'Spell Power', value: formatNumber(spellPower) },
    { name: 'Healing', value: formatNumber(spell.healing) },
    { name: 'Attack Speed', value: formatNumber(offense.attackSpeed?.mainHand), hint: offense.attackSpeed?.mainHand !== undefined ? 'seconds' : null },
    { name: 'Critical Strike', value: meleeCrit !== undefined ? formatPercent(meleeCrit) : spellCrit !== null ? formatPercent(spellCrit) : null },
    { name: 'Hit', value: meleeHit !== undefined ? formatPercent(meleeHit) : spell.hit !== undefined ? formatPercent(spell.hit) : null },
    { name: 'Haste', value: meleeHaste !== undefined ? formatPercent(meleeHaste) : spell.haste !== undefined ? formatPercent(spell.haste) : null },
  ]

  const defenseRows = [
    { name: 'Armor', value: formatNumber(defense.armor?.effective ?? defense.armor?.armor ?? defense.armor?.base) },
    { name: 'Defense', value: formatNumber(defense.defenseSkill?.effective ?? defense.defenseSkill?.base) },
    { name: 'Dodge', value: formatPercent(defense.dodge) },
    { name: 'Parry', value: formatPercent(defense.parry) },
    { name: 'Block', value: formatPercent(defense.block) },
  ]

  const spellRows = [
    { name: 'Healing', value: formatNumber(spell.healing) },
    { name: 'Spell Hit', value: formatPercent(spell.hit) },
    { name: 'Spell Penetration', value: formatNumber(spell.penetration) },
    { name: 'Spell Haste', value: formatPercent(spell.haste) },
    ...Object.entries(spellSchools).flatMap(([key, school]) => [
      { name: `${label(key)} Power`, value: formatNumber(school?.damage) },
      { name: `${label(key)} Crit`, value: formatPercent(school?.crit) },
    ]),
  ]

  const weaponRows = (offense.weaponSkills || []).map((skill) => ({
    name: skill.name || 'Weapon Skill',
    value: currentMax(skill.current, skill.max),
    hint: skill.modifier ? `+${formatNumber(skill.modifier)} modifier` : null,
  }))

  const ratingRows = [
    { name: 'Expertise', value: formatNumber(offense.expertise?.mainHand), hint: offense.expertise?.mainHandPercent !== undefined ? `${formatPercent(offense.expertise.mainHandPercent)} dodge/parry reduction` : null },
    { name: 'Armor Penetration', value: formatPercent(offense.armorPenetration) },
    { name: 'Avoidance', value: formatPercent(defense.avoidance ?? utility.avoidance) },
    { name: 'Resilience', value: formatPercent(defense.resilience) },
    { name: 'Mastery', value: formatPercent(utility.mastery) },
    { name: 'Versatility', value: formatPercent(utility.versatility) },
    { name: 'Leech', value: formatPercent(utility.leech) },
    ...Object.entries(ratings).map(([key, rating]) => ({
      name: label(key),
      value: formatNumber(rating?.rating),
      hint: rating?.bonus !== undefined ? `${formatPercent(rating.bonus)} bonus` : null,
    })),
  ]

  const resistanceRows = Object.entries(defense.resistances || {}).map(([key, resistance]) => ({
    name: label(key),
    value: formatNumber(resistance?.total ?? resistance?.base),
  }))

  const utilityRows = [
    { name: 'Shield Block', value: formatNumber(defense.shieldBlock) },
    { name: 'Off-hand Speed', value: formatNumber(offense.attackSpeed?.offHand), hint: offense.attackSpeed?.offHand !== undefined ? 'seconds' : null },
    { name: 'Ranged Damage', value: damageRange(offense.rangedDamage?.min, offense.rangedDamage?.max) },
    { name: 'Ranged Attack Power', value: formatNumber(offense.rangedAttackPower?.effective ?? offense.rangedAttackPower?.base) },
    { name: 'Run Speed', value: formatNumber(movement.runYardsPerSecond), hint: movement.runYardsPerSecond !== undefined ? 'yards / second' : null },
    { name: 'Current Speed', value: formatNumber(movement.currentYardsPerSecond), hint: movement.currentYardsPerSecond !== undefined ? 'yards / second' : null },
    { name: 'Experience', value: currentMax(experience.current, experience.max), hint: experience.rested ? `${formatNumber(experience.rested)} rested XP` : null },
    { name: 'Power Regen', value: formatNumber(resources.powerRegen?.inactive), hint: resources.powerRegen?.active !== undefined ? `${formatNumber(resources.powerRegen.active)} active` : null },
    { name: 'Mana Regen', value: formatNumber(resources.manaRegen?.inactive), hint: resources.manaRegen?.active !== undefined ? `${formatNumber(resources.manaRegen.active)} while casting` : null },
  ]

  return (
    <div className="character-stats">
      <ItemLevelSummary utility={utility} />
      <StatSection title="Vitals" rows={vitals} />
      <StatSection title="Attributes" rows={attributeRows(attributes)} />
      <StatSection title="Offense" rows={offenseRows} />
      <StatSection title="Defense" rows={defenseRows} />

      <div className="character-stats__advanced-stack">
        <p>Advanced</p>
        <AdvancedSection title="Spell Details" rows={spellRows} />
        <AdvancedSection title="Weapon Skills" rows={weaponRows} />
        <AdvancedSection title="Ratings & Secondary Stats" rows={ratingRows} />
        <AdvancedSection title="Resistances" rows={resistanceRows} />
        <AdvancedSection title="Utility & Movement" rows={utilityRows} />
      </div>
    </div>
  )
}
