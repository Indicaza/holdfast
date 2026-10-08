import { useState } from 'react'

import { FloatingTooltip } from '../WowAssets/WowIcon.jsx'
import './CharacterStats.css'

// Mirrors the WoW Forever character stat pane (Blizzard UI source, "Camelot"
// flavor: PaperDollFrameConstants.lua PAPERDOLL_STATCATEGORIES and
// CharacterFrame.lua RESISTANCE_STAT_ENTRIES): Item Level, then General,
// Primary Attributes, Weapons, Modifiers, Defense, Resistance — same rows,
// same order, same hide-at-zero rules. Tooltip text uses the game's own
// GlobalStrings (Classic Era build) and the same formulas.

const ATTACK_POWER_PER_DPS = 14 // ATTACK_POWER_MAGIC_NUMBER
const BASE_RUN_SPEED = 7

const STAT_TOOLTIPS = {
  STRENGTH: {
    DEFAULT: 'Increases attack power with melee weapons.',
    WARRIOR: 'Increases attack power with melee weapons.\nIncreases the amount of damage that can be blocked with a shield.',
    PALADIN: 'Increases attack power with melee weapons.\nIncreases the amount of damage that can be blocked with a shield.',
    SHAMAN: 'Increases attack power with melee weapons.\nIncreases the amount of damage that can be blocked with a shield.',
  },
  AGILITY: {
    DEFAULT: 'Increases attack power with ranged weapons.\nImproves chance to score a critical hit with all weapons.\nIncreases armor and chance to dodge attacks.',
    HUNTER: 'Increases attack power with both melee and ranged weapons, and improves chance to score a critical hit with all weapons.\nIncreases armor and chance to dodge attacks.',
    ROGUE: 'Increases attack power with both melee and ranged weapons, and improves the chance to score a critical hit with all weapons.\nIncreases armor and chance to dodge attacks.',
  },
  STAMINA: { DEFAULT: 'Increases health points.' },
  INTELLECT: {
    DEFAULT: 'Increases the rate at which weapon skills improve.',
    CASTER: 'Increases mana points and chance to score a critical hit with spells.\nIncreases the rate at which weapon skills improve.',
  },
  SPIRIT: { DEFAULT: 'Increases health and mana regeneration rates.' },
}
const INTELLECT_CASTERS = new Set(['DRUID', 'HUNTER', 'MAGE', 'PALADIN', 'PRIEST', 'SHAMAN', 'WARLOCK'])

const POWER_TOOLTIPS = {
  MANA: ['Mana', 'Maximum mana.  Mana is used to cast spells.'],
  RAGE: ['Rage', 'Maximum rage.  Rage is consumed when using abilities and is restored by attacking enemies or being damaged in combat.'],
  ENERGY: ['Energy', 'Maximum energy.  Energy is consumed when using abilities and is restored automatically over time.'],
  FOCUS: ['Focus', 'Maximum focus.  Focus is consumed when using abilities and is restored automatically over time.'],
}

const RESISTANCES = [
  ['arcane', 'Arcane'],
  ['fire', 'Fire'],
  ['frost', 'Frost'],
  ['nature', 'Nature'],
  ['shadow', 'Shadow'],
]

const thousands = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function big(value) {
  const parsed = number(value)
  return parsed === null ? null : thousands.format(parsed)
}

function percent(value, digits = 1) {
  const parsed = number(value)
  return parsed === null ? null : `${parsed.toFixed(digits)}%`
}

function maxOf(...values) {
  const parsed = values.flat(Infinity).map(number).filter((value) => value !== null)
  return parsed.length ? Math.max(...parsed) : null
}

function hasGroup(value) {
  return value && typeof value === 'object' && Object.keys(value).length > 0
}

function buffTone(positive, negative) {
  if ((number(negative) || 0) < 0) return 'debuffed'
  if ((number(positive) || 0) > 0) return 'buffed'
  return null
}

// PaperDollFormatStat: "Name total (base +bonus -penalty)".
function statHeadline(name, effective, positive = 0, negative = 0) {
  const pos = number(positive) || 0
  const neg = number(negative) || 0
  if (!pos && !neg) return [{ text: `${name} ${big(effective)}` }]
  const parts = [{ text: `${name} ${big(effective)} (${big(effective - pos - neg)}` }]
  if (pos) parts.push({ text: ` +${big(pos)}`, tone: 'buffed' })
  if (neg) parts.push({ text: ` ${big(neg)}`, tone: 'debuffed' })
  parts.push({ text: ')' })
  return parts
}

