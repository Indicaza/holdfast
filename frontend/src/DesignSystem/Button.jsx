import { cx } from './cx.js'

// variant: primary (gold), secondary (outlined), ghost (text only), danger.
// size: md (48px) or lg (56px); sm keeps the 44px touch floor.
// Renders a link when given href; a disabled link is aria-disabled.
export default function Button({
  variant = 'secondary',
  size = 'md',
  href,
  type = 'button',
  block = false,
  loading = false,
  disabled = false,
  icon,
  className,
  children,
  onClick,
  ...rest
}) {
  const inactive = disabled || loading
  const classes = cx('ds-button', `ds-button--${variant}`, `ds-button--${size}`, block && 'ds-button--block', loading && 'ds-button--loading', className)
  const content = (
    <>
      {loading ? <span className="ds-button__spinner" aria-hidden="true" /> : icon ? <span className="ds-button__icon" aria-hidden="true">{icon}</span> : null}
      <span className="ds-button__label">{children}</span>
    </>
  )

  if (href) {
    return (
      <a className={classes} href={inactive ? undefined : href} aria-disabled={inactive || undefined}
        onClick={inactive ? (event) => event.preventDefault() : onClick} {...rest}>
        {content}
      </a>
    )
  }

  return (
    <button type={type} className={classes} disabled={inactive} aria-busy={loading || undefined} onClick={onClick} {...rest}>
      {content}
    </button>
  )
}
