import FeatureCardGrid from './FeatureCardGrid/FeatureCardGrid.jsx'
import Footer from './Footer/Footer.jsx'
import FoundingCallout from './FoundingCallout/FoundingCallout.jsx'
import GuildIdentity from './GuildIdentity/GuildIdentity.jsx'
import HeroContent from './HeroContent/HeroContent.jsx'
import HeroSlideshow from './HeroSlideshow/HeroSlideshow.jsx'
import Navbar from './Navbar/Navbar.jsx'
import './Home.css'

function Home() {
  return (
    <div className="home">
      <HeroSlideshow />
      <div className="home__overlay" aria-hidden="true" />

      <Navbar />

      <div className="home__frame">
        <main className="home__content">
          <section className="home__hero-section">
            <div className="home__hero">
              <HeroContent />
            </div>
          </section>

          <FeatureCardGrid />
          <GuildIdentity />
          <FoundingCallout />
        </main>

        <Footer />
      </div>
    </div>
  )
}

export default Home
