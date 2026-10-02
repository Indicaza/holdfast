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
    title: 'Contribution recorded',
    description: 'Earned through useful guild work. It only goes up and is never spent.',
  },
  {
    label: 'Rank',
    title: 'Trust earned',
    description: 'Rep can make you eligible. It cannot buy promotion or authority.',
  },
  {
    label: 'Billet',
    title: 'A job right now',
    description: 'A current responsibility such as Raid Leader or Quartermaster. Jobs can rotate.',
  },
  {
    label: 'Marks',
    title: 'Something back',
    description: 'Spendable rewards used to ask the guild for approved help, items, or support.',
  },
]

const repFloors = [
  { value: '3,000', rank: 'Corporal' },
  { value: '9,000', rank: 'Sergeant' },
  { value: '21,000', rank: 'Master Sergeant' },
  { value: '42,000', rank: 'Sergeant Major' },
]

function Ranks() {
  return (
    <PageShell
      eyebrow="How Holdfast works"
      title="Ranks & Roles"
      intro="Contribution earns Rep. Trust earns rank. Roles rotate with the work."
    >
      <article className="ranks-page">
        <section className="ranks-page__system" aria-labelledby="ranks-system-title">
          <div className="ranks-page__section-heading">
            <div>
              <span className="ranks-page__label">The short version</span>
              <h2 id="ranks-system-title">Four things to know</h2>
            </div>
          </div>

          <div className="ranks-page__system-grid">
            {systemDefinitions.map((item) => (
              <article className="ranks-page__system-card" key={item.label}>
                <span className="ranks-page__label">{item.label}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>

          <p className="ranks-page__promotion-line">
            <strong>Rep opens the door.</strong> Trust, leadership, recommendation,
            and guild need decide promotion.
          </p>

          <div className="ranks-page__rep-track" aria-label="Enlisted Rep floors">
            {repFloors.map((floor) => (
              <div className="ranks-page__rep-floor" key={floor.rank}>
                <strong>{floor.value}</strong>
                <span>{floor.rank}</span>
              </div>
            ))}
          </div>

          <p className="ranks-page__rep-note">
            Rep floors create eligibility, not automatic promotion. Officer ranks
            are appointed separately.
          </p>
        </section>

        <section className="ranks-page__section">
          <div className="ranks-page__section-heading">
            <div>
              <span className="ranks-page__label">The ladder</span>
              <h2>What the ranks mean</h2>
            </div>
            <p>
              Rank shows the trust and responsibility someone is prepared to carry.
            </p>
          </div>

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

        <section className="ranks-page__section">
          <div className="ranks-page__section-heading">
            <div>
              <span className="ranks-page__label">Billets</span>
              <h2>Guild roles</h2>
            </div>
            <p>
              These are jobs, not extra ranks. They can change hands without
              changing someone&apos;s rank.
            </p>
          </div>

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
