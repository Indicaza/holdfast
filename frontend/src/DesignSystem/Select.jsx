import Field from './Field.jsx'
import { cx } from './cx.js'

function normalise(option) {
  return Array.isArray(option) ? { value: option[0], label: option[1] } : option
}

// A native select in the house style. options is a list of { value, label }
// or [value, label] pairs (Object.entries of a label map works as is).
// placeholder adds a leading empty option; inline puts the label beside it.
export default function Select({
  label,
  hint,
  error,
  hideLabel,
  inline,
  options = [],
  placeholder,
  placeholderDisabled = false,
  size = 'md',
  className,
  ...rest
}) {
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} inline={inline} className={className}>
      {(fieldProps) => (
        <span className={cx('ds-control', 'ds-select', `ds-control--${size}`)}>
          <select className="ds-control__input" {...fieldProps} {...rest}>
            {placeholder !== undefined ? <option value="" disabled={placeholderDisabled}>{placeholder}</option> : null}
            {options.map(normalise).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <svg className="ds-select__chevron" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m3 5 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </Field>
  )
}
