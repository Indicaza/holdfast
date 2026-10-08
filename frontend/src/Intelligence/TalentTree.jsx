import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import WowIcon from '../WowAssets/WowIcon.jsx'
import TalentTreeBackdrop from './TalentTreeBackdrop.jsx'
import './TalentTree.css'

function selectedEntry(node) {
  return node?.entries?.find((entry) => entry.selected) || node?.entries?.find((entry) => entry.isActiveEntry) || node?.entries?.[0] || null
}

function talentState(node, entry = selectedEntry(node)) {
  if (node?.selected || entry?.selected || Number(node?.rank) > 0 || Number(entry?.rank) > 0) return 'selected'
  if (node?.isAvailable === false || entry?.isAvailable === false || node?.meetsEdgeRequirements === false) return 'locked'
  return 'available'
}

function bounds(nodes) {
  if (!nodes.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  const xs = nodes.map((node) => Number(node.x) || 0)
  const ys = nodes.map((node) => Number(node.y) || 0)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    minX,
    maxX: maxX === minX ? minX + 1 : maxX,
    minY,
    maxY: maxY === minY ? minY + 1 : maxY,
  }
}

function point(node, frame) {
  const x = 7 + (((Number(node.x) || 0) - frame.minX) / (frame.maxX - frame.minX)) * 86
  const y = 16 + (((Number(node.y) || 0) - frame.minY) / (frame.maxY - frame.minY)) * 76
  return { x, y }
}

