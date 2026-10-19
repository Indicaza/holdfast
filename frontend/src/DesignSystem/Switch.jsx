import { cx } from './cx.js'

// An on/off checkbox drawn as a sliding switch, with a 44px hit area.
export default function Switch({ label, className, ...rest }) {
  return (
    <label className={cx('ds-switch', className)}>
      <input type="checkbox" role="switch" className="ds-switch__input" {...rest} />
      <span className="ds-switch__track" aria-hidden="true"><span className="ds-switch__thumb" /></span>
      <span className="ds-switch__label">{label}</span>
    </label>
  )
}
