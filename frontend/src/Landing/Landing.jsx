import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { Button } from '../DesignSystem/index.js'
import GuildweaverDownload from '../Guildweaver/GuildweaverDownload.jsx'
import { classIdentity } from '../Intelligence/classIdentity.js'
import PageShell from '../PageShell/PageShell.jsx'
import { WowIcon } from '../WowAssets/WowIcon.jsx'
import './Landing.css'

const features = [
  {
    icon: 'characters',
    title: 'Every character, every server',
    body: 'Gear, stats, talents, bags and gold from your latest snapshots, grouped by the server each character lives on.',
  },
  {
    icon: 'craft',
    title: 'Know who can craft it',
    body: 'Search your characters’ recipes and see which of them can make an item, and at what skill.',
  },
  {
    icon: 'farming',
    title: 'Your farming, counted',
    body: 'What you gathered, fished and looted, and where. Compare it with drop rates pooled from every player.',
  },
]

const steps = [
  { title: 'Install', body: 'Guildweaver finds WoW, installs the addon and keeps both updated.' },
  { title: 'Connect', body: 'Sign in with Discord once to link this computer to your account.' },
  { title: 'Play', body: 'When you /reload or log out, WoW saves the addon’s data and Guildweaver uploads it.' },
]

// Made-up characters for the dashboard preview in the hero.
const previewCharacters = [
  { name: 'Ashvale', className: 'Priest', race: 'Human', level: 60, synced: '2m ago' },
  { name: 'Rook', className: 'Warrior', race: 'Night Elf', level: 42, synced: '2m ago' },
  { name: 'Fern', className: 'Mage', race: 'Gnome', level: 18, synced: '3d ago' },
]

function FeatureIcon({ name }) {
  if (name === 'characters') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.2" />
        <path d="M3.5 20c.4-4 2.3-6 5.5-6s5.1 2 5.5 6" />
        <path d="M14.5 15.2c.7-.8 1.7-1.2 2.9-1.2 2.1 0 3.4 1.4 3.8 4.2" />
      </svg>
    )
  }
  if (name === 'craft') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 5 5" />
        <path d="M8 10.5h5M10.5 8v5" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21v-8" />
      <path d="M12 13c0-4 2.6-7 7-7 0 4.2-2.8 7-7 7Z" />
      <path d="M12 15c0-3.3-2.2-5.5-6-5.5 0 3.4 2.4 5.5 6 5.5Z" />
    </svg>
  )
}

// A still picture of the dashboard: what a player gets after their first sync.
function DashboardPreview() {
  return (
    <figure className="landing-preview" aria-label="Example of the Guildweaver dashboard">
      <div className="landing-preview__window" aria-hidden="true">
        <div className="landing-preview__bar">
          <span className="landing-preview__dots"><i /><i /><i /></span>
          <span className="landing-preview__server">Doomhowl <b>▾</b></span>
          <span className="landing-preview__sync"><i />Synced 2m ago</span>
        </div>
        <div className="landing-preview__stats">
          <span><b>3</b>Characters</span>
          <span><b>60</b>Highest level</span>
          <span><b>412</b>Herbs gathered</span>
        </div>
        <ul className="landing-preview__list">
          {previewCharacters.map((character) => {
            const identity = classIdentity(character.className)
            return (
              <li key={character.name} style={{ '--preview-class-color': identity.color }}>
                <span className="landing-preview__portrait">
                  <WowIcon iconFileId={identity.iconFileId} label={character.className} size={40} />
                </span>
                <span className="landing-preview__who">
                  <strong>{character.name}</strong>
                  <small>Level {character.level} {character.race} {character.className}</small>
                </span>
                <span className="landing-preview__age">{character.synced}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </figure>
  )
}

// The front page while guild features are off: what Guildweaver does, how to
// get it, and the way into the dashboard.
export default function Landing() {
  const session = useSession()
  const signedIn = session.status === 'ready' && session.authenticated

  return (
    <PageShell bare className="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero__copy">
          <p className="landing-eyebrow">For WoW Forever players</p>
          <h1 id="landing-title" className="landing-hero__title">Guildweaver</h1>
          <p className="landing-hero__tagline">Every character you play, in one private dashboard.</p>
          <p className="landing-hero__intro">
            A small app and addon that sync your characters: gear, professions, bags and farming, grouped by server.
            Free, open source, and no guild required.
          </p>
          <div className="landing-hero__actions">
            {signedIn ? (
              <Button variant="primary" size="lg" href="/dashboard">Open your dashboard</Button>
            ) : (
              <Button variant="primary" size="lg" onClick={() => session.signIn(signInReturnTo())} disabled={session.status === 'loading'}>
                Sign in with Discord
              </Button>
            )}
            <Button variant="secondary" size="lg" href="/download">Download Guildweaver</Button>
          </div>
          <p className="landing-hero__note">Discord sign-in only identifies you. It never adds you to a server or a guild.</p>
        </div>
        <DashboardPreview />
      </section>

      <section className="landing-features" aria-label="What Guildweaver does">
        {features.map((feature) => (
          <article key={feature.title}>
            <span className="landing-features__icon"><FeatureIcon name={feature.icon} /></span>
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>

      <section className="landing-how" aria-labelledby="landing-how-title">
        <div className="landing-how__heading">
          <p className="landing-eyebrow">How it works</p>
          <h2 id="landing-how-title">Set up once, then just play.</h2>
        </div>
        <ol className="landing-how__steps">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className="landing-how__number" aria-hidden="true">{index + 1}</span>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="landing-how__install">
          <GuildweaverDownload compact />
        </div>
      </section>

      <p className="landing-privacy">
        Your characters, bags and gold are private to you. <a href="/privacy">What we collect and who can see it →</a>
      </p>
    </PageShell>
  )
}
