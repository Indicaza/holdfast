import WowIcon from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'

export default function ProfessionCards({ professions = [] }) {
  if (!professions.length) {
    return <EmptyTelemetry title="No profession telemetry yet.">Profession skill and recipes will appear after the next enriched Guildweaver snapshot.</EmptyTelemetry>
  }

  return (
    <div className="profession-grid">
      {professions.map((profession) => {
        const current = Number(profession.current) || 0
        const maximum = Number(profession.max) || 0
        const percent = maximum > 0 ? Math.min(100, Math.max(0, (current / maximum) * 100)) : current ? 100 : 0
        return (
          <article className="profession-card" key={profession.key || profession.id || profession.name}>
            <div className="profession-card__heading">
              <WowIcon iconFileId={profession.iconFileId} label={profession.name} size={54} />
              <div>
                <h3>{profession.name || 'Profession'}</h3>
                <span>{current}{maximum ? ` / ${maximum}` : ''}{profession.modifier ? ` +${profession.modifier}` : ''}</span>
              </div>
            </div>
            <div className="profession-card__track" aria-label={`${profession.name} skill ${current} of ${maximum || current}`}>
              <span style={{ width: `${percent}%` }} />
            </div>
            {profession.specialization ? <p>{typeof profession.specialization === 'string' ? profession.specialization : 'Specialization data available'}</p> : <p>No specialization telemetry yet.</p>}
          </article>
        )
      })}
    </div>
  )
}
