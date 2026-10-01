import { recruitmentFacts } from '../recruitmentContent.js'
import './RecruitmentSnapshot.css'

function RecruitmentSnapshot() {
  return (
    <section
      className="recruitment-snapshot"
      aria-labelledby="recruitment-snapshot-title"
    >
      <header className="recruitment-snapshot__header">
        <div>
          <p className="recruitment-snapshot__eyebrow">
            Holdfast at a glance
          </p>
          <h2 id="recruitment-snapshot-title">
            A guild that fits around your life.
          </h2>
        </div>
        <p>
          Invest as much of your time and personal space as feels comfortable.
          Holdfast is somewhere to belong, not another obligation.
        </p>
      </header>

      <div className="recruitment-snapshot__facts">
        {recruitmentFacts.map((fact) => (
          <article className="recruitment-snapshot__fact" key={fact.id}>
            <span>{fact.label}</span>
            <h3>{fact.value}</h3>
            <p>{fact.detail}</p>
          </article>
        ))}
      </div>

      <p className="recruitment-snapshot__network">
        We have friends and sister guilds around us, but Holdfast is building
        its own culture and roster from day one.
      </p>
    </section>
  )
}

export default RecruitmentSnapshot
