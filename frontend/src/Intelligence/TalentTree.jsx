import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import WowIcon from '../WowAssets/WowIcon.jsx'
import catalog from './talentCatalog.json'
import { buildTalentLayout } from './talentLayout.js'
import './TalentTree.css'

// Icon footprint inside a grid cell, in cell units. Arrows start and end at the
// icon edge.
const ICON_HALF = 0.33

function tooltipTextColor(color) {
  if (!color || typeof color !== 'object') return undefined
  const channel = (value) => Math.max(0, Math.min(255, Math.round((Number(value) || 0) * 255)))
  const alpha = Number.isFinite(Number(color.a)) ? Math.max(0, Math.min(1, Number(color.a))) : 1
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${alpha})`
}

// Client tooltips render the talent description as a gold line. When the
// catalog has per-rank text, it replaces those lines so the tooltip always
// describes the rank the character actually has.
function isDescriptionLine(line) {
  const color = line?.leftColor
  return !line?.right && Number(color?.r) > 0.95 && Number(color?.g) > 0.7 && Number(color?.g) < 0.9 && Number(color?.b) < 0.1
}

function TalentTooltip({ hover }) {
  if (!hover || typeof document === 'undefined' || typeof window === 'undefined') return null
  const { talent, panelName, rect } = hover
  const { entry, node, rank, maxRank, state, requirements, currentRankText, nextRankText } = talent
  const rawLines = Array.isArray(entry?.tooltipLines) ? entry.tooltipLines : Array.isArray(entry?.tooltip?.lines) ? entry.tooltip.lines : []
  const rankText = rank > 0 ? currentRankText : nextRankText
  const lines = rawLines
    .filter((line, index) => !(index === 0 && String(line?.left || '').trim().toLowerCase() === String(entry?.name || '').trim().toLowerCase()))
    .filter((line) => !(rankText && isDescriptionLine(line)))
  const description = rankText || (lines.some(isDescriptionLine) ? '' : entry?.description)
  const width = 330
  const useRight = rect.right + width + 18 < window.innerWidth
  const left = useRight ? rect.right + 10 : Math.max(12, rect.left - width - 10)
  const top = Math.max(12, Math.min(rect.top - 6, window.innerHeight - 340))

  return createPortal(
    <aside className={`talent-tooltip talent-tooltip--${state}`} style={{ left, top, width }} role="tooltip">
      <header className="talent-tooltip__heading">
        <strong>{entry?.name || `Talent node ${node.id}`}</strong>
        <span className="talent-tooltip__rank">Rank {rank}/{maxRank}</span>
      </header>
      {lines.length ? (
        <div className="talent-tooltip__lines">
          {lines.map((line, index) => (
            <div className="talent-tooltip__line" key={`${line?.left || ''}-${line?.right || ''}-${index}`}>
              <span style={{ color: tooltipTextColor(line?.leftColor) }}>{line?.left || ''}</span>
              {line?.right ? <span className="talent-tooltip__right" style={{ color: tooltipTextColor(line.rightColor) }}>{line.right}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {description ? <p className="talent-tooltip__description">{description}</p> : null}
      {!lines.length && !description ? <p className="talent-tooltip__muted">No client tooltip was included in this snapshot.</p> : null}
      {rank > 0 && nextRankText ? (
        <div className="talent-tooltip__next">
          <span>Next rank:</span>
          <p className="talent-tooltip__description">{nextRankText}</p>
        </div>
      ) : null}
      {requirements.length ? (
        <ul className="talent-tooltip__requirements">
          {requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
        </ul>
      ) : null}
      <footer className="talent-tooltip__footer">{panelName}</footer>
    </aside>,
    document.body,
  )
}

export function TalentNode({ talent, onHover, onLeave }) {
  const { entry, node, rank, maxRank, state, row, col } = talent
  const showTooltip = (target) => onHover?.(talent, target.getBoundingClientRect())

  return (
    <button
      className={`talent-node talent-node--${state}`}
      style={{ gridRow: row + 1, gridColumn: col + 1 }}
      type="button"
      onMouseEnter={(event) => showTooltip(event.currentTarget)}
      onMouseLeave={onLeave}
      onFocus={(event) => showTooltip(event.currentTarget)}
      onBlur={onLeave}
      aria-label={`${entry?.name || `Talent ${node.id}`}, rank ${rank} of ${maxRank}${state === 'locked' ? ', locked' : ''}`}
    >
      <span className="talent-node__icon">
        <WowIcon
          src={entry?.mediaUrl || entry?.catalog?.metadata?.mediaUrl}
          iconFileId={entry?.iconFileId}
          spellId={entry?.spellId}
          label={entry?.name || String(node.id)}
          size={64}
        />
      </span>
      <span className="talent-node__rank">{rank}/{maxRank}</span>
    </button>
  )
}

function arrowPath({ from, to }) {
  const sx = from.col + 0.5
  const sy = from.row + 0.5
  const tx = to.col + 0.5
  const ty = to.row + 0.5
  if (from.col === to.col) {
    const dir = Math.sign(ty - sy) || 1
    return `M${sx} ${sy + dir * ICON_HALF} L${tx} ${ty - dir * (ICON_HALF + 0.04)}`
  }
  if (from.row === to.row) {
    const dir = Math.sign(tx - sx)
    return `M${sx + dir * ICON_HALF} ${sy} L${tx - dir * (ICON_HALF + 0.04)} ${ty}`
  }
  // Across then down, like the in-game elbow arrows.
  const dir = Math.sign(tx - sx)
  return `M${sx + dir * ICON_HALF} ${sy} L${tx} ${sy} L${tx} ${ty - (ICON_HALF + 0.04)}`
}

function TalentPanel({ panel, rows, pointsTotal, onHover, onLeave }) {
  const markerId = `talent-arrow-${panel.key}`
  return (
    <section
      className={`talent-panel${panel.points ? ' talent-panel--invested' : ''}`}
      style={panel.background ? { '--talent-art': `url(${panel.background})` } : undefined}
      aria-label={`${panel.name} talents, ${panel.points} points`}
    >
      <header className="talent-panel__header">
        <span className="talent-panel__icon">
          {panel.icon ? <img src={panel.icon} alt="" /> : <span aria-hidden="true">✦</span>}
        </span>
        <h3>{panel.name}</h3>
        <span className="talent-panel__points">
          <b>{panel.points}</b>{pointsTotal !== null ? ` / ${pointsTotal}` : ''}
        </span>
      </header>
      <div className="talent-panel__board" style={{ '--talent-rows': rows }}>
        <svg className="talent-tree__edges" viewBox={`0 0 4 ${rows}`} aria-hidden="true">
          <defs>
            {['active', 'inactive'].map((variant) => (
              <marker key={variant} id={`${markerId}-${variant}`} viewBox="0 0 10 10" refX="4" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" className={`talent-arrow__head talent-arrow__head--${variant}`} />
              </marker>
            ))}
          </defs>
          {panel.edges.map((edge) => (
            <path
              key={edge.key}
              className={`talent-arrow talent-arrow--${edge.active ? 'active' : 'inactive'}`}
              d={arrowPath(edge)}
              markerEnd={`url(#${markerId}-${edge.active ? 'active' : 'inactive'})`}
            />
          ))}
        </svg>
        {panel.nodes.map((talent) => (
          <TalentNode
            key={talent.node.id}
            talent={talent}
            onHover={(hovered, rect) => onHover({ talent: hovered, panelName: panel.name, rect })}
            onLeave={onLeave}
          />
        ))}
      </div>
    </section>
  )
}

