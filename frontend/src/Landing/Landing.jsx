import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { Button } from '../DesignSystem/index.js'
import GuildweaverDownload from '../Guildweaver/GuildweaverDownload.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import './Landing.css'

const features = [
  { title: 'Every character, every server', body: 'Gear, stats, talents, bags and gold from your latest snapshots, grouped by the server each character lives on.' },
  { title: 'Know who can craft it', body: 'Search your characters’ recipes and see which of them can make an item, and at what skill.' },
  { title: 'Your farming, counted', body: 'What you gathered, fished and looted, and where. Compare it with drop rates pooled from every player.' },
]

// The front page while guild features are off: what Guildweaver does, how to
// get it, and the way into the dashboard.
export default function Landing() {
  const session = useSession()
  const signedIn = session.status === 'ready' && session.authenticated

  return (
    <PageShell
      eyebrow="For WoW Forever players"
      title="Guildweaver"
      intro="A small app and addon that sync your characters to a private dashboard: gear, professions, bags and farming, grouped by server. Free, open source, and no guild required."
      className="landing"
    >
      <div className="landing__actions">
        {signedIn ? (
          <Button variant="primary" size="lg" href="/dashboard">Open your dashboard</Button>
        ) : (
          <Button variant="primary" size="lg" onClick={() => session.signIn(signInReturnTo())} disabled={session.status === 'loading'}>
            Sign in with Discord
          </Button>
        )}
        <Button variant="secondary" size="lg" href="/download">Download Guildweaver</Button>
      </div>
      <p className="landing__note">Discord sign-in only identifies you. It never adds you to a server or a guild.</p>

      <section className="landing__features" aria-label="What Guildweaver does">
        {features.map((feature) => (
          <article key={feature.title}>
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>

      <section className="landing__how" aria-labelledby="landing-how-title">
        <h2 id="landing-how-title">How it works</h2>
        <ol>
          <li><strong>Install.</strong> Guildweaver finds WoW, installs the addon and keeps both updated.</li>
          <li><strong>Connect.</strong> Sign in with Discord once to link this computer to your account.</li>
          <li><strong>Play.</strong> When you /reload or log out, WoW saves the addon’s data and Guildweaver uploads it.</li>
        </ol>
        <GuildweaverDownload compact />
      </section>

      <p className="landing__privacy">
        Your characters, bags and gold are private to you. <a href="/privacy">What we collect and who can see it →</a>
      </p>
    </PageShell>
  )
}
