import {
  fadeDuration,
  heroSlides,
  slideDuration,
} from '../HeroStory/heroStory.js'
import './HeroSlideshow.css'

function getSlideStyle(slide, shouldRenderImage) {
  return {
    backgroundImage: shouldRenderImage
      ? `linear-gradient(115deg, rgba(7, 17, 31, 0.2), rgba(7, 17, 31, 0.02) 58%, rgba(7, 17, 31, 0.18)), url("${slide.src}")`
      : 'none',
    backgroundPosition: slide.position,
    transformOrigin: slide.origin,
    '--hero-fade-duration': `${fadeDuration}ms`,
    '--hero-pan-duration': `${slide.pan.duration ?? slideDuration}ms`,
    '--hero-pan-easing': slide.pan.easing ?? 'cubic-bezier(0.22, 0.61, 0.36, 1)',
    '--hero-scale-start': slide.pan.startScale ?? '1.06',
    '--hero-scale-end': slide.pan.endScale ?? '1.02',
    '--hero-pan-start-x': slide.pan.startX ?? '0%',
    '--hero-pan-end-x': slide.pan.endX ?? '0%',
    '--hero-pan-start-y': slide.pan.startY ?? '0%',
    '--hero-pan-end-y': slide.pan.endY ?? '0%',
  }
}

function HeroSlideshow({ activeIndex, previousIndex }) {
  return (
    <div className="hero-slideshow" aria-hidden="true">
      {heroSlides.map((slide, index) => {
        const isActive = index === activeIndex
        const isPrevious = index === previousIndex
        const shouldRenderImage = isActive || isPrevious

        const classNames = ['hero-slideshow__slide']

        if (isActive) {
          classNames.push('hero-slideshow__slide--active')
        }

        if (isPrevious) {
          classNames.push('hero-slideshow__slide--previous')
        }

        return (
          <div
            key={slide.id}
            className={classNames.join(' ')}
            style={getSlideStyle(slide, shouldRenderImage)}
          />
        )
      })}

      <div
        className="hero-slideshow__bloom"
        style={{ animationDuration: `${slideDuration + 4400}ms` }}
      />
      <div className="hero-slideshow__vignette" />
      <div className="hero-slideshow__texture" />
    </div>
  )
}

export default HeroSlideshow
