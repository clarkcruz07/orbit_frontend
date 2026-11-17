import { useEffect, useRef, useState, type Ref } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Menu } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { initialsOf, roleLabel } from '@/lib/authLogic'
import { signOut } from '@/auth/session'
import { HeaderSearch } from './HeaderSearch'
import { NotificationBell } from './NotificationBell'

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

export function Header({ onMenu, menuOpen, navId, menuRef }: { onMenu: () => void; menuOpen: boolean; navId: string; menuRef?: Ref<HTMLButtonElement> }) {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useDismiss(profileOpen, () => setProfileOpen(false))

  const initials = user?.avatar_initials || initialsOf(user?.name)

  async function onSignOut() {
    setProfileOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header className={`topbar${searchOpen ? ' search-open' : ''}`}>
      <button ref={menuRef} type="button" className="topbar-menu" onClick={onMenu} aria-label="Open navigation" aria-expanded={menuOpen} aria-controls={navId}>
        <Menu size={22} />
      </button>

      <HeaderSearch expanded={searchOpen} onExpand={() => setSearchOpen(true)} onCollapse={() => setSearchOpen(false)} />

      <div className="topbar-right">
        <NotificationBell />
        <span className="topbar-sep" aria-hidden="true" />
        <div className="popover-anchor" ref={profileRef}>
          <button type="button" className="profile-button" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((v) => !v)}>
            <span className="avatar avatar-profile" aria-hidden="true">
              {initials}
            </span>
            <span className="profile-text">
              <span className="profile-name">{user?.name ?? 'Signed in'}</span>
              <span className="profile-role">{user?.job_title || roleLabel(user?.roles)}</span>
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
          {profileOpen ? (
            <div className="popover popover-profile" role="menu">
              <button type="button" role="menuitem" className="menu-item" onClick={() => void onSignOut()}>
                <LogOut size={16} aria-hidden="true" />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
