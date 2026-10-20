'use client'

import { useTranslations } from 'next-intl'
import { useEffect, type ReactNode } from 'react'
import { Link, useRouter } from '@/i18n/navigation'
import { homePathForRole, useAuth } from '@/lib/auth'
import { Spinner } from './ui'
import { LocaleSwitcher, LogoutButton, ThemeToggle } from './header-controls'

/** Wraps every authenticated page: session guard + role-aware chrome. */
export function AppShell({ children }: { children: ReactNode }) {
  const { status, profile } = useAuth()
  const { replace } = useRouter()
  const t = useTranslations()

  useEffect(() => {
    if (status === 'anonymous') {
      replace({ pathname: '/login' })
    }
  }, [status, replace])

  if (status === 'loading' || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    )
  }

  const nav: { href: string; label: string }[] = [
    { href: homePathForRole(profile.activeRole), label: t('nav.dashboard') },
  ]
  if (profile.activeRole === 'superadmin') {
    nav.push({ href: '/admin', label: t('nav.admin') })
  }
  nav.push({ href: '/notifications', label: t('nav.notifications') })

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <Link
            href={homePathForRole(profile.activeRole)}
            className="text-lg font-bold text-brand-700 dark:text-brand-300"
          >
            {t('common.appName')}
          </Link>
          <nav className="ms-4 flex flex-1 gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="hidden text-xs text-gray-500 sm:inline dark:text-gray-400">
            {t('common.activeRole', { role: t(`roles.${profile.activeRole}`) })}
          </span>
          <LocaleSwitcher />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