function damageSpan(damage) {
  const min = number(damage?.min)
  const max = number(damage?.max)
  if (!min && !max) return null
  return { min: Math.max(Math.floor(min ?? max), 1), max: Math.max(Math.ceil(max ?? min), 1) }
}

function Tooltip({ title, lines = [], pairs = [] }) {
  return (
    <div className="stat-tooltip">
      <strong className="stat-tooltip__title">
        {(Array.isArray(title) ? title : [{ text: title }]).map((part, index) => (
          <span key={index} className={part.tone ? `wow-stat__value--${part.tone}` : undefined}>{part.text}</span>
        ))}
      </strong>
      {pairs.length ? (
        <dl className="stat-tooltip__pairs">
          {pairs.map(([label, value]) => <div key={label}><dt>{label}:</dt><dd>{value}</dd></div>)}
        </dl>
      ) : null}
      {lines.filter(Boolean).map((line, index) => <p key={index} className="stat-tooltip__line">{line}</p>)}
    </div>
  )
}

function StatRow({ label, value, tone = null, icon = null, tooltip = null }) {
  const [anchor, setAnchor] = useState(null)
  const show = (event) => setAnchor(event.currentTarget.getBoundingClientRect())
  const hide = () => setAnchor(null)
  return (
    <div
      className={`wow-stat${icon ? ' wow-stat--icon' : ''}`}
      tabIndex={tooltip ? 0 : undefined}
      onMouseEnter={tooltip ? show : undefined}
      onMouseLeave={tooltip ? hide : undefined}
      onFocus={tooltip ? show : undefined}
      onBlur={tooltip ? hide : undefined}
    >
      <dt>
        {icon ? <img className="wow-stat__icon" src={icon} alt="" /> : null}
        <span>{label}:</span>
      </dt>
      <dd className={tone ? `wow-stat__value--${tone}` : undefined}>{value}</dd>
      {anchor && tooltip ? <FloatingTooltip anchor={anchor} side="left" className="stat-tooltip-frame">{tooltip}</FloatingTooltip> : null}
    </div>
  )
}

function Category({ title, children }) {
  const rows = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean)
  if (!rows.length) return null
  return (
    <section className="wow-stats__section">
      <h3 className="wow-stats__plate">{title}</h3>
      <dl>{rows}</dl>
    </section>
  )
}

