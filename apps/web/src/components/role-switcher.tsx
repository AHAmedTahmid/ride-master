'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { ApiError } from '@/lib/api'
import { homePathForRole, useAuth } from '@/lib/auth'

/** Switches the session's active role when the user holds more than one. */
export function RoleSwitcher() {
  const { profile, switchRole } = useAuth()
  const { replace } = useRouter()
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!profile || profile.roles.length <= 1) return null

  const onChange = async (value: string) => {
    const target = profile.roles.find((r) => r.role === value)
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      // company_owner/driver need the linked company id; it comes from the
      // role row, never from free-form input.
      await switchRole(target.role, target.company?.publicId)
      replace({ pathname: homePathForRole(target.role) })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
        value={profile.activeRole}
        disabled={busy}
        onChange={(e) => void onChange(e.target.value)}
        aria-label={t('common.activeRole', { role: '' })}
      >
        {profile.roles.map((r) => (
          <option key={r.role} value={r.role}>
            {t(`roles.${r.role}`)}
            {r.company ? ` · ${r.company.name}` : ''}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
