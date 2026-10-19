import { cx } from './cx.js'

function Swatch({ color }) {
  return color ? <span className="ds-chip__swatch" style={{ '--swatch': color }} aria-hidden="true" /> : null
}

// A static tag. With onRemove it becomes a button that removes itself.
export function Chip({ color, onRemove, removeLabel, className, children }) {
  if (onRemove) {
    return (
      <button type="button" className={cx('ds-chip', 'ds-chip--removable', className)} onClick={onRemove}
        aria-label={removeLabel || `Remove ${typeof children === 'string' ? children : 'filter'}`}>
        <Swatch color={color} />
        {children}
        <svg className="ds-chip__remove" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </button>
    )
  }
  return (
    <span className={cx('ds-chip', 'ds-chip--static', className)} style={color ? { '--chip-tone': color } : undefined}>
      <Swatch color={color} />
      {children}
    </span>
  )
}

// A pressable filter or choice. color tints it with a class colour; faction
// ("alliance" or "horde") takes the faction palette when pressed.
export function ToggleChip({ pressed = false, count, color, faction, className, children, ...rest }) {
  return (
    <button type="button" aria-pressed={pressed} data-faction={faction}
      className={cx('ds-chip', 'ds-chip--toggle', color && 'ds-chip--tinted', faction && 'ds-chip--faction', className)}
      style={color ? { '--chip-tone': color } : undefined} {...rest}>
      <Swatch color={color} />
      <span className="ds-chip__label">{children}</span>
      {count !== undefined && count !== null ? <span className="ds-chip__count">{count}</span> : null}
    </button>
  )
}
