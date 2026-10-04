import { heroSlides, initialSlideDuration, slideDuration, fadeDuration } from '../HeroStory/heroStory.js'
import './HeroSlideshow.css'

function getSlideStyle(slide, visit) {
  return {
    backgroundImage: `url("${slide.src}")`,
    '--hero-position': slide.position,
    '--hero-mobile-position': slide.mobilePosition,
    transformOrigin: slide.origin,
    '--hero-pan-duration': `${visit === 0 ? initialSlideDuration + fadeDuration : slideDuration + fadeDuration * 2}ms`,
    '--hero-scale-start': slide.pan.startScale ?? '1.06',
    '--hero-scale-end': slide.pan.endScale ?? '1.02',
    '--hero-pan-start-x': slide.pan.startX ?? '0%',
    '--hero-pan-end-x': slide.pan.endX ?? '0%',
    '--hero-pan-start-y': slide.pan.startY ?? '0%',
    '--hero-pan-end-y': slide.pan.endY ?? '0%',
  }
}

function HeroSlideshow({ story }) {
  const layers = story.previousIndex === null
    ? [{ index: story.imageIndex, visit: story.visit }]
    : [{ index: story.previousIndex, visit: story.previousVisit }, { index: story.imageIndex, visit: story.visit }]

  return (
    <div className={`hero-slideshow ${story.isPaused ? 'hero-slideshow--paused' : ''}`} aria-hidden="true">
      {layers.map(({ index, visit }) => {
        const slide = heroSlides[index]
        const isActive = visit === story.visit
        return (
          <div
            key={visit}
            className={`hero-slideshow__slide ${isActive ? 'hero-slideshow__slide--active' : ''} ${isActive && story.phase !== 'holding' ? 'hero-slideshow__slide--entering' : ''}`}
            data-scene={slide.id}
            style={{ '--hero-fade-duration': `${story.fadeDuration}ms` }}
          >
            <div className="hero-slideshow__art" style={getSlideStyle(slide, visit)} />
          </div>
        )
      })}
      <div className="hero-slideshow__vignette" />
    </div>
  )
}

export default HeroSlideshow