function tooltipTextColor(color) {
  if (!color || typeof color !== 'object') return undefined
  const channel = (value) => Math.max(0, Math.min(255, Math.round((Number(value) || 0) * 255)))
  const alpha = Number.isFinite(Number(color.a)) ? Math.max(0, Math.min(1, Number(color.a))) : 1
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${alpha})`
}

function TalentTooltip({ hover }) {
  if (!hover || typeof document === 'undefined' || typeof window === 'undefined') return null
  const { node, rect } = hover
  const entry = selectedEntry(node)
  const state = talentState(node, entry)
  const rank = Number(entry?.rank ?? node?.rank) || 0
  const maxRank = Number(entry?.maxRank ?? node?.maxRank) || rank || 1
  const rawLines = Array.isArray(entry?.tooltipLines) ? entry.tooltipLines : Array.isArray(entry?.tooltip?.lines) ? entry.tooltip.lines : []
  const lines = rawLines.filter((line, index) => !(index === 0 && String(line?.left || '').trim().toLowerCase() === String(entry?.name || '').trim().toLowerCase()))
  const width = 330
  const useRight = rect.right + width + 18 < window.innerWidth
  const left = useRight ? rect.right + 12 : Math.max(12, rect.left - width - 12)
  const top = Math.max(12, Math.min(rect.top - 18, window.innerHeight - 320))
  const unmet = (node?.conditions || []).filter((condition) => condition?.isMet === false)

  return createPortal(
    <aside className={`talent-tooltip talent-tooltip--${state}`} style={{ left, top, width }} role="tooltip">
      <div className="talent-tooltip__heading">
        <WowIcon
          src={entry?.mediaUrl || entry?.catalog?.metadata?.mediaUrl}
          iconFileId={entry?.iconFileId}
          spellId={entry?.spellId}
          label={entry?.name || String(node.id)}
          size={48}
        />
        <div>
          <strong>{entry?.name || `Talent node ${node.id}`}</strong>
          <span>{state === 'selected' ? `Rank ${rank}/${maxRank}` : state === 'locked' ? 'Locked' : `Available${maxRank > 1 ? ` · ${maxRank} ranks` : ''}`}</span>
        </div>
      </div>
      {lines.length ? (
        <div className="talent-tooltip__lines">
          {lines.map((line, index) => (
            <div className="talent-tooltip__line" key={`${line?.left || ''}-${line?.right || ''}-${index}`}>
              {line?.left ? <span style={{ color: tooltipTextColor(line.leftColor) }}>{line.left}</span> : <span />}
              {line?.right ? <span style={{ color: tooltipTextColor(line.rightColor) }}>{line.right}</span> : null}
            </div>
          ))}
        </div>
      ) : entry?.description ? <p>{entry.description}</p> : <p className="talent-tooltip__muted">No client tooltip was included in this snapshot.</p>}
      {unmet.length ? <small className="talent-tooltip__requirement">Requirements not met</small> : null}
    </aside>,
    document.body,
  )
}

function edgeVisualState(edge, nodesById) {
  if (edge?.active) return 'selected'
  const from = nodesById.get(edge?.from)
  const to = nodesById.get(edge?.to)
  if (from && to && talentState(from) === 'selected' && talentState(to) === 'selected') return 'selected'
  if (to && talentState(to) === 'locked') return 'locked'
  return 'available'
}

export function TalentNode({ node, position, onHover, onLeave }) {
  const entry = selectedEntry(node)
  const state = talentState(node, entry)
  const rank = Number(entry?.rank ?? node.rank) || 0
  const maxRank = Number(entry?.maxRank ?? node.maxRank) || 0
  const showTooltip = (target) => onHover?.(node, target.getBoundingClientRect())

  return (
    <button
      className={`talent-node talent-node--${state}`}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      type="button"
      onMouseEnter={(event) => showTooltip(event.currentTarget)}
      onMouseLeave={onLeave}
      onFocus={(event) => showTooltip(event.currentTarget)}
      onBlur={onLeave}
      aria-label={`${entry?.name || `Talent ${node.id}`}, ${state}${maxRank || rank ? `, rank ${rank} of ${maxRank || rank}` : ''}`}
    >
      <span className="talent-node__icon">
        <WowIcon
          src={entry?.mediaUrl || entry?.catalog?.metadata?.mediaUrl}
          iconFileId={entry?.iconFileId}
          spellId={entry?.spellId}
          label={entry?.name || String(node.id)}
          size={50}
        />
      </span>
      {maxRank || rank ? <span className="talent-node__rank">{rank}/{maxRank || rank}</span> : null}
    </button>
  )
}

export default function TalentTree({ talents }) {
  const nodes = Array.isArray(talents?.nodes) ? talents.nodes.filter((node) => node?.isVisible !== false) : []
  const edges = Array.isArray(talents?.edges) ? talents.edges : []
  const [zoom, setZoom] = useState(1)
  const [hover, setHover] = useState(null)
  const frame = useMemo(() => bounds(nodes), [nodes])
  const positions = useMemo(() => new Map(nodes.map((node) => [node.id, point(node, frame)])), [frame, nodes])
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const panelCount = Array.isArray(talents?.art?.talentTabs) && talents.art.talentTabs.length
    ? talents.art.talentTabs.length
    : nodes.length >= 12 ? 3 : 1

  if (!nodes.length) {
    return (
      <section className="talent-empty">
        <span aria-hidden="true">✦</span>
        <h3>No talent telemetry yet.</h3>
        <p>Guildweaver will fill this tree as soon as the addon submits talent nodes.</p>
      </section>
    )
  }

  return (
    <div className="talent-tree">
      <div className="talent-tree__stage">
        <div className="talent-tree__viewport">
          <div className="talent-tree__canvas" style={{ '--talent-zoom': zoom }}>
            <TalentTreeBackdrop art={talents?.art} fallbackPanelCount={panelCount} />
            <svg className="talent-tree__edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {edges.map((edge, index) => {
                const from = positions.get(edge.from)
                const to = positions.get(edge.to)
                if (!from || !to) return null
                const state = edgeVisualState(edge, nodesById)
                return <line className={`talent-tree__edge talent-tree__edge--${state}`} key={`${edge.from}-${edge.to}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
              })}
            </svg>
            {nodes.map((node) => (
              <TalentNode
                key={node.id}
                node={node}
                position={positions.get(node.id)}
                onHover={(hovered, rect) => setHover({ node: hovered, rect })}
                onLeave={() => setHover(null)}
              />
            ))}
          </div>
        </div>

        <div className="talent-tree__zoom" aria-label="Talent tree zoom">
          <button type="button" onClick={() => setZoom((value) => Math.max(0.8, Number((value - 0.1).toFixed(1))))} aria-label="Zoom out" title="Zoom out">−</button>
          <button type="button" onClick={() => setZoom((value) => Math.min(1.4, Number((value + 0.1).toFixed(1))))} aria-label="Zoom in" title="Zoom in">+</button>
        </div>
      </div>

      <TalentTooltip hover={hover} />
    </div>
  )
}
