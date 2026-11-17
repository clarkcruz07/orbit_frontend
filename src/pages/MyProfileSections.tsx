import { PROFILE_SECTIONS } from '@/api/profile'
import { meApi, type MyProfileData } from '@/api/me'
import { ProfileSectionCard } from '@/modules/peoplemgmt/ProfileParts'
import '@/modules/peoplemgmt/peoplemgmt.css'

/**
 * The person's own HR profile. They can edit their personal details, contact and address, emergency contact and government IDs; the work
 * details, birth year and the basics are HR only and stay read-only ("Ask HR to change this."). Government numbers arrive masked.
 */
export function MyProfileSections({ profile, onUpdated }: { profile: MyProfileData['profile']; onUpdated: (next: MyProfileData) => void }) {
  return (
    <div className="profile-sections" data-testid="profile-sections">
      <div className="profile-sections-head">
        <h2 id="my-details-h">Your details</h2>
        <p className="r-sub" data-testid="profile-change-note">
          You can update your personal, contact, emergency contact and government ID details. Work details and your birth year are set by HR. Ask HR to change this.
        </p>
      </div>
      <div className="profile-sections-grid">
        {PROFILE_SECTIONS.map((s) => (
          <ProfileSectionCard
            key={s.id}
            section={s.id}
            profile={profile}
            mode="self"
            save={async (body) => {
              onUpdated(await meApi.updateProfile(body))
            }}
          />
        ))}
      </div>
    </div>
  )
}
