// A boss's portrait, or the game's boss skull in the same ring when none is known.
export default function BossPortrait({ boss, size = 44 }) {
  return boss.portraitUrl
    ? <img className="gw-atlas-portrait" src={boss.portraitUrl} alt="" width={size} height={size} />
    : <span className="gw-atlas-portrait gw-atlas-portrait--blank" style={{ width: size, height: size }} aria-hidden="true"><img className="gw-atlas-portrait__skull" src="/wow-art/boss-skull.png" alt="" width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} /></span>
}
