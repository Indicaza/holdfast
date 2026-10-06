import { useRef } from 'react'
import Footer from './Footer/Footer.jsx'
import GuildweaverPrompt from './GuildweaverPrompt/GuildweaverPrompt.jsx'
import QuestBoard from './QuestBoard/QuestBoard.jsx'
import RecruitmentSnapshot from './RecruitmentSnapshot/RecruitmentSnapshot.jsx'
import HeroContent from './HeroContent/HeroContent.jsx'
import HeroSlideshow from './HeroSlideshow/HeroSlideshow.jsx'
import { useHeroStory } from './HeroStory/heroStory.js'
import Navbar from './Navbar/Navbar.jsx'
import { useRecruitment } from '../Join/JoinContext.js'
import './Home.css'

function Home({ overlay = null }) {
  const { isOpen: joinOpen, openJoin } = useRecruitment()
  const heroRef = useRef(null)
  const story = useHeroStory({ heroRef, blocked: Boolean(overlay) || joinOpen })

  return (
    <div className="home">
      <HeroSlideshow story={story} />
      <div className="home__overlay" aria-hidden="true" />

      <Navbar />

      <div className="home__frame">
        <main className="home__content">
          <section className="home__hero-section" ref={heroRef}>
            <div className="home__hero">
              <HeroContent story={story} onJoin={openJoin} />
            </div>
          </section>

          <RecruitmentSnapshot />
          <GuildweaverPrompt />
          <QuestBoard onJoin={openJoin} />
        </main>

        <Footer />
      </div>

      {overlay}
    </div>
  )
}

export default Home
