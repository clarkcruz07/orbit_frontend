import { Link } from 'react-router-dom'
import { ArrowRight, Receipt, Laptop, FileBadge, UserPen, GraduationCap, CalendarClock, type LucideIcon } from 'lucide-react'
import { PageTitle } from './PageTitle'
import './pages.css'

const COMING_SOON: { id: string; title: string; body: string; icon: LucideIcon }[] = [
  { id: 'leave-adjustment', title: 'Leave adjustment', body: 'Ask HR to correct a leave balance or booking.', icon: CalendarClock },
  { id: 'equipment', title: 'Equipment request', body: 'Request a laptop, monitor or other work equipment.', icon: Laptop },
  { id: 'certificate', title: 'Employment certificate', body: 'Request a certificate of employment.', icon: FileBadge },
  { id: 'personal-details', title: 'Personal details change', body: 'Ask HR to update your contact or personal details.', icon: UserPen },
  { id: 'training', title: 'Training request', body: 'Request approval for a course or training.', icon: GraduationCap },
]

export function HrRequests() {
  return (
    <div className="page">
      <PageTitle title="HR Requests" subtitle="Raise a request with HR." />
      <p className="browse-directory-row">
        <Link to="/directory" className="request-card-open" data-testid="browse-directory">
          Browse the directory <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </p>
      <ul className="request-grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        <li>
          <Link to="/reimbursements" className="request-card request-card-live" data-testid="request-reimbursements" style={{ height: '100%' }}>
            <span className="request-card-icon">
              <Receipt size={24} />
            </span>
            <h2>Reimbursements</h2>
            <p>Submit a receipt, review it and send it for approval.</p>
            <span className="request-card-open">
              Open <ArrowRight size={16} aria-hidden="true" />
            </span>
          </Link>
        </li>
        {COMING_SOON.map((c) => (
          <li key={c.id}>
            <div className="request-card request-card-soon" data-testid={`request-soon-${c.id}`} style={{ height: '100%' }}>
              <span className="request-card-icon">
                <c.icon size={24} />
              </span>
              <h2>{c.title}</h2>
              <p>{c.body}</p>
              <span className="soon-tag">Coming soon</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
