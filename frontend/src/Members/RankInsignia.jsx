import './RankInsignia.css'

const ENLISTED = {
  Corporal: { chevrons: 2, rockers: 0, center: 'swords' },
  Sergeant: { chevrons: 3, rockers: 0, center: 'swords' },
  'Master Sergeant': { chevrons: 3, rockers: 3, center: 'star' },
  'Sergeant Major': { chevrons: 3, rockers: 4, center: 'star' },
}

function Chevron({ index }) {
  const y = 14 + index * 11

  return (
    <polyline
      points={`30,${y} 60,${y + 15} 90,${y}`}
      className="rank-insignia__stroke"
    />
  )
}

function Rocker({ index, count }) {
  const y = 84 + index * 8 - Math.max(0, count - 3) * 4

  return (
    <path
      d={`M 32 ${y} Q 60 ${y + 14} 88 ${y}`}
      className="rank-insignia__stroke"
    />
  )
}

function CrossedSwords() {
  return (
    <g className="rank-insignia__stroke rank-insignia__swords">
      <path d="M 45 58 L 76 84" />
      <path d="M 75 58 L 44 84" />
      <path d="M 41 82 L 48 89" />
      <path d="M 79 82 L 72 89" />
      <path d="M 40 86 L 47 79" />
      <path d="M 80 86 L 73 79" />
    </g>
  )
}

function Star() {
  return (
    <polygon
      className="rank-insignia__fill"
      points="60,52 64,64 77,64 67,71 71,84 60,77 49,84 53,71 43,64 56,64"
    />
  )
}

function EnlistedInsignia({ rank }) {
  const config = ENLISTED[rank]

  if (!config) {
    return null
  }

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
    <g className="rank-insignia__eagle">
      <path
        d="M60 28 C52 21 42 18 31 20 L18 31 L36 35 L24 45 L44 43 L38 55 L54 48 L54 76 L47 84 L57 82 L60 99 L63 82 L73 84 L66 76 L66 48 L82 55 L76 43 L96 45 L84 35 L102 31 L89 20 C78 18 68 21 60 28 Z"
        className="rank-insignia__commander"
      />
      <circle
        cx="67"
        cy="31"
        r="5"
        className="rank-insignia__commander-head"
      />
      <path
        d="M71 31 L80 34 L71 36"
        className="rank-insignia__commander-beak"
      />
    </g>
  )
}

function RankInsignia({ rank = 'Recruit', className = '' }) {
  const officerRanks = new Set(['Lieutenant', 'Captain', 'Major', 'Commander'])
  const noInsignia = rank === 'Recruit' || rank === 'Private'

  if (noInsignia) {
    return (
      <span
        className={`rank-insignia rank-insignia--none ${className}`}
        aria-hidden="true"
      >
        <span>No insignia</span>
      </span>
    )
  }

  return (
    <svg
      className={`rank-insignia ${className}`}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      {officerRanks.has(rank) ? (
        <OfficerInsignia rank={rank} />
      ) : (
        <EnlistedInsignia rank={rank} />
      )}
    </svg>
  )
}

export default RankInsignia
