import FeatureCardGrid from './FeatureCardGrid/FeatureCardGrid.jsx'
import Footer from './Footer/Footer.jsx'
import FoundingCallout from './FoundingCallout/FoundingCallout.jsx'
import QuestBoard from './QuestBoard/QuestBoard.jsx'
import HeroContent from './HeroContent/HeroContent.jsx'
import HeroSlideshow from './HeroSlideshow/HeroSlideshow.jsx'
import { useHeroStory } from './HeroStory/heroStory.js'
import Navbar from './Navbar/Navbar.jsx'
import './Home.css'

function Home() {
  const { activeIndex, previousIndex, activeSlide } = useHeroStory()

  return (
    <div className="home">
      <HeroSlideshow activeIndex={activeIndex} previousIndex={previousIndex} />
      <div className="home__overlay" aria-hidden="true" />

      <Navbar />

      <div className="home__frame">
        <main className="home__content">
          <section className="home__hero-section">
            <div className="home__hero">
              <HeroContent slide={activeSlide} />
            </div>
          </section>

          <FeatureCardGrid />
          <QuestBoard />
          <FoundingCallout />
        </main>

        <Footer />
      </div>
    </div>
  )
}

export default Home
