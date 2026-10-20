'use client'

import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui'

export default function DriverDashboardPage() {
  const t = useTranslations('driver')
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <Card>
        <p className="text-sm text-gray-600 dark:text-gray-300">{t('note')}</p>
      </Card>
    </div>
  )
}
