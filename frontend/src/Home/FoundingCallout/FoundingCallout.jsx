import './FoundingCallout.css'

function FoundingCallout() {
  return (
    <section className="founding-callout" aria-labelledby="founding-callout-title">
      <div className="founding-callout__copy">
        <p className="founding-callout__eyebrow">Founding roster</p>
        <h2 id="founding-callout-title">Build the first version with us.</h2>
        <p>
          Holdfast is forming now. Join early, meet the people who will shape
          the guild, and help build a community worth staying in.
        </p>
      </div>

      <div className="founding-callout__actions">
        <a className="founding-callout__primary" href="/join">
          Join Holdfast
        </a>
        <a className="founding-callout__secondary" href="/charter">
          Read the Charter
        </a>
      </div>

      <div className="founding-callout__mark" aria-hidden="true">
        ♜
      </div>
    </section>
  )
}

export default FoundingCallout
