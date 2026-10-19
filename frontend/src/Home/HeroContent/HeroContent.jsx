import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../Auth/sessionContext.js'
import './HeroContent.css'

// The home hero: the guild's heading (content from Guild/guildHomeContent.js),
// the slideshow's captions and the guild's two calls to action.
function HeroContent({ story, content, crest = null, actions, onJoin }) {
  const { status, refresh } = useSession()
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
      {crest ? <div className="hero-content__crest">{crest}</div> : null}
      <p className="hero-content__eyebrow">{content.eyebrow}</p>
      <div className="hero-content__heading">
        <h1 id="holdfast-title" className="hero-content__title">{content.name}</h1>
        {content.motto ? <p className="hero-content__motto">{content.motto}</p> : null}
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
        ) : actions.primary.join ? (
          <button className="hero-content__primary" type="button" onClick={onJoin}>{actions.primary.label}</button>
        ) : (
          <a className="hero-content__primary" href={actions.primary.href}>{actions.primary.label}</a>
        )}
        <a className="hero-content__secondary" href={actions.secondary.href}>{actions.secondary.label}</a>
      </div>
      <div className="hero-content__playback" role="group" aria-label="Story playback">
        <button type="button" aria-label="Previous scene" disabled={story.isLoading} onClick={() => story.playback.navigate(-1)}>
          <span aria-hidden="true">←</span>
        </button>
        <button type="button" aria-label={story.userPaused ? 'Play story' : 'Pause story'} onClick={story.playback.toggle}>
          <span aria-hidden="true">{story.userPaused ? '▶' : 'Ⅱ'}</span>
        </button>
        <span className="hero-content__scene-count" aria-label={`Scene ${story.captionIndex + 1} of ${story.slides.length}`}>
          {String(story.captionIndex + 1).padStart(2, '0')} / {story.slides.length}
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
