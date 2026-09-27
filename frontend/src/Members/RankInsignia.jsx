import './RankInsignia.css'

const ENLISTED = {
  Private: { chevrons: 1, rockers: 0, center: null },
  Corporal: { chevrons: 2, rockers: 0, center: 'swords' },
  Sergeant: { chevrons: 3, rockers: 0, center: 'swords' },
  'Master Sergeant': { chevrons: 3, rockers: 3, center: 'star' },
  'Sergeant Major': { chevrons: 3, rockers: 4, center: 'star' },
}

function Chevron({ index }) {
  const y = 17 + index * 12

  return (
    <polyline
      points={`25,${y} 60,${y + 17} 95,${y}`}
      className="rank-insignia__stroke"
    />
  )
}

function Rocker({ index, count }) {
  const y = 88 + index * 8 - Math.max(0, count - 3) * 4

  return (
    <path
      d={`M 28 ${y} Q 60 ${y + 17} 92 ${y}`}
      className="rank-insignia__stroke"
    />
  )
}

function CrossedSwords() {
  return (
    <g className="rank-insignia__stroke rank-insignia__swords">
      <path d="M 43 61 L 78 89" />
      <path d="M 77 61 L 42 89" />
      <path d="M 39 86 L 47 94" />
      <path d="M 81 86 L 73 94" />
      <path d="M 38 90 L 46 82" />
      <path d="M 82 90 L 74 82" />
    </g>
  )
}

function Star() {
  return (
    <polygon
      className="rank-insignia__fill"
      points="60,55 65,68 79,68 68,76 72,90 60,82 48,90 52,76 41,68 55,68"
    />
  )
}

function EnlistedInsignia({ rank }) {
  if (rank === 'Recruit') {
    return (
      <g>
        <circle
          cx="60"
          cy="58"
          r="21"
          className="rank-insignia__ghost"
        />
        <path
          d="M 48 64 L 60 48 L 72 64"
          className="rank-insignia__stroke rank-insignia__recruit"
        />
      </g>
    )
  }

  const config = ENLISTED[rank] || ENLISTED.Private

  return (
    <>
      {Array.from({ length: config.chevrons }, (_, index) => (
        <Chevron key={`chevron-${index}`} index={index} />
      ))}

      {config.center === 'swords' ? <CrossedSwords /> : null}
      {config.center === 'star' ? <Star /> : null}

      {Array.from({ length: config.rockers }, (_, index) => (
        <Rocker
          key={`rocker-${index}`}
          index={index}
          count={config.rockers}
        />
      ))}
    </>
  )
}

function OfficerInsignia({ rank }) {
  if (rank === 'Lieutenant') {
    return (
      <rect
        x="48"
        y="28"
        width="24"
        height="60"
        rx="2"
        className="rank-insignia__officer-fill"
      />
    )
  }

  if (rank === 'Captain') {
    return (
      <>
        <rect
          x="34"
          y="28"
          width="19"
          height="60"
          rx="2"
          className="rank-insignia__officer-fill"
        />
        <rect
          x="67"
          y="28"
          width="19"
          height="60"
          rx="2"
          className="rank-insignia__officer-fill"
        />
      </>
    )
  }

  if (rank === 'Major') {
    return (
      <path
        d="M60 18 C43 27 34 43 36 61 C38 79 48 92 60 101 C72 92 82 79 84 61 C86 43 77 27 60 18 Z M60 27 C58 46 58 66 60 92 M60 44 C50 42 44 38 39 33 M60 57 C72 54 78 48 82 41 M60 69 C49 68 43 64 39 58"
        className="rank-insignia__leaf"
      />
    )
  }

  return (
    <g>
      <path
        d="M60 20 L52 34 L36 28 L40 44 L23 47 L37 58 L27 72 L46 69 L60 96 L74 69 L93 72 L83 58 L97 47 L80 44 L84 28 L68 34 Z"
        className="rank-insignia__commander"
      />
      <path
        d="M48 58 H72 M52 66 H68 M56 74 H64"
        className="rank-insignia__commander-lines"
      />
    </g>
  )
}

function RankInsignia({ rank = 'Recruit', className = '' }) {
  const officerRanks = new Set(['Lieutenant', 'Captain', 'Major', 'Commander'])
  const officer = officerRanks.has(rank)

  return (
    <svg
      className={`rank-insignia ${className}`}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      {officer ? (
        <OfficerInsignia rank={rank} />
      ) : (
        <EnlistedInsignia rank={rank} />
      )}
    </svg>
  )
}

export default RankInsignia