function ItemLevel({ utility = {} }) {
  const [anchor, setAnchor] = useState(null)
  const itemLevel = utility.itemLevel || {}
  const equipped = number(itemLevel.equipped ?? itemLevel.overall)
  if (equipped === null) return null
  const overall = number(itemLevel.overall) ?? equipped
  const display = Math.floor(equipped * 10) / 10
  const pvp = number(itemLevel.pvp)
  const tooltip = (
    <Tooltip
      title={`Item Level ${Math.floor(overall)}${Math.floor(equipped) !== Math.floor(overall) ? `  (Equipped ${Math.floor(equipped)})` : ''}`}
      lines={['The average item level of your equipment.', pvp !== null ? `PvP Item Level: ${Math.floor(pvp)}` : null]}
    />
  )
  return (
    <section className="wow-stats__section">
      <h3 className="wow-stats__plate">Item Level</h3>
      <div
        className="wow-stats__ilvl"
        tabIndex={0}
        onMouseEnter={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setAnchor(null)}
        onFocus={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
        onBlur={() => setAnchor(null)}
      >
        {display}
        {anchor ? <FloatingTooltip anchor={anchor} side="left" className="stat-tooltip-frame">{tooltip}</FloatingTooltip> : null}
      </div>
    </section>
  )
}

export default function CharacterStats({ stats = {}, className = '', level = null }) {
  const attributes = stats?.attributes || {}
  const offense = stats?.offense || {}
  const defense = stats?.defense || {}
  const resources = stats?.resources || {}
  const utility = stats?.utility || {}
  const spell = offense.spell || {}
  const classToken = String(className || '').toUpperCase().replace(/[^A-Z]/g, '')
  const unitLevel = number(level) || 60

  if (!hasGroup(attributes) && !hasGroup(offense) && !hasGroup(defense)) {
    return <section className="talent-empty"><span aria-hidden="true">◆</span><h3>No character-sheet telemetry yet.</h3><p>Sync this character with the current Guildweaver addon to populate live stats.</p></section>
  }

  // General
  const health = number(resources.health?.max ?? resources.health?.current)
  const powerToken = String(resources.power?.token || '').toUpperCase()
  const [powerName, powerTooltip] = POWER_TOOLTIPS[powerToken] || ['Power', null]
  const power = number(resources.power?.max ?? resources.power?.current)
  const movement = utility.movement || {}
  const runPercent = number(movement.runYardsPerSecond) !== null ? (movement.runYardsPerSecond / BASE_RUN_SPEED) * 100 : null
  const swimPercent = number(movement.swimYardsPerSecond) !== null ? (movement.swimYardsPerSecond / BASE_RUN_SPEED) * 100 : null
  const flightPercent = number(movement.flightYardsPerSecond) !== null ? (movement.flightYardsPerSecond / BASE_RUN_SPEED) * 100 : null

  // Primary attributes, in UNITSTAT order.
  const attributeRows = [['STRENGTH', 'Strength'], ['AGILITY', 'Agility'], ['STAMINA', 'Stamina'], ['INTELLECT', 'Intellect'], ['SPIRIT', 'Spirit']]
    .map(([key, label]) => {
      const stat = attributes[key.toLowerCase()]
      if (!stat) return null
      const effective = number(stat.effective ?? stat.current)
      const texts = STAT_TOOLTIPS[key]
      const description = key === 'INTELLECT'
        ? (INTELLECT_CASTERS.has(classToken) ? texts.CASTER : texts.DEFAULT)
        : texts[classToken] || texts.DEFAULT
      return (
        <StatRow
          key={key}
          label={label}
          value={big(effective)}
          tone={buffTone(stat.positive, stat.negative)}
          tooltip={<Tooltip title={statHeadline(label, effective, stat.positive, stat.negative)} lines={[description]} />}
        />
      )
    })

  // Weapons
  const mainHand = damageSpan(offense.mainHandDamage || offense.mainhandDamage || offense.meleeDamage)
  const offHand = damageSpan(offense.offHandDamage || offense.offhandDamage)
  const ranged = damageSpan(offense.rangedDamage)
  const weaponRow = (key, label, span, speed) => {
    if (!span) return null
    const dps = number(speed) ? ((span.min + span.max) / 2 / speed).toFixed(1) : null
    return (
      <StatRow
        key={key}
        label={`${label} Damage`}
        value={`${span.min} - ${span.max}`}
        tooltip={<Tooltip title={label} pairs={[['Attack Speed (seconds)', number(speed) ? speed.toFixed(2) : '—'], ['Damage', `${span.min} - ${span.max}`], ...(dps ? [['DPS', dps]] : [])]} />}
      />
    )
  }
  const attackPower = offense.attackPower || {}
  const ap = number(attackPower.effective ?? attackPower.base)
  const rangedAttackPower = offense.rangedAttackPower || {}
  const rap = number(rangedAttackPower.effective ?? rangedAttackPower.base)

  // Modifiers (all hidden at 0)
  const schools = Object.entries(spell.schools || {})
  const hit = maxOf(offense.hit?.melee, offense.hit?.ranged, offense.hit?.spell, spell.hit)
  const crit = maxOf(offense.crit?.melee, offense.crit?.ranged, offense.crit?.spell, schools.map(([, school]) => school?.crit))
  const spellCrit = maxOf(offense.crit?.spell, schools.map(([, school]) => school?.crit))
  const haste = maxOf(offense.haste?.melee, offense.haste?.ranged, offense.haste?.spell, spell.haste)
  const expertise = number(offense.expertise?.mainHand ?? offense.expertise?.effective)
  const armorPen = number(offense.armorPenetration)
  const schoolDamage = schools.map(([, school]) => number(school?.damage)).filter((value) => value !== null)
  const spellPower = schoolDamage.length ? Math.min(...schoolDamage) : number(spell.power ?? spell.damage)
  const spellHealing = number(spell.healing)
  const spellPen = number(spell.penetration)

  // Defense
  const defenseSkill = defense.defenseSkill || {}
  const defenseValue = number(defenseSkill.effective ?? defenseSkill.base ?? defense.defense)
  const armor = defense.armor || {}
  const armorValue = number(armor.effective ?? armor.armor ?? armor.base)
  const armorReduction = armorValue !== null ? (armorValue / (armorValue + 400 + 85 * unitLevel)) * 100 : null

  return (
    <div className="wow-stats">
      <ItemLevel utility={utility} />

      <Category title="General">
        {health !== null ? <StatRow key="health" label="Health" value={big(health)} tooltip={<Tooltip title={`Health ${big(health)}`} lines={['Maximum health.  If your health reaches zero, you will die.']} />} /> : null}
        {power !== null ? <StatRow key="power" label={powerName} value={big(power)} tooltip={<Tooltip title={`${powerName} ${big(power)}`} lines={[powerTooltip]} />} /> : null}
        {runPercent !== null ? (
          <StatRow
            key="movement"
            label="Movement Speed"
            value={`${Math.round(runPercent)}%`}
            tooltip={<Tooltip title={`Movement Speed ${Math.round(runPercent)}%`} lines={[`Run Speed: ${Math.round(runPercent)}%`, flightPercent ? `Flight Speed: ${Math.round(flightPercent)}%` : null, swimPercent !== null ? `Swim Speed: ${Math.round(swimPercent)}%` : null]} />}
          />
        ) : null}
      </Category>

      <Category title="Primary Attributes">{attributeRows}</Category>

      <Category title="Weapons">
        {weaponRow('mainhand', 'Main Hand', mainHand, number(offense.attackSpeed?.mainHand))}
        {weaponRow('offhand', 'Off Hand', offHand, number(offense.attackSpeed?.offHand))}
        {weaponRow('ranged', 'Ranged', ranged, number(offense.attackSpeed?.ranged))}
        {ap ? (
          <StatRow
            key="ap"
            label="Attack Power"
            value={big(ap)}
            tone={buffTone(attackPower.positive, attackPower.negative)}
            tooltip={<Tooltip title={statHeadline('Melee Attack Power', ap, attackPower.positive, attackPower.negative)} lines={[`Increases damage with melee weapons by ${(Math.max(ap, 0) / ATTACK_POWER_PER_DPS).toFixed(1)} damage per second.`]} />}
          />
        ) : null}
        {rap ? (
          <StatRow
            key="rap"
            label="Ranged Attack Power"
            value={big(rap)}
            tone={buffTone(rangedAttackPower.positive, rangedAttackPower.negative)}
            tooltip={<Tooltip title={statHeadline('Ranged Attack Power', rap, rangedAttackPower.positive, rangedAttackPower.negative)} lines={[`Increases damage with ranged weapons by ${(Math.max(rap, 0) / ATTACK_POWER_PER_DPS).toFixed(1)} damage per second.`]} />}
          />
        ) : null}
      </Category>

      <Category title="Modifiers">
        {hit ? (
          <StatRow
            key="hit"
            label="Hit Chance"
            value={percent(hit)}
            tooltip={<Tooltip title={`Hit Chance ${percent(hit)}`} lines={[
              offense.hit?.melee != null ? `Increases your melee chance to hit a target of level ${unitLevel} by ${percent(offense.hit.melee, 2)}.` : null,
              offense.hit?.ranged != null ? `Increases your ranged chance to hit a target of level ${unitLevel} by ${percent(offense.hit.ranged, 2)}.` : null,
              (spell.hit ?? offense.hit?.spell) != null ? `Increases your spell chance to hit a target of level ${unitLevel} by ${percent(spell.hit ?? offense.hit?.spell, 2)}.` : null,
            ]} />}
          />
        ) : null}
        {crit ? (
          <StatRow
            key="crit"
            label="Critical Strike"
            value={percent(crit)}
            tooltip={<Tooltip title={`Critical Strike ${percent(crit)}`} pairs={[
              ...(offense.crit?.melee != null ? [['Melee', percent(offense.crit.melee, 2)]] : []),
              ...(offense.crit?.ranged != null ? [['Ranged', percent(offense.crit.ranged, 2)]] : []),
              ...(spellCrit != null ? [['Spell', percent(spellCrit, 2)]] : []),
            ]} lines={['Chance of attacks doing extra damage.']} />}
          />
        ) : null}
        {haste ? <StatRow key="haste" label="Haste" value={percent(haste)} tooltip={<Tooltip title={`Haste ${percent(haste)}`} lines={['Increases attack speed and spell casting speed.']} />} /> : null}
        {expertise ? <StatRow key="expertise" label="Expertise" value={big(expertise)} tooltip={<Tooltip title={`Expertise ${big(expertise)}`} />} /> : null}
        {armorPen ? <StatRow key="armorpen" label="Armor Penetration" value={percent(armorPen)} tooltip={<Tooltip title={`Armor Penetration ${percent(armorPen)}`} />} /> : null}
        {spellPower ? (
          <StatRow
            key="spellpower"
            label="Spell Power"
            value={big(spellPower)}
            tooltip={<Tooltip
              title={`Spell Power ${big(spellPower)}`}
              pairs={schools.filter(([, school]) => number(school?.damage) !== spellPower).map(([name, school]) => [`${name[0].toUpperCase()}${name.slice(1)}`, big(school.damage)])}
              lines={['Increases the damage and healing of spells.']}
            />}
          />
        ) : null}
        {spellHealing ? <StatRow key="spellhealing" label="Spell Healing" value={big(spellHealing)} tooltip={<Tooltip title={`Spell Healing ${big(spellHealing)}`} lines={['Increases the power of healing spells.']} />} /> : null}
        {spellPen ? <StatRow key="spellpen" label="Spell Penetration" value={big(spellPen)} tooltip={<Tooltip title={`Spell Penetration ${big(spellPen)}`} lines={[`Spell Penetration ${big(spellPen)} (Reduces enemy resistances by ${big(spellPen)})`]} />} /> : null}
      </Category>

      <Category title="Defense">
        {defenseValue !== null ? (
          <StatRow
            key="defense"
            label="Defense"
            value={big(defenseValue)}
            tone={number(defenseSkill.modifier) > 0 ? 'buffed' : number(defenseSkill.modifier) < 0 ? 'debuffed' : null}
            tooltip={<Tooltip title={statHeadline('Defense', defenseValue, Math.max(number(defenseSkill.modifier) || 0, 0), Math.min(number(defenseSkill.modifier) || 0, 0))} />}
          />
        ) : null}
        {number(defense.dodge) ? <StatRow key="dodge" label="Dodge" value={percent(defense.dodge)} tooltip={<Tooltip title={`Dodge Chance ${percent(defense.dodge, 2)}`} />} /> : null}
        {number(defense.block) ? <StatRow key="block" label="Block" value={percent(defense.block)} tooltip={<Tooltip title={`Block Chance ${percent(defense.block)}`} lines={number(defense.shieldBlock) ? [`Your block stops ${big(defense.shieldBlock)} damage.`] : []} />} /> : null}
        {number(defense.parry) ? <StatRow key="parry" label="Parry" value={percent(defense.parry)} tooltip={<Tooltip title={`Parry Chance ${percent(defense.parry, 2)}`} />} /> : null}
        {armorValue !== null ? (
          <StatRow
            key="armor"
            label="Armor"
            value={big(armorValue)}
            tone={buffTone(armor.positive, armor.negative)}
            tooltip={<Tooltip title={`Armor ${big(armorValue)}`} lines={[`Physical Damage Reduction: ${armorReduction.toFixed(2)}%`]} />}
          />
        ) : null}
      </Category>

      <Category title="Resistance">
        {RESISTANCES.map(([school, label]) => {
          const entry = defense.resistances?.[school]
          const total = number(typeof entry === 'object' ? entry?.total ?? entry?.base : entry) ?? 0
          const bonus = number(entry?.bonus) || 0
          const negative = number(entry?.negative) || 0
          // ExpectedSpellResistance: average mitigation is 75% of resistance / (level * 5).
          const expected = Math.floor(Math.min(0.75, (0.75 * total) / (unitLevel * 5)) * 100)
          return (
            <StatRow
              key={school}
              label={label}
              value={big(total)}
              icon={`/armory-art/resist-${school}.png`}
              tone={Math.abs(negative) > bonus ? 'debuffed' : bonus > Math.abs(negative) ? 'buffed' : null}
              tooltip={<Tooltip title={`${label} ${big(total)}`} lines={[`Increases the ability to resist ${school}-based attacks, spells and abilities.`, `Resistance against level ${unitLevel}: ${expected}%`]} />}
            />
          )
        })}
      </Category>
    </div>
  )
}
