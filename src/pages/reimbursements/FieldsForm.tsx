import type { Fields, FieldState, Reimbursement } from '@/api/reimbursements'
import { Pill } from './parts'
import {
  FIELD_DEFS,
  MAX_NOTES,
  MAX_PURPOSE,
  confidenceLabel,
  flagText,
  formatDate,
  formatMoney,
  isLowConfidence,
  liveSource,
  sourceLabel,
  sourceLabelForReviewer,
  type FieldDef,
  type FieldKey,
  type FieldSource,
  type FormTexts,
  type Tone,
} from './logic'

const SOURCE_TONE: Record<FieldSource, Tone> = { extracted: 'blue', edited: 'amber', entered: 'violet', empty: 'neutral' }

function displayValue(key: FieldKey, value: string | null, currency: string | null): string {
  if (value === null || value === '') return ''
  if (key === 'receipt_date') return formatDate(value)
  return key === 'total_amount' || key === 'tax_amount' ? formatMoney(currency, value) : value
}

interface EditorProps {
  req: Reimbursement
  currencies: readonly string[]
  texts: FormTexts
  purpose: string
  notes: string
  errors: Partial<Record<string, string>>
  canEdit: boolean
  onText: (key: FieldKey, value: string) => void
  onPurpose: (v: string) => void
  onNotes: (v: string) => void
}