export default function TalentTree({ talents, className, level }) {
  const [hover, setHover] = useState(null)
  const layout = useMemo(() => buildTalentLayout(talents, { className, level, catalog }), [talents, className, level])

  if (!layout) {
    return (
      <section className="talent-empty">
        <span aria-hidden="true">✦</span>
        <h3>No talent telemetry yet.</h3>
        <p>Guildweaver will fill this tree as soon as the addon submits talent nodes.</p>
      </section>
    )
  }

  const build = layout.panels.map((panel) => panel.points).join(' / ')

  return (
    <div className="talent-tree">
      <div className="talent-tree__viewport">
        <div className="talent-tree__panels" style={{ '--talent-rows': layout.rows }}>
          {layout.panels.map((panel) => (
            <TalentPanel
              key={panel.key}
              panel={panel}
              rows={layout.rows}
              pointsTotal={layout.pointsTotal}
              onHover={setHover}
              onLeave={() => setHover(null)}
            />
          ))}
        </div>
      </div>
      <footer className="talent-tree__summary">
        <span>{layout.className ? `${layout.className} talents` : 'Talents'}</span>
        <b className="talent-tree__build">{build}</b>
        {layout.pointsLeft !== null ? (
          <span>Unspent points: <b className={layout.pointsLeft ? 'talent-tree__left' : ''}>{layout.pointsLeft}</b></span>
        ) : null}
      </footer>
      <TalentTooltip hover={hover} />
    </div>
  )
}
