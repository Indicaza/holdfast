import { useEffect, useMemo, useState } from 'react'

import WowIcon from '../WowAssets/WowIcon.jsx'
import './TalentTree.css'

function selectedEntry(node) {
  return node?.entries?.find((entry) => entry.selected) || node?.entries?.[0] || null
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
  const x = 8 + (((Number(node.x) || 0) - frame.minX) / (frame.maxX - frame.minX)) * 84
  const y = 8 + (((Number(node.y) || 0) - frame.minY) / (frame.maxY - frame.minY)) * 84
  return { x, y }
}

export function TalentNode({ node, position, active, onSelect }) {
  const entry = selectedEntry(node)
  const selected = Boolean(node.selected || entry?.selected || node.rank > 0)
  const rank = Number(entry?.rank ?? node.rank) || 0
  const maxRank = Number(entry?.maxRank ?? node.maxRank) || 0

  return (
    <button
      className={`talent-node${selected ? ' talent-node--selected' : ''}${active ? ' talent-node--active' : ''}`}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      type="button"
      onClick={() => onSelect(node)}
      aria-pressed={active}
      title={entry?.description || entry?.name || `Talent ${node.id}`}
    >
      <WowIcon
        src={entry?.mediaUrl || entry?.catalog?.metadata?.mediaUrl}
        iconFileId={entry?.iconFileId}
        spellId={entry?.spellId}
        label={entry?.name || String(node.id)}
        size={46}
      />
      {maxRank || rank ? <span className="talent-node__rank">{rank}/{maxRank || rank}</span> : null}
    </button>
  )
}

export default function TalentTree({ talents }) {
  const nodes = Array.isArray(talents?.nodes) ? talents.nodes : []
  const edges = Array.isArray(talents?.edges) ? talents.edges : []
  const [activeId, setActiveId] = useState(null)
  const [zoom, setZoom] = useState(1)
  const frame = useMemo(() => bounds(nodes), [nodes])
  const positions = useMemo(() => new Map(nodes.map((node) => [node.id, point(node, frame)])), [frame, nodes])
  const activeNode = nodes.find((node) => node.id === activeId) || nodes[0] || null
  const entry = selectedEntry(activeNode)
  const activeRank = Number(entry?.rank ?? activeNode?.rank) || 0
  const activeMaxRank = Number(entry?.maxRank ?? activeNode?.maxRank) || activeRank || 1

  useEffect(() => {
    if (!nodes.length) {
      if (activeId !== null) setActiveId(null)
      return
    }

    if (!nodes.some((node) => node.id === activeId)) {
      setActiveId(nodes[0].id)
    }
  }, [activeId, nodes])

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
      <div className="talent-tree__toolbar">
        <div>
          <strong>{talents?.name || 'Talent configuration'}</strong>
          <span>{talents?.configId ? `Config ${talents.configId}` : 'Live character build'}</span>
        </div>
        <div className="talent-tree__zoom" aria-label="Talent tree zoom">
          <button type="button" onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))} aria-label="Zoom out">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => Math.min(1.4, value + 0.1))} aria-label="Zoom in">+</button>
        </div>
      </div>

      <div className="talent-tree__viewport">
        <div className="talent-tree__canvas" style={{ '--talent-zoom': zoom }}>
          <svg className="talent-tree__edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {edges.map((edge, index) => {
              const from = positions.get(edge.from)
              const to = positions.get(edge.to)
              if (!from || !to) return null
              return <line key={`${edge.from}-${edge.to}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
            })}
          </svg>
          {nodes.map((node) => (
            <TalentNode
              key={node.id}
              node={node}
              position={positions.get(node.id)}
              active={node.id === activeNode?.id}
              onSelect={(selected) => setActiveId(selected.id)}
            />
          ))}
        </div>
      </div>

      <aside className="talent-tree__detail" aria-live="polite">
        {activeNode ? (
          <>
            <div className="talent-tree__detail-heading">
              <WowIcon
                src={entry?.mediaUrl || entry?.catalog?.metadata?.mediaUrl}
                iconFileId={entry?.iconFileId}
                spellId={entry?.spellId}
                label={entry?.name || String(activeNode.id)}
                size={52}
              />
              <div>
                <strong>{entry?.name || `Talent node ${activeNode.id}`}</strong>
                <span>{activeNode.selected || entry?.selected ? 'Selected' : 'Available'}{activeRank ? ` · Rank ${activeRank}/${activeMaxRank}` : ''}</span>
              </div>
            </div>
            <p>{entry?.description || 'No description was included in this telemetry snapshot.'}</p>
          </>
        ) : null}
      </aside>
    </div>
  )
}
