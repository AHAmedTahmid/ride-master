'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

export default function NotFound() {
  const t = useTranslations('errors')
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-bold">{t('notFound')}</h1>
      <p className="text-gray-500">{t('notFoundBody')}</p>
      <Link
        href="/"
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        {t('goHome')}
      </Link>
    </div>
  )
}
