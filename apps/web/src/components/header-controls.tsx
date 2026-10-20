'use client'

import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { meApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useTheme } from './theme-provider'

export function LocaleSwitcher() {
  const locale = useLocale()
  const { replace } = useRouter()
  const pathname = usePathname()
  const next = locale === 'en' ? 'dv' : 'en'
  const { status } = useAuth()

  const switchTo = async () => {
    // Persist the preference server-side when signed in; the UI switch always works.
    if (status === 'authenticated') {
      await meApi.setLanguage(next).catch(() => undefined)
    }
    replace({ pathname }, { locale: next })
  }

  return (
    <button
      type="button"
      onClick={switchTo}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      aria-label="Switch language"
    >
      {next === 'dv' ? 'ދިވެހި' : 'English'}
    </button>
  )
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}

export function LogoutButton() {
  const { logout } = useAuth()
  const { replace } = useRouter()
  const t = useTranslations('common')
  return (
    <button
      type="button"
      onClick={async () => {
        await logout()
        replace({ pathname: '/login' })
      }}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
    >
      {t('logout')}
    </button>
  )
}
