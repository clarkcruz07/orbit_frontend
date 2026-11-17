import './pages.css'

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="page-title-block">
      <span className="page-eyebrow">BLUEDGE PEOPLE</span>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  )
}
