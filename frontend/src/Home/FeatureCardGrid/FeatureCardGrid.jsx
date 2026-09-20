import FeatureCard from './FeatureCard/FeatureCard.jsx'
import './FeatureCardGrid.css'

const features = [
  {
    title: 'Raids',
    eyebrow: 'Progress together',
    description: 'Organized progression with teams that prepare, improve, and get the job done.',
    symbol: 'I',
    tone: 'blue',
  },
  {
    title: 'PvP',
    eyebrow: 'Stand together',
    description: 'World PvP, premades, duels, and coordinated response when the Alliance needs muscle.',
    symbol: 'II',
    tone: 'steel',
  },
  {
    title: 'Community',
    eyebrow: 'Play together',
    description: 'A durable home for friends, mentors, competitors, crafters, and people with real lives.',
    symbol: 'III',
    tone: 'gold',
  },
  {
    title: 'New Players Welcome',
    eyebrow: 'Your pace, your climb',
    description: 'We will teach you at your pace. Climb as high as you want, or just go fishing. We have your back.',
    symbol: 'IV',
    tone: 'violet',
  },
]

function FeatureCardGrid() {
  return (
    <section className="feature-grid" aria-labelledby="feature-grid-title">
      <div className="feature-grid__heading">
        <p className="feature-grid__eyebrow">Built to endure</p>
        <h2 id="feature-grid-title">A guild with somewhere to go.</h2>
      </div>

      <div className="feature-grid__cards">
        {features.map((feature) => (
          <FeatureCard key={feature.title} {...feature} />
        ))}
      </div>
    </section>
  )
}

export default FeatureCardGrid
