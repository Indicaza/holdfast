import { guildFeaturesEnabled } from '../Features/guildFeatures.js'
import PageShell from '../PageShell/PageShell.jsx'

// The guild-era sections (Holdfast membership, quests, Rep) apply only while
// guild features are on.
function GuildSections() {
  return (
    <>
      <h2>Guilds</h2>
      <p>
        If you join a guild on Guildweaver, its members and leaders can see
        your guild profile (BattleTag if provided, timezone, availability,
        bio), your rank, Rep, Service Marks, quest assignments and service
        history. Holdfast membership is verified through Holdfast&apos;s Discord
        server; if Discord reports that you left, your guild access ends and
        you are hidden from the active roster. Guild leaders and authorized
        editors can manage quests, assignments, rewards and member records.
      </p>
      <p>
        The public Holdfast home page may show its featured quest, including
        the display name, avatar and assignment of members assigned to it.
      </p>
    </>
  )
}

function Privacy() {
  return (
    <PageShell
      eyebrow="Privacy"
      title="What Guildweaver records"
      intro="What Guildweaver collects when you sign in and sync, who can see it, and how to stop it."
    >
      <h2>When you sign in</h2>
      <p>
        Signing in with Discord stores your Discord user ID, username, display
        name and avatar so the site can recognize you. Discord sign-in never
        adds you to a Discord server or a guild. A signed sign-in cookie keeps
        you signed in. Your browser&apos;s timezone may be saved to show times
        correctly.
      </p>

      <h2>When you sync</h2>
      <p>
        Guildweaver on your computer uploads what the addon saves: your
        characters&apos; names, realms, levels, classes, equipment, stats,
        talents, professions and recipes, bags and gold, and gathering, fishing
        and loot observations with zone, map position, skill level and game
        build. Each computer you connect has its own key and records when it
        last uploaded.
      </p>

      <h2>Who can see it</h2>
      <ul>
        <li>
          <strong>You.</strong> Your dashboard shows your characters, bags,
          gold, professions, farming and devices. They are private: the site
          shows them only to your account, and other players cannot open them
          even with a direct link.
        </li>
        <li>
          <strong>Everyone, anonymously.</strong> The item catalog, game-data
          API and community drop rates use item definitions, recipe ingredients
          and pooled gathering and loot observations. They never include player,
          character, guild, account, device or installation identities, bags or
          gold. Community maps show where gathers happened without saying who
          gathered or when; the public game-data API only shows coarse map areas
          seen by at least three contributors.
        </li>
        <li>
          <strong>Site administrators</strong> can inspect raw uploads to keep
          syncing working.
        </li>
      </ul>

      {guildFeaturesEnabled ? <GuildSections /> : null}

      <h2>Stopping and removal</h2>
      <p>
        Disconnect a computer from <a href="/dashboard/sync">My Devices &amp; Sync</a> to
        stop it uploading; its key stops working at once. Uninstalling
        Guildweaver stops all uploads from that computer. There is no
        self-service account deletion yet; to have your data removed, contact
        the maintainer through <a href="https://github.com/Indicaza" target="_blank" rel="noreferrer">GitHub</a>.
      </p>

      <h2>Where it lives</h2>
      <p>
        Account and game data are stored in Guildweaver&apos;s private
        application database. It is never committed to the public source
        repositories.
      </p>
    </PageShell>
  )
}

export default Privacy
