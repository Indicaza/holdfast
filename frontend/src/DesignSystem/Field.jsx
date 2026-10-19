import { useId } from 'react'
import { cx } from './cx.js'

// Label, hint and error around one form control. Children is a render function
// that receives the props the control needs to be described by them.
export default function Field({ label, hint, error, hideLabel = false, inline = false, className, children }) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cx('ds-field', inline && 'ds-field--inline', error && 'ds-field--error', className)}>
      {label ? <label htmlFor={id} className={cx('ds-field__label', hideLabel && 'ds-visually-hidden')}>{label}</label> : null}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint ? <p id={hintId} className="ds-field__hint">{hint}</p> : null}
      {error ? <p id={errorId} className="ds-field__error" role="alert">{error}</p> : null}
    </div>
  )
}
