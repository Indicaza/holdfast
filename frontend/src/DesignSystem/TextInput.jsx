import Field from './Field.jsx'
import { cx } from './cx.js'

// A single-line input. icon renders a leading glyph inside the control.
export function TextInput({ label, hint, error, hideLabel, inline, icon, size = 'md', className, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} inline={inline} className={className}>
      {(fieldProps) => (
        <span className={cx('ds-control', `ds-control--${size}`, icon && 'ds-control--icon')}>
          {icon ? <span className="ds-control__icon" aria-hidden="true">{icon}</span> : null}
          <input className="ds-control__input" {...fieldProps} {...rest} />
        </span>
      )}
    </Field>
  )
}

export function TextArea({ label, hint, error, hideLabel, rows = 4, className, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      {(fieldProps) => (
        <span className="ds-control ds-control--multiline">
          <textarea className="ds-control__input" rows={rows} {...fieldProps} {...rest} />
        </span>
      )}
    </Field>
  )
}

export function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" fill="none" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  )
}
