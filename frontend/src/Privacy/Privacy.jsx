import PageShell from '../PageShell/PageShell.jsx'

function Privacy() {
  return (
    <PageShell
      eyebrow="Privacy"
      title="What Holdfast records"
      intro="Holdfast collects the information it needs to run the guild website and GuildOS. This page describes what is stored today, who can see it, and what is still only planned."
    >
      <h2>What we store today</h2>
      <p>
        When you connect Discord, GuildOS stores enough Discord identity and
        guild information to recognize you as a Holdfast member and apply the
        right permissions.
      </p>
      <ul>
        <li>
          <strong>Discord identity:</strong> Discord user ID, username/display
          name, avatar, guild nickname, guild join date, and role-derived
          GuildOS permissions.
        </li>
        <li>
          <strong>Member profile:</strong> BattleTag if you provide one,
          timezone, availability, bio, and any character information currently
          entered in GuildOS.
        </li>
        <li>
          <strong>Guild activity:</strong> rank, Rep, Service Marks, quest
          assignments, completed objectives, rewards, and service history.
        </li>
        <li>
          <strong>Session data:</strong> a signed login cookie is used to keep
          you signed in. Discord membership and permissions are periodically
          rechecked while the session is active.
        </li>
      </ul>

      <h2>Where it comes from</h2>
      <p>
        Discord identity and guild membership come from Discord OAuth and the
        Holdfast Discord bot. Profile fields come from you or, for timezone,
        may be detected from your browser. Rep, Marks, assignments, and service
        records are created by activity inside GuildOS.
      </p>

      <h2>Who can see it</h2>
      <p>
        The public website does not expose the full member directory or member
        profiles. Signed-in Holdfast members can see member profiles and the
        guild directory, including the profile and service information GuildOS
        makes available to members.
      </p>
      <p>
        The public website may show the single quest currently featured on the
        Holdfast home page. If you are assigned to that featured quest, the
        public quest card may show your display name, avatar, responsibility,
        and assignment detail. The full published quest board is available only
        to signed-in Holdfast members. Internal Discord/member IDs are not
        included in the public featured-quest payload.
      </p>
      <p>
        Guild leadership and authorized editors can access the information
        needed to manage quests, assignments, rewards, and member records.
      </p>

      <h2>If you leave Holdfast</h2>
      <p>
        GuildOS periodically verifies Discord membership. If Discord reports
        that you have left the Holdfast server, your GuildOS access is removed
        and you are hidden from the active member directory.
      </p>
      <p>
        Your existing profile and service history may be retained so guild
        history is not destroyed and a returning member can reconnect to the
        same record. Holdfast does not currently have a self-service deletion
        tool; corrections or removal requests can be handled through guild
        leadership.
      </p>

      <h2>Where the data lives</h2>
      <p>
        Mutable member, quest, and contribution records are application data.
        They are stored in GuildOS runtime storage and are not intended to be
        committed as live member data to the public Holdfast source repository.
      </p>

      <h2>What is not active yet</h2>
      <p>
        The planned WoW Forever addon, local sync companion, automatic
        character snapshots, and guild-bank synchronization are not active
        data sources yet. This page will be updated before or alongside those
        systems when they begin collecting game data automatically.
      </p>

      <h2>Principle</h2>
      <p>
        Collect useful guild data on purpose, make its source and visibility
        understandable, and do not pretend planned integrations already exist.
      </p>
    </PageShell>
  )
}

export default Privacy
