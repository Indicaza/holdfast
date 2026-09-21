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

const smoothEase = 'cubic-bezier(0.2, 0.58, 0.36, 0.98)'
const driftEase = 'cubic-bezier(0.16, 0.7, 0.28, 0.98)'

export const initialSlideDuration = 18000
export const slideDuration = 16000
export const fadeDuration = 2600

export const heroSlides = [
  {
    id: 'gnome',
    title: 'Service',
    body: 'Bring what you can. A flower. A recipe. An hour of your time. Holdfast runs on people choosing to be useful to one another. Help build the guild, and the guild has more strength to put back into all of us.',
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
      duration: 20600,
      easing: driftEase,
    },
  },
  {
    id: 'dwarf',
    title: 'Abundance Mindset',
    body: 'Contributions are the snowball, not the destination. Tithes build the reserve. Crafting, trade, Auction House data, and intelligent use of AI help us multiply it. Abundance gives us options, and options are where the fun starts.',
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
      duration: 18600,
      easing: smoothEase,
    },
  },
  {
    id: 'smith',
    title: 'Pay It Forward',
    body: 'No sainthood required. Help somebody become stronger and you just strengthened your own guild. Teach the trick. Share the recipe. Hand over the sword. Invest in good people and eventually that strength finds its way back to you.',
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
      duration: 18600,
      easing: smoothEase,
    },
  },
  {
    id: 'tank',
    title: 'Leadership Is Service',
    body: 'Being the highest parser in Azeroth does not make you a leader. Do the work first. Take responsibility. Teach what you know. The best leaders make themselves replaceable. Let the title catch up later.',
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
      duration: 18600,
      easing: driftEase,
    },
  },
  {
    id: 'dungeon',
    title: 'Push Your Limits',
    body: 'You do not find your limits by staying comfortably inside them. Pull a little harder. Try the ambitious route. Keep your cool when things get spicy. Test yourself, trust your team, and accept that your healer may have notes.',
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
      duration: 18600,
      easing: driftEase,
    },
  },
  {
    id: 'mount',
    title: 'You Earned It!',
    body: 'Pats on the back are nice. Sometimes the guild can do better. Work hard, help people, celebrate the wins, and enjoy the grin when something you wanted finally becomes yours. Pay it forward. Good things have a funny way of circling back.',
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
      duration: 18600,
      easing: smoothEase,
    },
  },
  {
    id: 'pvp',
    title: 'Honor-Bound Warriors',
    body: 'We defend our people, protect our lands, and go looking for trouble when trouble comes looking for us. The Horde will test us. Excellent. Let us return the favor.',
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
      duration: 18600,
      easing: driftEase,
    },
  },
  {
    id: 'death',
    title: 'The Gift of Failure',
    body: 'Failure stings. Be annoyed. Learn something anyway. Dust yourself off, make the run, and return stronger. If somebody is eating your corpse, get the name. Revenge is unhealthy, of course. We prefer the term redemption.',
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
      duration: 18600,
      easing: smoothEase,
    },
  },
  {
    id: 'rag',
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
      duration: 18600,
      easing: driftEase,
    },
  },
  {
    id: 'home',
    title: 'Home',
    body: 'If WoW Forever gives us another twenty years in Azeroth, build something worth returning to. Make friends. Build competence, wealth, alliances, and memories. Then disappear for a while. Touch grass. Holdfast is built for the ebb and flow, and for the day you wander home.',
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
      duration: 18600,
      easing: smoothEase,
    },
  },
  {
    id: 'aftermath',
    title: 'Leave It Stronger',
    body: 'Kill the boss. Spend the gold. Tell the stupid story again over a drink. The gear gets replaced. The stories get better every time. The people are what you remember. Leave it stronger.',
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
      duration: 18600,
      easing: smoothEase,
    },
  },
]

export function useHeroStory() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [previousIndex, setPreviousIndex] = useState(null)

  useEffect(() => {
    const nextIndex = (activeIndex + 1) % heroSlides.length
    const nextImage = new Image()
    nextImage.decoding = 'async'
    nextImage.src = heroSlides[nextIndex].src

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

  return {
    activeIndex,
    previousIndex,
    activeSlide: heroSlides[activeIndex],
  }
}
