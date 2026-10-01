import PageShell from '../PageShell/PageShell.jsx'
import RankInsignia from '../Members/RankInsignia.jsx'
import PublicJoinCallout from '../PublicJoinCallout/PublicJoinCallout.jsx'
import './Ranks.css'

const rankDefinitions = [
  {
    name: 'Recruit',
    group: 'Joining Holdfast',
    marker: 'Starting point',
    description: 'A new member learning the guild and finding their place.',
  },
  {
    name: 'Private',
    group: 'Enlisted',
    marker: 'After onboarding',
    description: 'A full member in good standing, with no leadership expected.',
  },
  {
    name: 'Corporal',
    group: 'Enlisted',
    marker: '3,000 Rep floor',
    description:
      'The first level of earned trust. Corporal may be a permanent rank for a strong contributor who does not want formal leadership.',
  },
  {
    name: 'Sergeant',
    group: 'Enlisted leadership',
    marker: '9,000 Rep floor',
    description:
      'A proven small-group leader and mentor. Rep creates eligibility; trust and need decide promotion.',
  },
  {
    name: 'Master Sergeant',
    group: 'Enlisted leadership',
    marker: '21,000 Rep floor',
    description:
      'An experienced NCO who can run recurring work, develop junior leaders, and maintain standards.',
  },
  {
    name: 'Sergeant Major',
    group: 'Senior enlisted',
    marker: '42,000 Rep floor',
    description:
      'The senior enlisted rank, focused on mentorship, continuity, and strengthening the NCO corps.',
  },
  {
    name: 'Lieutenant',
    group: 'Commissioned officer',
    marker: 'Appointment',
    description:
      'The first commissioned rank, created when Holdfast needs another officer and trusts someone with broader authority.',
  },
  {
    name: 'Captain',
    group: 'Commissioned officer',
    marker: 'Appointment',
    description:
      'An experienced officer trusted with significant programs, responsibilities, or recurring operations.',
  },
  {
    name: 'Major',
    group: 'Commissioned officer',
    marker: 'Appointment',
    description:
      'A senior officer trusted with broad responsibility and cross-guild coordination.',
  },
  {
    name: 'Commander',
    group: 'Guildmaster',
    marker: 'Unique rank',
    description:
      'Holdfast’s guildmaster rank, responsible for continuity while delegating ordinary work.',
  },
]

const billetDefinitions = [
  {
    name: 'Steward',
    description:
      'The Commander’s trusted deputy, able to keep Holdfast moving during an absence.',
  },
  {
    name: 'Quartermaster',
    description:
      'Maintains the guild bank, materials, professions, crafting, and practical economic work.',
  },
  {
    name: 'Raid Leader',
    description:
      'Runs an assigned raid team or program, including schedules, rosters, preparation, and calls.',
  },
  {
    name: 'PvP Lead',
    description:
      'Organizes serious guild PvP, from premades and response groups to events and training.',
  },
]

function Ranks() {
  return (
    <PageShell
      eyebrow="How Holdfast works"
      title="Ranks & Roles"
      intro="Holdfast uses rank to recognize trust and roles to make responsibility clear. You do not need a title to matter here, and no amount of grinding buys authority."
    >
      <article className="ranks-page">
        <section className="ranks-page__principles" aria-label="The basics">
          <div className="ranks-page__principle">
            <span className="ranks-page__label">Rank</span>
            <h2>Trust that lasts</h2>
            <p>
              Rank reflects the judgment, reliability, and leadership trust
              Holdfast has placed in someone over time.
            </p>
          </div>

          <div className="ranks-page__principle">
            <span className="ranks-page__label">Rep</span>
            <h2>Service remembered</h2>
            <p>
              Rep is a permanent record of useful contribution. It only goes
              up, is never spent, and continues after every rank breakpoint.
            </p>
          </div>

          <div className="ranks-page__principle">
            <span className="ranks-page__label">Role</span>
            <h2>Work that rotates</h2>
            <p>
              A billet is a job the guild needs done. Roles can change as
              people step forward, take breaks, or find a better fit.
            </p>
          </div>
        </section>

        <section className="ranks-page__section">
          <div className="ranks-page__section-heading">
            <div>
              <span className="ranks-page__label">Advancement</span>
              <h2>How promotion works</h2>
            </div>
            <p>
              Rep opens the door. Demonstrated leadership, recommendation,
              good judgment, and organizational need decide who walks through.
            </p>
          </div>

          <div className="ranks-page__rules">
            <div className="ranks-page__rule">
              <span>01</span>
              <h3>Contribute</h3>
              <p>
                Help people, organize activities, teach, gather, craft, lead,
                or strengthen something useful.
              </p>
            </div>
            <div className="ranks-page__rule">
              <span>02</span>
              <h3>Build trust</h3>
              <p>
                Higher ranks depend on how you handle responsibility and make
                other members more capable.
              </p>
            </div>
            <div className="ranks-page__rule">
              <span>03</span>
              <h3>Step forward</h3>
              <p>
                Leadership is offered when Holdfast needs it and the right
                person has earned the confidence to carry it.
              </p>
            </div>
          </div>

          <div className="ranks-page__rep-note">
            <strong>Rep floors are not promises.</strong>
            <p>
              3,000 Rep makes Corporal possible. 9,000, 21,000, and 42,000 Rep
              create the service floors for Sergeant, Master Sergeant, and
              Sergeant Major consideration. Officer ranks are commissioned
              separately and are never unlocked by Rep alone.
            </p>
          </div>
        </section>

        <section className="ranks-page__section">
          <div className="ranks-page__section-heading">
            <div>
              <span className="ranks-page__label">The ladder</span>
              <h2>What the ranks mean</h2>
            </div>
            <p>
              Rank is not a measure of someone’s worth or mechanical skill. It
              tells the guild what kind of trust and responsibility a member is
              prepared to carry.
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
              <span className="ranks-page__label">Current billets</span>
              <h2>Who owns which work</h2>
            </div>
            <p>
              Billets apply authority to a responsibility, not to a permanent
              collection of people. A member can leave a role without losing
              the rank they earned.
            </p>
          </div>

          <div className="ranks-page__billet-grid">
            {billetDefinitions.map((billet) => (
              <article className="ranks-page__billet-card" key={billet.name}>
                <span className="ranks-page__label">Billet</span>
                <h3>{billet.name}</h3>
                <p>{billet.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="ranks-page__section ranks-page__section--closing">
          <div className="ranks-page__service-card">
            <span className="ranks-page__label">Rep &amp; Service Marks</span>
            <h2>Contribution should come back around.</h2>
            <p>
              Rep records what you have given. Service Marks are the spendable
              side: a way to ask the guild for help with a difficult quest,
              dungeon, profession, item, or other approved need.
            </p>
            <p>
              Marks can help you call on the community later. They never buy
              rank, authority, or someone’s respect.
            </p>
          </div>

          <a className="ranks-page__charter-link" href="/charter">
            Read the Holdfast Charter
          </a>
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
