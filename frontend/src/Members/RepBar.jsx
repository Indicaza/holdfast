import { repProgress } from './repProgress.js'
import './RepBar.css'

// Reputation as an experience bar: segmented like the game's, filling toward
// the next rank's Rep floor (or the next milestone, for officers). The full
// bar spans its container with the readout on it; compact is a slim line.
export default function RepBar({ member, variant = 'full', className = '' }) {
  const rep = repProgress(member)
  const bar = (
    <div
      className="rep-bar__track"
      role="progressbar"
      aria-label={`Reputation: ${rep.goal}`}
      aria-valuemin="0"
      aria-valuemax={rep.max}
      aria-valuenow={rep.current}
      aria-valuetext={`${rep.readout} Rep`}
    >
      <span className="rep-bar__fill" style={{ width: `${rep.percent}%` }} data-empty={rep.percent === 0} />
      {variant === 'full' ? <span className="rep-bar__readout">{rep.readout} Rep</span> : null}
    </div>
  )

  if (variant === 'compact') {
    return (
      <div className={`rep-bar rep-bar--compact${className ? ` ${className}` : ''}`}>
        <div className="rep-bar__caption">
          <span>{rep.goal}</span>
          <strong>{rep.lifetimeRep.toLocaleString()} Rep</strong>
        </div>
        {bar}
      </div>
    )
  }

  return (
    <section className={`rep-bar rep-bar--full${className ? ` ${className}` : ''}`} aria-labelledby="rep-bar-title">
      <div className="rep-bar__heading">
        <div>
          <span className="rep-bar__eyebrow">Reputation</span>
          <h2 id="rep-bar-title">{rep.lifetimeRep.toLocaleString()} <small>Rep</small></h2>
        </div>
        <span className="rep-bar__goal">{rep.goal}</span>
      </div>
      {bar}
      <div className="rep-bar__scale">
        <span>{rep.start}</span>
        <p>{rep.note}</p>
        <span>{rep.end}</span>
      </div>
    </section>
  )
}
