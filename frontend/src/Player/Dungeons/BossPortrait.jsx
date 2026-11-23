// A boss's portrait, or the same ring with a plain helm when none is known.
export default function BossPortrait({ boss, size = 44 }) {
  return boss.portraitUrl
    ? <img className="gw-atlas-portrait" src={boss.portraitUrl} alt="" width={size} height={size} />
    : <span className="gw-atlas-portrait gw-atlas-portrait--blank" style={{ width: size, height: size }} aria-hidden="true"><svg className="gw-atlas-portrait__helm" viewBox="0 0 24 24" width={Math.round(size * 0.5)} height={Math.round(size * 0.5)}><path d="M5 11a7 7 0 0 1 14 0v7l-3 2v-6h-2.5v6h-3v-6H8v6l-3-2z" /><path d="M12 4v6" /></svg></span>
}
