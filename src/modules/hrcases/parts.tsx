import { Pill } from '@/modules/documents/parts'
import { priorityLabel, priorityTone, statusHint, statusLabel, statusTone } from './logic'

export { ErrorBlock, FieldError, FileField, LoadingCard, Notice, Pager, Pill, Spinner } from '@/modules/documents/parts'

export function StatusPill({ status }: { status: string }) {
  return (
    <Pill tone={statusTone(status)} testId="status-pill" title={statusHint(status)} kind={status}>
      {statusLabel(status)}
    </Pill>
  )
}

export function PriorityPill({ priority }: { priority: string }) {
  return (
    <Pill tone={priorityTone(priority)} testId="priority-pill" kind={priority}>
      {priorityLabel(priority)}
    </Pill>
  )
}
