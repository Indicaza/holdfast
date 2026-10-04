import { useCallback, useRef, useState } from 'react'
import Footer from './Footer/Footer.jsx'
import QuestBoard from './QuestBoard/QuestBoard.jsx'
import RecruitmentSnapshot from './RecruitmentSnapshot/RecruitmentSnapshot.jsx'
import HeroContent from './HeroContent/HeroContent.jsx'
import HeroSlideshow from './HeroSlideshow/HeroSlideshow.jsx'
import { useHeroStory } from './HeroStory/heroStory.js'
import Navbar from './Navbar/Navbar.jsx'
import JoinModal from '../Join/JoinModal.jsx'
import './Home.css'

function Home({ overlay = null, initialJoinOpen = false }) {
  const [joinOpen, setJoinOpen] = useState(initialJoinOpen)
  const heroRef = useRef(null)
  const story = useHeroStory({ heroRef, blocked: Boolean(overlay) || joinOpen })
  const isJoinRoute =
    (window.location.pathname.replace(/\/+$/, '') || '/') === '/join'

  const openJoin = useCallback(() => {
    setJoinOpen(true)
  }, [])

  const closeJoin = useCallback(() => {
    if (isJoinRoute) {
      window.location.assign('/')
      return
    }

    setJoinOpen(false)
  }, [isJoinRoute])

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
          <QuestBoard onJoin={openJoin} />
        </main>

        <Footer />
      </div>

      {overlay}
      {!overlay && joinOpen ? <JoinModal onClose={closeJoin} /> : null}
    </div>
  )
}

export default Home
