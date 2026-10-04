import { useEffect, useState, useSyncExternalStore } from 'react'
import { HeroPlayback, loadHeroImage } from './heroPlayback.js'
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

export const initialSlideDuration = 18000
export const slideDuration = 16000
export const fadeDuration = 2600

export const heroSlides = [
  {
    id: 'gnome',
    mobilePosition: '36% center',
    title: 'Service',
    body: 'A flower. A recipe. A little of your time. Small contributions give the whole guild more to work with. Bring what you can.',
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
    },
  },
  {
    id: 'dwarf',
    mobilePosition: '68% top',
    title: 'Abundance Mindset',
    body: 'Those small contributions become stocked shelves, crafted gear, and help when somebody needs it. Put shared resources to work, and everybody has more options.',
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
    },
  },
  {
    id: 'smith',
    mobilePosition: '58% center',
    title: 'Pay It Forward',
    body: 'That sword started with somebody gathering ore. Now it helps another guildmate take the next step. Grow stronger, then help the next person climb.',
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
    },
  },
  {
    id: 'tank',
    mobilePosition: '57% 28%',
    title: 'Leadership Is Service',
    body: 'Good players become better teachers. Share what you know, make room for mistakes, and leave somebody ready to lead the next group. Blue crayons optional.',
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
    },
  },
  {
    id: 'dungeon',
    mobilePosition: '66% center',
    title: 'Push Your Limits',
    body: 'Take what you learned into the dungeon. Trust your team, try the ambitious pull, and keep your cool. Your healer may still have notes.',
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
    },
  },
  {
    id: 'mount',
    mobilePosition: '51% center',
    title: 'You Earned It!',
    body: 'A first mount is a bigger moment with friends beside you. Celebrate the wins, enjoy the ride, and help somebody else get there.',
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
    },
  },
  {
    id: 'pvp',
    mobilePosition: 'center center',
    title: 'Honor-Bound Warriors',
    body: 'When the Horde comes looking for trouble, stand with your people. Protect each other, coordinate, and give them a story worth telling.',
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
    },
  },
  {
    id: 'death',
    mobilePosition: '48% center',
    title: 'The Gift of Failure',
    body: 'Sometimes the plan ends with a corpse run. Laugh, learn, and try again. If somebody is eating your corpse, remember the name. For redemption, obviously.',
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
    },
  },
  {
    id: 'rag',
    mobilePosition: '65% center',
    title: 'Apes Together Strong!',
    body: 'Nobody solos the impossible. Know your job. Trust the lunatic beside you. Carry your share when everything gets loud. Individually capable. Collectively dangerous.',
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
    },
  },
  {
    id: 'home',
    mobilePosition: '44% center',
    title: 'Home',
    body: 'Come back with stories, friends, and a little more confidence. Take a break when life calls. Holdfast should still feel like home when you return.',
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
    },
  },
  {
    id: 'aftermath',
    mobilePosition: '54% center',
    title: 'Leave It Stronger',
    body: 'Kill the boss. Tell the stupid story again over a drink. The gear gets replaced; the people are what you remember. Leave it stronger.',
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
    },
  },
]

export function useHeroStory({ heroRef, blocked = false }) {
  const [playback] = useState(() => new HeroPlayback({
    slides: heroSlides,
    loadImage: loadHeroImage,
    initialDuration: initialSlideDuration,
    duration: slideDuration,
    transitionDuration: fadeDuration,
  }))
  const state = useSyncExternalStore(playback.subscribe, playback.getSnapshot)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => playback.setReducedMotion(media.matches)
    const updateVisibility = () => playback.setPauseReason('hidden', document.hidden)
    const observer = new IntersectionObserver(([entry]) => {
      playback.setPauseReason('offscreen', !entry.isIntersecting)
    }, { threshold: 0.15 })

    updateMotion()
    updateVisibility()
    if (heroRef.current) observer.observe(heroRef.current)
    media.addEventListener('change', updateMotion)
    document.addEventListener('visibilitychange', updateVisibility)
    playback.start()

    return () => {
      playback.stop()
      observer.disconnect()
      media.removeEventListener('change', updateMotion)
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [heroRef, playback])

  useEffect(() => {
    playback.setPauseReason('overlay', blocked)
  }, [blocked, playback])

  return {
    ...state,
    playback,
    activeSlide: heroSlides[state.captionIndex],
    fadeDuration: state.reducedMotion ? 0 : fadeDuration,
  }
}
