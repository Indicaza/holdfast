import './FeatureCard.css'

function FeatureCard({ title, eyebrow, description, symbol, tone }) {
  return (
    <article className={`feature-card feature-card--${tone}`}>
      <div className="feature-card__glow" aria-hidden="true" />

      <div className="feature-card__content">
        <span className="feature-card__symbol" aria-hidden="true">
          {symbol}
        </span>

        <div className="feature-card__copy">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>

        <div className="feature-card__footer">
          <span>{eyebrow}</span>
          <span className="feature-card__line" aria-hidden="true" />
        </div>
      </div>
    </article>
  )
}

export default FeatureCard
