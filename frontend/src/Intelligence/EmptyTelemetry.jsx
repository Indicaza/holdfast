export default function EmptyTelemetry({ title, children }) {
  return (
    <section className="armory-empty">
      <span aria-hidden="true">✦</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </section>
  )
}
