'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, notificationsApi, type NotificationRow } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { Alert, Badge, Card, Spinner } from '@/components/ui'

export default function NotificationsPage() {
  const t = useTranslations('rider')
  const tc = useTranslations('common')
  const [rows, setRows] = useState<NotificationRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      setRows(await notificationsApi.list())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'))
    }
  }, [tc])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('notificationsTitle')}</h1>
      {error && <Alert>{error}</Alert>}
      {!rows && !error && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}
      {rows && rows.length === 0 && (
        <Card>
          <p className="text-sm text-gray-500">{t('notificationsEmpty')}</p>
        </Card>
      )}
      {rows && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.publicId} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{row.title}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{row.body}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={row.readAt ? 'neutral' : 'info'}>{row.channel}</Badge>
                  <span className="text-xs text-gray-400">{formatDateTime(row.sentAt)}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
