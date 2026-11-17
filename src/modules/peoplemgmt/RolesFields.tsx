import { GRANTABLE_ROLES, ROLE_HELP, ROLE_LABEL, type GrantableRole } from './logic'

/** "Employee" is always on; the others are checkboxes. Used by the new-person form and the Account card. */
export function RolesFields({
  roles,
  onChange,
  disabled,
  idPrefix,
  legend = 'Roles',
}: {
  roles: Record<GrantableRole, boolean>
  onChange: (next: Record<GrantableRole, boolean>) => void
  disabled?: boolean
  idPrefix: string
  legend?: string
}) {
  return (
    <fieldset className="pm-fieldset" disabled={disabled} data-testid="roles-fieldset">
      <legend className="pm-legend">{legend}</legend>
      <ul className="pm-roles">
        <li className="pm-role">
          <label className="pm-check">
            <input type="checkbox" checked disabled readOnly data-testid="role-Employee" />
            <span>
              <strong>{ROLE_LABEL.Employee}</strong>
              <span className="pm-help">{ROLE_HELP.Employee}</span>
            </span>
          </label>
        </li>
        {GRANTABLE_ROLES.map((r) => (
          <li key={r} className="pm-role">
            <label className="pm-check" htmlFor={`${idPrefix}-${r}`}>
              <input id={`${idPrefix}-${r}`} type="checkbox" checked={roles[r]} onChange={(e) => onChange({ ...roles, [r]: e.target.checked })} data-testid={`role-${r}`} />
              <span>
                <strong>{ROLE_LABEL[r]}</strong>
                <span className="pm-help">{ROLE_HELP[r]}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}
