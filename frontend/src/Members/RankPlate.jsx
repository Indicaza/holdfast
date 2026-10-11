import RankInsignia from './RankInsignia.jsx'
import './RankPlate.css'

// Rank and billets read as one line: "Major · Raid Leader · Steward". The
// rank is who someone is in the guild; billets are what they hold for it.
export default function RankPlate({ member, size = 'md', variant = 'pill', className = '' }) {
  const rank = member?.rank || 'Recruit'
  const billets = Array.isArray(member?.billets) ? member.billets : []
  const tier = member?.rankMeta?.isOfficer ? 'officer' : member?.rankMeta?.isLeadership ? 'nco' : 'enlisted'

  return (
    <div className={`rank-plate rank-plate--${size} rank-plate--${variant} rank-plate--${tier}${className ? ` ${className}` : ''}`}>
      <span className="rank-plate__insignia">
        <RankInsignia rank={rank} />
      </span>
      <span className="rank-plate__text">
        <strong className="rank-plate__rank">{rank}</strong>
        {billets.map((billet) => (
          <span className="rank-plate__billet" key={billet.id} title={billet.responsibility || undefined}>
            {billet.name}
          </span>
        ))}
      </span>
    </div>
  )
}
