import PageShell from '../PageShell/PageShell.jsx'
import PublicJoinCallout from '../PublicJoinCallout/PublicJoinCallout.jsx'
import './Charter.css'

function Charter() {
  return (
    <PageShell title="Holdfast Charter" centered>
      <article className="charter">
        <header className="charter__title">
          <h1>Holdfast Charter</h1>
        </header>
        <section className="charter__section">
          <h2>Built to come back to</h2>

          <p>
            A lot of us have spent years coming and going from World of Warcraft.
            Life gets busy. We burn out, vanish for a while, swear we are done,
            and somehow end up installing WoW again.
          </p>

          <p className="charter__callout">
            If WoW Forever gives us another twenty years in Azeroth,{' '}
            <strong>Holdfast should be something worth coming back to.</strong>
          </p>

          <p>
            That means no guilt when real life pulls you away, no system that
            depends on one person, and no dead guild because one leader burned
            out. Hand off responsibility, keep familiar faces, and come back when
            you can.
          </p>

          <p>
            Holdfast should be able to grow, shrink, sleep, wake back up, and
            still feel like Holdfast.
          </p>
        </section>

        <section className="charter__section">
          <h2>Leadership is service</h2>

          <p className="charter__callout">
            <strong>Rank represents trust. A billet represents responsibility.</strong>
          </p>

          <p>
            Billets are jobs the guild needs done. They change hands as people
            step forward, take breaks, or find a better fit. You can leave the
            job without losing the trust you earned.
          </p>

          <p className="charter__callout charter__callout--link">
            <strong>
              See <a href="/ranks">Ranks &amp; Roles</a> for the plain version
              of how Rep, promotion, and billets work.
            </strong>
          </p>

          <p>
            We value leaders who make decisions, own the consequences, teach
            what they know, and leave others more capable than they found them.
          </p>

          <p>
            <strong>A good leader creates more leaders.</strong>
          </p>
        </section>

        <section className="charter__section">
          <h2>Excellence matters</h2>

          <p>There are many ways to be exceptional here.</p>

          <p>
            You might be the tank everybody trusts, the healer who saves bad
            pulls, the raider who executes cleanly, the PvPer people want beside
            them, the class expert who knows every edge case, the crafter with
            the right recipe, the trader who sees an opportunity early, the
            teacher who makes people better, or the organizer who makes the
            whole thing work.
          </p>

          <p>Leadership is one form of excellence, not the only one.</p>

          <p>
            <strong>Skill earns recognition. Service earns trust.</strong>
          </p>

          <p>You do not need a title to matter here.</p>
        </section>

        <section className="charter__section">
          <h2>New players are welcome</h2>

          <p>
            You do not need twenty years of experience, perfect gear, or
            impressive logs to belong here.
          </p>

          <p>
            Veterans know Azeroth well, but familiarity has a cost. New players
            ask questions we stopped asking, notice things we walk past, and
            remind us why this world was exciting in the first place.
          </p>

          <p className="charter__callout">
            <strong>
              You are not showing up twenty years late. You are bringing
              something with you.
            </strong>
          </p>

          <p>
            If you want to become a better tank, raider, PvPer, crafter,
            organizer, or leader, we will help you get there. Come willing to
            learn, and when the next new player arrives, help them climb the
            same hill.
          </p>
        </section>

        <section className="charter__section">
          <h2>Shared prosperity</h2>

          <p className="charter__callout">
            <strong>
              The guild bank is not a dragon sitting on a pile of gold. It is
              working capital.
            </strong>
          </p>

          <p>
            Contribute materials, useful items, recipes, or gold when you
            reasonably can. The Quartermaster can put those resources to work
            through crafting, trade, and the Auction House instead of letting
            them sit.
          </p>

          <p>
            When members strengthen the guild, the guild should become more
            capable of strengthening its members.
          </p>
        </section>

        <section className="charter__section">
          <h2>Conduct over belief</h2>

          <p className="charter__callout">
            <strong>Holdfast is not an ideological community.</strong>
          </p>

          <p>
            You do not need to agree with everyone here about politics,
            religion, culture, philosophy, or much of anything else.
          </p>

          <p>People can disagree, argue, joke around, and be themselves.</p>

          <p>
            What matters is how we treat one another and the community we share.
          </p>

          <p>
            Harassment, theft, scams, deliberate sabotage, abuse of shared
            resources, and behavior that harms Holdfast have no place here.
          </p>

          <p>
            Beyond that, we would rather learn how to live alongside different
            people than demand that everybody become the same.
          </p>
        </section>

        <section className="charter__section charter__section--closing">
          <h2>Leave it stronger</h2>

          <p>The name, the castle, and our colors all point toward the same idea.</p>

          <p>
            <strong>
              Blue for trust. White for fairness. Gold for excellence. The
              castle for something built to hold.
            </strong>
          </p>

          <p>
            You do not have to give everything to Holdfast. You do not have to
            be online every night. You do not have to become an officer, a top
            raider, or the person who farms ten thousand herbs.
          </p>

          <p>Bring what you can.</p>
          <p>Learn what you can.</p>
          <p>Teach what you know.</p>
          <p>Make some friends.</p>

          <p>
            Build something useful enough that the next person does not have to
            start from zero.
          </p>

          <p>
            And when your turn comes to wander away from Azeroth for a while,
            leave behind a guild a little stronger than the one that welcomed
            you.
          </p>

          <p className="charter__maxim">
            <strong>Leave it stronger.</strong>
          </p>

          <p className="charter__motto">
            <strong>Servimus ut permaneat.</strong>
            <br />
            <em>We serve so that it may endure.</em>
          </p>
        </section>

        <PublicJoinCallout
          title="Ready to help build it?"
          description="Meet the guild, find your place, and help us leave Azeroth a little stronger than we found it."
        />
      </article>
    </PageShell>
  )
}

export default Charter
