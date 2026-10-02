import PageShell from '../PageShell/PageShell.jsx'
import RankInsignia from '../Members/RankInsignia.jsx'
import PublicJoinCallout from '../PublicJoinCallout/PublicJoinCallout.jsx'
import './Ranks.css'

const rankDefinitions = [
  {
    name: 'Recruit',
    group: 'Joining',
    marker: 'Starting point',
    description: 'A new member learning the guild and finding their place.',
  },
  {
    name: 'Private',
    group: 'Member',
    marker: 'After onboarding',
    description: 'A full member in good standing. No leadership expected.',
  },
  {
    name: 'Corporal',
    group: 'Member',
    marker: '3,000 Rep floor',
    description:
      'The first level of earned trust. Leadership is optional; this can be a permanent rank.',
  },
  {
    name: 'Sergeant',
    group: 'Leadership',
    marker: '9,000 Rep floor',
    description: 'A proven small-group leader and mentor.',
  },
  {
    name: 'Master Sergeant',
    group: 'Leadership',
    marker: '21,000 Rep floor',
    description:
      'An experienced leader who develops others and keeps recurring work moving.',
  },
  {
    name: 'Sergeant Major',
    group: 'Senior leadership',
    marker: '42,000 Rep floor',
    description:
      'The senior enlisted leader, focused on mentorship, continuity, and judgment.',
  },
  {
    name: 'Lieutenant',
    group: 'Officer',
    marker: 'Appointment',
    description:
      'The first officer rank, appointed when Holdfast needs broader leadership.',
  },
  {
    name: 'Captain',
    group: 'Officer',
    marker: 'Appointment',
    description:
      'An experienced officer trusted with major programs or recurring operations.',
  },
  {
    name: 'Major',
    group: 'Officer',
    marker: 'Appointment',
    description:
      'A senior officer trusted with broad responsibility and cross-guild coordination.',
  },
  {
    name: 'Commander',
    group: 'Guildmaster',
    marker: 'Unique rank',
    description:
      'The guildmaster, responsible for direction and continuity while delegating day-to-day work.',
  },
]

const billetDefinitions = [
  {
    name: 'Steward',
    description: 'Deputy to the Commander and continuity during an absence.',
  },
  {
    name: 'Quartermaster',
    description: 'Guild bank, crafting, professions, materials, and economy.',
  },
  {
    name: 'Raid Leader',
    description: 'Raid schedules, rosters, preparation, and calls.',
  },
  {
    name: 'PvP Lead',
    description: 'Premades, response groups, PvP events, and training.',
  },
]

const systemDefinitions = [
  {
    label: 'Rep',
    description: 'Permanent record of useful guild contribution. It only goes up.',
  },
  {
    label: 'Rank',
    description: 'Trust earned over time. Rep can qualify you; it cannot buy authority.',
  },
  {
    label: 'Billet',
    description: 'A current guild job. Jobs rotate as people step forward or take breaks.',
  },
  {
    label: 'Marks',
    description: 'Spendable rewards used to ask something back from the guild.',
  },
]

function Ranks() {
  return (
    <PageShell
      title="Ranks & Roles"
      intro="Contribution earns Rep. Trust earns rank. Roles rotate with the work."
    >
      <article className="ranks-page">
        <section className="ranks-page__system" aria-label="How Holdfast works">
          <div className="ranks-page__system-grid">
            {systemDefinitions.map((item) => (
              <article className="ranks-page__system-card" key={item.label}>
                <span className="ranks-page__label">{item.label}</span>
                <p>{item.description}</p>
              </article>
            ))}
          </div>

          <p className="ranks-page__promotion-line">
            <strong>Rep creates eligibility.</strong> Trust, leadership,
            recommendation, and guild need decide promotion. Officers are
            appointed separately.
          </p>
        </section>

        <section className="ranks-page__section ranks-page__section--ranks">
          <header className="ranks-page__major-heading">
            <h2>Ranks</h2>
          </header>

          <div className="ranks-page__rank-grid">
            {rankDefinitions.map((rank) => (
              <article className="ranks-page__rank-card" key={rank.name}>
                <div className="ranks-page__rank-insignia">
                  <RankInsignia rank={rank.name} />
                </div>
                <div className="ranks-page__rank-copy">
                  <span className="ranks-page__rank-group">{rank.group}</span>
                  <h3>{rank.name}</h3>
                  <span className="ranks-page__rank-marker">{rank.marker}</span>
                  <p>{rank.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="ranks-page__section ranks-page__section--billets">
          <header className="ranks-page__major-heading">
            <h2>Billets</h2>
          </header>

          <div className="ranks-page__billet-grid">
            {billetDefinitions.map((billet) => (
              <article className="ranks-page__billet-card" key={billet.name}>
                <h3>{billet.name}</h3>
                <p>{billet.description}</p>
              </article>
            ))}
          </div>
        </section>

        <PublicJoinCallout
          title="You do not need a rank to belong here."
          description="Join Holdfast, play at your own pace, and contribute in whatever way fits you."
        />
      </article>
    </PageShell>
  )
}

export default Ranks
