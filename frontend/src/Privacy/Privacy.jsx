import PageShell from '../PageShell/PageShell.jsx'

function Privacy() {
  return (
    <PageShell
      eyebrow="Privacy"
      title="Plain English."
      intro="Holdfast should collect only the information it needs to operate useful guild systems."
    >
      <h2>Current state</h2>
      <p>
        The public website does not currently require a Holdfast account or
        collect guild-member records.
      </p>

      <h2>As integrations arrive</h2>
      <p>
        Future systems may store linked Discord identity, characters,
        guild-related records, and information members deliberately provide.
        This page will be updated as those systems become real.
      </p>

      <h2>Principle</h2>
      <p>
        Transparency should scale with capability. Members should be able to
        understand what Holdfast records and why.
      </p>
    </PageShell>
  )
}

export default Privacy
