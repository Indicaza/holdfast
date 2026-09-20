import './GuildIdentity.css'

const principles = [
  {
    title: 'Leave it stronger.',
    copy: 'Contribute in whatever way fits you: teach, lead, craft, gather, help, improve, or simply be someone people are glad to see online.',
  },
  {
    title: 'Leadership is service.',
    copy: 'Rank is trust, not status. Leaders exist to make the guild stronger, more capable, and less dependent on any one person.',
  },
  {
    title: 'Real life comes first.',
    copy: 'People may step away for weeks or months. Holdfast should survive jobs, family, burnout, new games, and changing seasons of life.',
  },
  {
    title: 'Human-sized by design.',
    copy: 'We want familiar names, useful guild chat, fluid teams, and enough structure to help without turning the guild into a bureaucracy.',
  },
]

function GuildIdentity() {
  return (
    <section className="guild-identity" aria-labelledby="guild-identity-title">
      <div className="guild-identity__intro">
        <p className="guild-identity__eyebrow">What Holdfast is</p>
        <h2 id="guild-identity-title">
          A good community first. An organization second.
        </h2>
        <p>
          Holdfast is an Alliance guild built to make it easy for good people
          to play together, improve together, and build something that lasts.
        </p>
      </div>

      <div className="guild-identity__principles">
        {principles.map((principle, index) => (
          <article className="guild-identity__principle" key={principle.title}>
            <span className="guild-identity__number">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <h3>{principle.title}</h3>
              <p>{principle.copy}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default GuildIdentity
