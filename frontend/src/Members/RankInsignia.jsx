import './RankInsignia.css'

const ENLISTED = {
  Corporal: { chevronYs: [16, 35], center: 'swords', rockerYs: [] },
  Sergeant: { chevronYs: [8, 24, 40], center: 'swords', rockerYs: [] },
  'Master Sergeant': {
    chevronYs: [6, 22, 38],
    center: 'star',
    rockerYs: [81, 91, 101],
  },
  'Sergeant Major': {
    chevronYs: [6, 22, 38],
    center: 'star',
    rockerYs: [78, 87, 96, 105],
  },
}

function Chevron({ y }) {
  return (
    <polyline
      points={`28,${y} 60,${y + 14} 92,${y}`}
      className="rank-insignia__stroke"
    />
  )
}

function Rocker({ y }) {
  return (
    <path
      d={`M 30 ${y} Q 60 ${y + 13} 90 ${y}`}
      className="rank-insignia__stroke"
    />
  )
}

function CrossedSwords() {
  return (
    <g className="rank-insignia__stroke rank-insignia__swords">
      <path d="M 43 57 L 77 91" />
      <path d="M 77 57 L 43 91" />
      <path d="M 70 84 L 82 96" />
      <path d="M 50 84 L 38 96" />
      <path d="M 70 84 L 81 73" />
      <path d="M 50 84 L 39 73" />
    </g>
  )
}

function Star() {
  return (
    <polygon
      className="rank-insignia__fill"
      points="60,54 63,62 72,62 65,67 68,76 60,71 52,76 55,67 48,62 57,62"
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
      {config.chevronYs.map((y, index) => (
        <Chevron key={`chevron-${index}`} y={y} />
      ))}

      {config.center === 'swords' ? <CrossedSwords /> : null}
      {config.center === 'star' ? <Star /> : null}

      {config.rockerYs.map((y, index) => (
        <Rocker key={`rocker-${index}`} y={y} />
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
        className={`rank-insignia rank-insignia--entry rank-insignia--${rank.toLowerCase()} ${className}`}
        aria-hidden="true"
      >
        <span className="rank-insignia__entry-mark" />
        <span className="rank-insignia__entry-label">
          {rank === 'Recruit' ? 'Joining' : 'Enlisted'}
        </span>
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