function Input({ def, value, onChange, disabled, currencies, invalid, describedBy }: {
  def: FieldDef
  value: string
  onChange: (v: string) => void
  disabled: boolean
  currencies: readonly string[]
  invalid: boolean
  describedBy: string
}) {
  const common = { id: `f-${def.key}`, disabled, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy, 'data-testid': `field-${def.key}` }
  if (def.kind === 'select') {
    const options = value && !currencies.includes(value) ? [value, ...currencies] : [...currencies]
    return (
      <select {...common} className="r-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select currency</option>
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    )
  }
  if (def.kind === 'date') {
    return <input {...common} className="r-input" type="date" min="2000-01-01" value={value} onChange={(e) => onChange(e.target.value)} />
  }
  return (
    <input
      {...common}
      className="r-input"
      type="text"
      inputMode={def.kind === 'money' ? 'decimal' : undefined}
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function FieldRow({ def, field, text, hasExtraction, extractionFailed, error, disabled, currencies, onChange }: {
  def: FieldDef
  field: FieldState
  text: string
  hasExtraction: boolean
  extractionFailed: boolean
  error: string | undefined
  disabled: boolean
  currencies: readonly string[]
  onChange: (v: string) => void
}) {
  const live = liveSource(def.key, text, field)
  const empty = text.trim() === ''
  const flag = empty ? flagText(field.flag) : null
  const showOriginal = live === 'edited' && field.extracted_value !== null
  const lowExtracted = live === 'extracted' && isLowConfidence(field.confidence)
  const describedBy = `prov-${def.key} hint-${def.key} err-${def.key}`
  return (
    <div className={`r-field${error ? ' has-error' : ''}`} data-testid={`field-wrap-${def.key}`}>
      <label className="r-label" htmlFor={`f-${def.key}`}>
        {def.label}
        {def.required ? <span className="r-req" aria-hidden="true"> *</span> : <span className="r-opt"> (optional)</span>}
      </label>
      <Input def={def} value={text} onChange={onChange} disabled={disabled} currencies={currencies} invalid={Boolean(error)} describedBy={describedBy} />
      <div className="r-prov" id={`prov-${def.key}`}>
        <Pill tone={SOURCE_TONE[live]} testId={`prov-${def.key}`} title={field.confidence !== null && live === 'extracted' ? confidenceLabel(field.confidence) : undefined}>
          {sourceLabel(live, hasExtraction)}
        </Pill>
        {lowExtracted ? (
          <Pill tone="amber" testId={`low-${def.key}`} title={confidenceLabel(field.confidence)}>
            Low confidence - please check
          </Pill>
        ) : null}
        {showOriginal ? (
          <span className="r-orig" data-testid={`orig-${def.key}`}>
            Extracted: <strong>{field.extracted_value}</strong>
            {isLowConfidence(field.confidence) ? ' (low confidence)' : ''}
          </span>
        ) : null}
      </div>
      <div className="r-field-notes" id={`hint-${def.key}`}>
        {empty && live === 'empty' && hasExtraction ? (
          <span className="r-hint" data-testid={`hint-${def.key}`}>
            {extractionFailed ? "Couldn't be read from the receipt - please enter" : 'Not found on receipt - please enter'}
          </span>
        ) : null}
        {flag ? (
          <span className="r-flag" data-testid={`flag-${def.key}`}>
            {flag} It was not filled in.
          </span>
        ) : null}
      </div>
      <div className="r-field-error" id={`err-${def.key}`} data-testid={error ? `err-${def.key}` : undefined} role={error ? 'alert' : undefined}>
        {error ?? ''}
      </div>
    </div>
  )
}

/** The review form: every value shows where it came from; missing values stay empty. */
export function FieldsForm({ req, currencies, texts, purpose, notes, errors, canEdit, onText, onPurpose, onNotes }: EditorProps) {
  const fields: Fields = req.fields
  const hasExtraction = req.extraction !== null
  const failed = req.extraction?.status === 'failed'
  return (
    <section className="card card-pad r-section" aria-labelledby="r-details-h" data-testid="fields-form">
      <h2 id="r-details-h">Receipt details</h2>
      <p className="card-sub">Check each value against the receipt. You are responsible for what you submit.</p>

      <div className="r-field r-field-wide">
        <label className="r-label" htmlFor="f-purpose">
          Purpose <span className="r-req" aria-hidden="true">*</span>
        </label>
        <input id="f-purpose" className="r-input" value={purpose} maxLength={MAX_PURPOSE} disabled={!canEdit} onChange={(e) => onPurpose(e.target.value)} data-testid="field-purpose" aria-describedby="err-purpose" />
        <div className="r-field-error" id="err-purpose" data-testid={errors.purpose ? 'err-purpose' : undefined} role={errors.purpose ? 'alert' : undefined}>
          {errors.purpose ?? ''}
        </div>
      </div>

      <div className="r-fields-grid">
        {FIELD_DEFS.map((def) => (
          <FieldRow
            key={def.key}
            def={def}
            field={fields[def.key]}
            text={texts[def.key]}
            hasExtraction={hasExtraction}
            extractionFailed={failed}
            error={errors[def.key]}
            disabled={!canEdit}
            currencies={currencies}
            onChange={(v) => onText(def.key, v)}
          />
        ))}
      </div>

      <div className="r-field r-field-wide">
        <label className="r-label" htmlFor="f-notes">
          Notes <span className="r-opt">(optional)</span>
        </label>
        <textarea id="f-notes" className="r-input r-textarea" rows={3} maxLength={MAX_NOTES} value={notes} disabled={!canEdit} onChange={(e) => onNotes(e.target.value)} data-testid="field-notes" aria-describedby="err-notes" />
        <div className="r-help-row">
          <span>Anything a reviewer should know.</span>
          <span className="r-counter">
            {notes.length}/{MAX_NOTES}
          </span>
        </div>
        <div className="r-field-error" id="err-notes" data-testid={errors.notes ? 'err-notes' : undefined} role={errors.notes ? 'alert' : undefined}>
          {errors.notes ?? ''}
        </div>
      </div>
    </section>
  )
}

/** Read-only "Extracted vs final" table for reviewers, HR and the employee after submit. */
export function ReadOnlyFields({ req }: { req: Reimbursement }) {
  const hasExtraction = req.extraction !== null
  return (
    <section className="card card-pad r-section" aria-labelledby="r-final-h" data-testid="readonly-fields">
      <h2 id="r-final-h">Extracted vs final</h2>
      <p className="card-sub">
        {hasExtraction
          ? `Values were suggested by ${req.extraction?.model_label}. This shows which final values were extracted, edited or entered by the employee.`
          : 'No automatic extraction ran for this request. All values were entered by the employee.'}
      </p>
      <table className="r-table r-ro-table">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Final value</th>
            <th scope="col">Source</th>
            <th scope="col">Originally extracted</th>
          </tr>
        </thead>
        <tbody>
          {FIELD_DEFS.map((def) => {
            const f = req.fields[def.key]
            const final = displayValue(def.key, f.value, req.fields.currency.value)
            const orig = displayValue(def.key, f.extracted_value, req.fields.currency.value)
            return (
              <tr key={def.key} data-testid={`ro-${def.key}`} data-source={f.source}>
                <th scope="row" data-label="Field">
                  {def.label}
                </th>
                <td data-label="Final value" data-testid={`ro-value-${def.key}`}>
                  {final || <span className="r-muted">Not provided</span>}
                </td>
                <td data-label="Source">
                  <Pill tone={SOURCE_TONE[f.source]} testId={`ro-source-${def.key}`}>
                    {f.source === 'empty' ? 'Empty' : sourceLabelForReviewer(f.source)}
                  </Pill>
                  {isLowConfidence(f.confidence) && f.extracted_value !== null ? (
                    <Pill tone="amber" title={confidenceLabel(f.confidence)} testId={`ro-low-${def.key}`}>
                      Low confidence
                    </Pill>
                  ) : null}
                </td>
                <td data-label="Originally extracted" data-testid={`ro-orig-${def.key}`}>
                  {f.extracted_value !== null ? orig : <span className="r-muted">{hasExtraction ? 'Not found' : '-'}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {req.notes ? (
        <p className="r-notes-ro" data-testid="ro-notes">
          <strong>Notes:</strong> {req.notes}
        </p>
      ) : null}
    </section>
  )
}
