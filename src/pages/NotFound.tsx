import { Link } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { PageTitle } from './PageTitle'
import '@/ui/ui.css'

export function NotFound() {
  return (
    <div className="page">
      <PageTitle title="Page not found" />
      <EmptyState
        icon={<SearchX size={28} />}
        title="We can't find that page"
        body="The address may be mistyped or the page may have moved."
        action={
          <Link to="/" className="btn btn-primary">
            Go to Dashboard
          </Link>
        }
      />
    </div>
  )
}
