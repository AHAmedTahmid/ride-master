'use client'

import { useTranslations } from 'next-intl'
import { Alert, Card } from '@/components/ui'

export default function RiderDashboardPage() {
  const t = useTranslations('rider')
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">{t('upcoming')}</h2>
          <p className="text-sm text-gray-500">{t('bookingNote')}</p>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{t('past')}</h2>
          <Alert tone="info">{t('bookingNote')}</Alert>
        </Card>
      </div>
    </div>
  )
}
