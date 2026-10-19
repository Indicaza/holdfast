import { cx } from './cx.js'

// A small status label. tone: neutral, gold, success, danger, arcane, or
// faction (pair with faction="alliance|horde" to use that palette).
export default function Badge({ tone = 'neutral', faction, icon, className, children, ...rest }) {
  return (
    <span className={cx('ds-badge', `ds-badge--${faction ? 'faction' : tone}`, className)} data-faction={faction} {...rest}>
      {icon ? <span className="ds-badge__icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  )
}
