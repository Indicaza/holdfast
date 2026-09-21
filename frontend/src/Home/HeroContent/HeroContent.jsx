import { useEffect, useRef, useState } from 'react'
import './HeroContent.css'

const titleStartDelay = 160
const titleLetterDelay = 38

function useSpelledTitle(text, resetKey) {
  const [typedTitle, setTypedTitle] = useState(text)
  const [isComplete, setIsComplete] = useState(true)

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion) {
      setTypedTitle(text)
      setIsComplete(true)
      return undefined
    }

    let timeout
    let index = 0

    setTypedTitle('')
    setIsComplete(false)

    const typeNextCharacter = () => {
      index += 1
      setTypedTitle(text.slice(0, index))

      if (index >= text.length) {
        setIsComplete(true)
        return
      }

      timeout = window.setTimeout(typeNextCharacter, titleLetterDelay)
    }

    timeout = window.setTimeout(typeNextCharacter, titleStartDelay)

    return () => window.clearTimeout(timeout)
  }, [resetKey, text])

  return { typedTitle, isComplete }
}

function HeroContent({ slide }) {
  const { typedTitle, isComplete } = useSpelledTitle(slide.title, slide.id)
  const storyRef = useRef(null)
  const hasMeasuredStory = useRef(false)
  const [storyHeight, setStoryHeight] = useState(null)

  useEffect(() => {
    const story = storyRef.current

    if (!story) {
      return undefined
    }

    let frameId

    const measureStory = () => {
      const nextHeight = story.offsetHeight

      if (!hasMeasuredStory.current) {
        hasMeasuredStory.current = true
        setStoryHeight(nextHeight)
        return
      }

      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => setStoryHeight(nextHeight))
    }

    measureStory()
    window.addEventListener('resize', measureStory)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', measureStory)
    }
  }, [slide.id])

  return (
    <section className="hero-content" aria-labelledby="holdfast-title">
      <p className="hero-content__eyebrow">World of Warcraft · Forever · Alliance · PvP</p>

      <div className="hero-content__heading">
        <h1 id="holdfast-title" className="hero-content__title">
          Holdfast
        </h1>
        <p className="hero-content__motto">Servimus ut permaneat.</p>
      </div>

      <div
        className="hero-content__story-shell"
        style={storyHeight ? { height: `${storyHeight}px` } : undefined}
      >
        <div className="hero-content__story" key={slide.id} ref={storyRef}>
          <h2 className="hero-content__principle" aria-label={slide.title}>
            <span aria-hidden="true">{typedTitle}</span>
          </h2>
          <p
            className={`hero-content__description ${
              isComplete ? 'hero-content__description--visible' : ''
            }`}
          >
            {slide.body}
          </p>
        </div>
      </div>

      <div className="hero-content__actions">
        <a className="hero-content__primary" href="/join">
          Join Holdfast
        </a>
        <a className="hero-content__secondary" href="/charter">
          Read the Charter
        </a>
      </div>
    </section>
  )
}

export default HeroContent
