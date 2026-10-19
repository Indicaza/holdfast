import { useRef } from 'react'
import { useSession } from '../Auth/sessionContext.js'
import { GuildCrest } from '../Guilds/GuildCrest.jsx'
import { useGuild } from '../Guild/guildContext.js'
import { guildHeroActions, guildHomeContent } from '../Guild/guildHomeContent.js'
import Footer from './Footer/Footer.jsx'
import QuestBoard from './QuestBoard/QuestBoard.jsx'
import RecruitmentSnapshot from './RecruitmentSnapshot/RecruitmentSnapshot.jsx'
import HeroContent from './HeroContent/HeroContent.jsx'
import HeroSlideshow from './HeroSlideshow/HeroSlideshow.jsx'
import { defaultHeroSlides, heroSlides, useHeroStory } from './HeroStory/heroStory.js'
import { useRecruitment } from '../Join/JoinContext.js'
import './Home.css'

// A guild's home at /:slug: Holdfast's home, with each guild's own name,
// motto, crest and faction.
function Home({ overlay = null }) {
  const { slug, guild } = useGuild()
  const { authenticated, guild: memberGuild } = useSession()
  const { isOpen: joinOpen, openJoin } = useRecruitment()
  const heroRef = useRef(null)
  const content = guildHomeContent(slug, guild)
  const story = useHeroStory({
    heroRef,
    blocked: Boolean(overlay) || joinOpen,
    slides: content.slideSet === 'holdfast' ? heroSlides : defaultHeroSlides,
  })
  const actions = guildHeroActions({ slug, guild, authenticated, memberSlug: memberGuild?.slug })
  const crest = content.holdfast || !guild
    ? null
    : <GuildCrest name={guild.name} accentColor={guild.accentColor} faction={guild.faction} size={72} />

  return (
    <div className="home" data-faction={guild?.faction}>
      <HeroSlideshow story={story} />
      <div className="home__overlay" aria-hidden="true" />

      <div className="home__frame">
        <main className="home__content">
          <section className="home__hero-section" ref={heroRef}>
            <div className="home__hero">
              <HeroContent story={story} content={content} crest={crest} actions={actions} onJoin={openJoin} />
            </div>
          </section>

          <RecruitmentSnapshot content={content.snapshot} />
          <QuestBoard onJoin={openJoin} />
        </main>

        <Footer />
      </div>

      {overlay}
    </div>
  )
}

export default Home
