import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../Auth/sessionContext.js'
import { heroSlides } from '../HeroStory/heroStory.js'
import './HeroContent.css'

function HeroContent({ story, onJoin }) {
  const { authenticated, status, refresh } = useSession()
  const slide = story.activeSlide
  const storyRef = useRef(null)
  const [storyHeight, setStoryHeight] = useState(null)

  useEffect(() => {
    const element = storyRef.current
    const measure = () => setStoryHeight(element.offsetHeight)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])

  return (
    <section className="hero-content" aria-labelledby="holdfast-title">
      <p className="hero-content__eyebrow">World of Warcraft · Forever · Alliance · PvP</p>
      <div className="hero-content__heading">
        <h1 id="holdfast-title" className="hero-content__title">Holdfast</h1>
        <p className="hero-content__motto">Servimus ut permaneat.</p>
      </div>
      <div
        className="hero-content__story-shell"
        style={storyHeight ? { height: `${storyHeight}px` } : undefined}
      >
        <div
          ref={storyRef}
          className={`hero-content__story hero-content__story--${story.phase} ${story.isPaused ? 'hero-content__story--paused' : ''}`}
          style={{ '--hero-caption-fade': `${story.fadeDuration / 2}ms` }}
          aria-live={story.userPaused ? 'polite' : 'off'}
          aria-atomic="true"
          data-caption={slide.id}
        >
          <h2 className="hero-content__principle">{slide.title}</h2>
          <p className="hero-content__description">{slide.body}</p>
        </div>
      </div>
      <div className="hero-content__actions">
        {status !== 'ready' ? (
          <button className="hero-content__primary" type="button" disabled={status === 'loading'} onClick={refresh}>
            {status === 'loading' ? 'Checking session…' : 'Retry connection'}
          </button>
        ) : authenticated ? (
          <a className="hero-content__primary" href="/quests">View Quests</a>
        ) : (
          <button className="hero-content__primary" type="button" onClick={onJoin}>Join Holdfast</button>
        )}
        <a className="hero-content__secondary" href="/charter">Read the Charter</a>
      </div>
      <div className="hero-content__playback" role="group" aria-label="Story playback">
        <button type="button" aria-label="Previous scene" disabled={story.isLoading} onClick={() => story.playback.navigate(-1)}>
          <span aria-hidden="true">←</span>
        </button>
        <button type="button" aria-label={story.userPaused ? 'Play story' : 'Pause story'} onClick={story.playback.toggle}>
          <span aria-hidden="true">{story.userPaused ? '▶' : 'Ⅱ'}</span>
        </button>
        <span className="hero-content__scene-count" aria-label={`Scene ${story.captionIndex + 1} of ${heroSlides.length}`}>
          {String(story.captionIndex + 1).padStart(2, '0')} / {heroSlides.length}
        </span>
        <button type="button" aria-label="Next scene" disabled={story.isLoading} onClick={() => story.playback.navigate(1)}>
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {story.loadError ? (
        <p className="hero-content__load-error" role="status">
          {story.loadError}{' '}
          <button type="button" onClick={story.playback.retry} disabled={story.isLoading}>Try again</button>
        </p>
      ) : null}
    </section>
  )
}

export default HeroContent
