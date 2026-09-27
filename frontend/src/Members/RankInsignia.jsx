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
        d="M58 42 C47 28 31 22 14 26 L29 34 L12 41 L37 43 L21 54 L47 50 L57 60 Z"
        className="rank-insignia__commander"
      />
      <path
        d="M62 42 C73 28 89 22 106 26 L91 34 L108 41 L83 43 L99 54 L73 50 L63 60 Z"
        className="rank-insignia__commander"
      />
      <path
        d="M54 42 C52 55 52 73 56 87 L47 98 L58 94 L60 104 L62 94 L73 98 L64 87 C68 73 68 55 66 42 Z"
        className="rank-insignia__commander"
      />
      <circle
        cx="64"
        cy="34"
        r="6"
        className="rank-insignia__commander-head"
      />
      <path
        d="M69 33 L81 36 L69 39"
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
