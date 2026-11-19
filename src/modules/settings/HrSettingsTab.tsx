import { useState } from 'react'
import { Eye } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { settingsApi, type HrSettings } from './api'
import { changedLabel, describeError, moodExplain } from './logic'
import { Panel, Switch } from './parts'
import { WorkScheduleCard } from './WorkScheduleCard'

/**
 * "HR settings" (offered only after `GET /settings` answered 200): the `hr_can_see_mood` switch through `PUT /settings`.
 * It is optimistic and rolls back with a clear message if the server refuses.
 */
export function HrSettingsTab({ settings, onSettings }: { settings: HrSettings; onSettings: (next: HrSettings) => void }) {
  // ------------------------------------------------------------------ mood
  const [mood, setMood] = useState(settings.hr_can_see_mood)
  const [moodBusy, setMoodBusy] = useState(false)
  const [moodStatus, setMoodStatus] = useState<string | null>(null)
  const [moodError, setMoodError] = useState<string | null>(null)

  async function changeMood(next: boolean) {
    if (moodBusy) return
    const before = mood
    setMood(next)
    setMoodBusy(true)
    setMoodStatus(null)
    setMoodError(null)
    try {
      const saved = await settingsApi.saveSettings({ hr_can_see_mood: next })
      setMood(saved.hr_can_see_mood)
      onSettings(saved)
      setMoodStatus(saved.hr_can_see_mood ? 'HR can now see check-in mood.' : 'HR can no longer see check-in mood.')
    } catch (err) {
      setMood(before)
      setMoodError(`${describeError(err, 'Your change was not saved.').message} The switch is back to ${before ? 'On' : 'Off'}.`)
    } finally {
      setMoodBusy(false)
    }
  }

  return (
    <div className="st-stack" data-testid="tab-hr">
      <Panel id="st-mood-h" title="Check-in mood" sub="A privacy setting. It only changes what HR administrators can see." testId="hr-mood-panel">
        <div className="st-setting">
          <div className="st-row-text">
            <strong id="mood-label">HR can see check-in mood</strong>
            <span id="mood-desc" data-testid="mood-explain">
              {moodExplain(mood)}
            </span>
          </div>
          <Switch checked={mood} busy={moodBusy} labelId="mood-label" describedBy="mood-desc" onChange={(n) => void changeMood(n)} testId="mood-switch" />
        </div>
        <div className="st-feedback" aria-live="polite" data-testid="mood-status">
          {moodStatus ? <span className="st-ok">{moodStatus}</span> : null}
        </div>
        {moodError ? (
          <div className="st-feedback-error" data-testid="mood-error">
            <Alert tone="danger">{moodError}</Alert>
          </div>
        ) : null}
        <p className="st-foot" data-testid="mood-changed">
          <Eye size={14} aria-hidden="true" /> {changedLabel(settings.updated.hr_can_see_mood)}
        </p>
      </Panel>

      <WorkScheduleCard />
    </div>
  )
}
