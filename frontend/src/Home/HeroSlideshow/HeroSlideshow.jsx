import { useEffect, useState } from 'react'
import aftermathImage from '../../assets/aftermath.webp'
import deathImage from '../../assets/death.webp'
import dwarfImage from '../../assets/dwarf.webp'
import dungeonImage from '../../assets/dungeon.webp'
import gnomeImage from '../../assets/gnome.webp'
import homeImage from '../../assets/home.webp'
import mountImage from '../../assets/mount.webp'
import pvpImage from '../../assets/pvp.webp'
import ragImage from '../../assets/rag.webp'
import smithImage from '../../assets/smith.webp'
import tankImage from '../../assets/tank.webp'
import './HeroSlideshow.css'

const smoothEase = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
const driftEase = 'cubic-bezier(0.18, 0.72, 0.22, 1)'

const slides = [
  {
    id: 'gnome',
    src: gnomeImage,
    position: 'center center',
    origin: 'center center',
    pan: {
      startScale: '1.055',
      endScale: '1.018',
      startX: '0.7%',
      endX: '-0.45%',
      startY: '0.1%',
      endY: '-0.1%',
      duration: 8600,
      easing: driftEase,
    },
  },
  {
    id: 'dwarf',
    src: dwarfImage,
    position: 'center top',
    origin: 'center top',
    pan: {
      startScale: '1.06',
      endScale: '1.02',
      startX: '-0.65%',
      endX: '0.35%',
      startY: '0.1%',
      endY: '0%',
      duration: 8400,
      easing: smoothEase,
    },
  },
  {
    id: 'smith',
    src: smithImage,
    position: 'center center',
    origin: 'center center',
    pan: {
      startScale: '1.065',
      endScale: '1.022',
      startX: '0.35%',
      endX: '-0.25%',
      startY: '0.2%',
      endY: '-0.05%',
      duration: 8200,
      easing: smoothEase,
    },
  },
  {
    id: 'tank',
    src: tankImage,
    position: 'center 38%',
    origin: 'center 48%',
    pan: {
      startScale: '1.08',
      endScale: '1.02',
      startX: '0.15%',
      endX: '-0.05%',
      startY: '1.45%',
      endY: '-1.1%',
      duration: 8600,
      easing: driftEase,
    },
  },
  {
    id: 'dungeon',
    src: dungeonImage,
    position: 'center center',
    origin: 'center center',
    pan: {
      startScale: '1.07',
      endScale: '1.02',
      startX: '-0.85%',
      endX: '0.2%',
      startY: '0.25%',
      endY: '-0.2%',
      duration: 8400,
      easing: driftEase,
    },
  },
  {
    id: 'mount',
    src: mountImage,
    position: 'center center',
    origin: 'center center',
    pan: {
      startScale: '1.06',
      endScale: '1.02',
      startX: '-0.55%',
      endX: '0.45%',
      startY: '0.1%',
      endY: '-0.1%',
      duration: 8000,
      easing: smoothEase,
    },
  },
  {
    id: 'pvp',
    src: pvpImage,
    position: 'center center',
    origin: 'center center',
    pan: {
      startScale: '1.07',
      endScale: '1.018',
      startX: '0.8%',
      endX: '-0.55%',
      startY: '0.1%',
      endY: '-0.1%',
      duration: 8400,
      easing: driftEase,
    },
  },
  {
    id: 'death',
    src: deathImage,
    position: 'center center',
    origin: 'center center',
    pan: {
      startScale: '1.055',
      endScale: '1.018',
      startX: '-0.3%',
      endX: '0.25%',
      startY: '-0.1%',
      endY: '0.2%',
      duration: 7900,
      easing: smoothEase,
    },
  },
  {
    id: 'rag',
    src: ragImage,
    position: 'center center',
    origin: 'center center',
    pan: {
      startScale: '1.08',
      endScale: '1.015',
      startX: '0.55%',
      endX: '-0.25%',
      startY: '0.2%',
      endY: '-0.1%',
      duration: 8600,
      easing: driftEase,
    },
  },
  {
    id: 'home',
    src: homeImage,
    position: 'center center',
    origin: 'center center',
    pan: {
      startScale: '1.055',
      endScale: '1.018',
      startX: '-0.7%',
      endX: '0.35%',
      startY: '0.1%',
      endY: '-0.1%',
      duration: 8300,
      easing: smoothEase,
    },
  },
  {
    id: 'aftermath',
    src: aftermathImage,
    position: 'center center',
    origin: 'center center',
    pan: {
      startScale: '1.05',
      endScale: '1.01',
      startX: '0.35%',
      endX: '-0.15%',
      startY: '0.05%',
      endY: '0%',
      duration: 7800,
      easing: smoothEase,
    },
  },
]

const initialSlideDuration = 12000
const slideDuration = 8600
const fadeDuration = 1800

function getSlideStyle(slide, shouldRenderImage) {
  return {
    backgroundImage: shouldRenderImage
      ? `linear-gradient(115deg, rgba(7, 17, 31, 0.2), rgba(7, 17, 31, 0.02) 58%, rgba(7, 17, 31, 0.18)), url("${slide.src}")`
      : 'none',
    backgroundPosition: slide.position,
    transformOrigin: slide.origin,
    '--hero-fade-duration': `${fadeDuration}ms`,
    '--hero-pan-duration': `${slide.pan.duration ?? slideDuration}ms`,
    '--hero-pan-easing': slide.pan.easing ?? smoothEase,
    '--hero-scale-start': slide.pan.startScale ?? '1.06',
    '--hero-scale-end': slide.pan.endScale ?? '1.02',
    '--hero-pan-start-x': slide.pan.startX ?? '0%',
    '--hero-pan-end-x': slide.pan.endX ?? '0%',
    '--hero-pan-start-y': slide.pan.startY ?? '0%',
    '--hero-pan-end-y': slide.pan.endY ?? '0%',
  }
}

function HeroSlideshow() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [previousIndex, setPreviousIndex] = useState(null)

  useEffect(() => {
    const nextIndex = (activeIndex + 1) % slides.length
    const nextImage = new Image()
    nextImage.decoding = 'async'
    nextImage.src = slides[nextIndex].src

    const currentDuration =
      activeIndex === 0 && previousIndex === null
        ? initialSlideDuration
        : slideDuration

    const timer = window.setTimeout(() => {
      setPreviousIndex(activeIndex)
      setActiveIndex(nextIndex)
    }, currentDuration)

    return () => window.clearTimeout(timer)
  }, [activeIndex, previousIndex])

  return (
    <div className="hero-slideshow" aria-hidden="true">
      {slides.map((slide, index) => {
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
