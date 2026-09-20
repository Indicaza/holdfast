import PageShell from '../PageShell/PageShell.jsx'

function GuildOS() {
  return (
    <PageShell
      eyebrow="GuildOS"
      title="Simple at the edge."
      intro="GuildOS is the future administrative and analytical layer behind Holdfast. Its job is to remove coordination work without replacing human judgment."
    >
      <h2>AI does staff work. Humans govern.</h2>
      <p>
        GuildOS may eventually connect Discord, guild rosters, professions,
        bank records, market data, events, and other useful signals into one
        coherent system.
      </p>

      <h2>What matters now</h2>
      <ul>
        <li>Make joining Holdfast easy.</li>
        <li>Keep useful guild information easy to find.</li>
        <li>Automate chores only when they become real chores.</li>
        <li>Preserve data that may become useful later.</li>
      </ul>

      <h2>Built in the open</h2>
      <p>
        Holdfast's software is being developed openly so members can understand
        what the tools do and how the systems around the guild work.
      </p>
    </PageShell>
  )
}

export default GuildOS
