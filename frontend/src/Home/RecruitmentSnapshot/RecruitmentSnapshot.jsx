import { recruitmentFacts } from '../recruitmentContent.js'
import './RecruitmentSnapshot.css'

function RecruitmentSnapshot() {
  return (
    <section
      className="recruitment-snapshot"
      aria-labelledby="recruitment-snapshot-title"
    >
      <header className="recruitment-snapshot__header">
        <p className="recruitment-snapshot__eyebrow">Holdfast at a glance</p>
        <h2 id="recruitment-snapshot-title">
          Find your pace. Find your people.
        </h2>
      </header>

      <div className="recruitment-snapshot__facts">
        {recruitmentFacts.map((fact, index) => (
          <article className="recruitment-snapshot__fact" key={fact.id}>
            <div className="recruitment-snapshot__fact-topline">
              <span className="recruitment-snapshot__fact-label">{fact.label}</span>
              <span className="recruitment-snapshot__fact-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
            </div>
            <h3>{fact.value}</h3>
            <p>{fact.detail}</p>
            <span className="recruitment-snapshot__fact-mark" aria-hidden="true">
              ♜
            </span>
          </article>
        ))}
      </div>
    </section>
  )
}

export default RecruitmentSnapshot
