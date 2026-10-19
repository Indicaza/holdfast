import { cx } from './cx.js'

// A framed surface. tone: default, raised (brighter, gold edge) or dashed
// (an empty or call-to-action state). title and actions form an optional header.
export default function Panel({ as: Tag = 'section', title, titleAs: Title = 'h2', eyebrow, actions, tone = 'default', padding = 'md', className, children, ...rest }) {
  return (
    <Tag className={cx('ds-panel', `ds-panel--${tone}`, `ds-panel--pad-${padding}`, className)} {...rest}>
      {title || actions || eyebrow ? (
        <header className="ds-panel__header">
          <div>
            {eyebrow ? <p className="ds-panel__eyebrow">{eyebrow}</p> : null}
            {title ? <Title className="ds-panel__title">{title}</Title> : null}
          </div>
          {actions ? <div className="ds-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  )
}
