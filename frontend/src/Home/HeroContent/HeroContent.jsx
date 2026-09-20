import './HeroContent.css'

function HeroContent() {
  return (
    <section className="hero-content" aria-labelledby="holdfast-title">
      <p className="hero-content__eyebrow">World of Warcraft · Alliance</p>

      <div className="hero-content__heading">
        <h1 id="holdfast-title" className="hero-content__title">
          Holdfast
        </h1>
        <p className="hero-content__motto">Servimus ut permaneat.</p>
      </div>

      <p className="hero-content__maxim">Leave it stronger.</p>

      <p className="hero-content__description">
        A durable guild built for strong teams, shared prosperity, lasting
        friendships, and a game that still feels like a game.
      </p>

      <div className="hero-content__actions">
        <a className="hero-content__primary" href="/join">
          Join Holdfast
        </a>
        <a className="hero-content__secondary" href="/charter">
          Read the Charter
        </a>
      </div>
    </section>
  )
}

export default HeroContent
