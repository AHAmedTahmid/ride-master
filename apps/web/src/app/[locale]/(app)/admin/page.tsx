'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  auditApi,
  settingsApi,
  type AuditLogPage,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'
import { Alert, Badge, Button, Card, Spinner } from '@/components/ui'

export default function AdminDashboardPage() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { profile } = useAuth()
  const isSuper = profile?.adminLevel === 'super'

  const [audit, setAudit] = useState<AuditLogPage | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [settings, setSettings] = useState<Record<string, string | number | boolean> | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const loadAudit = useCallback(async () => {
    try {
      setAuditError(null)
      setAudit(await auditApi.list({ page, limit: 20 }))
    } catch (err) {
      setAuditError(err instanceof ApiError ? err.message : tc('error'))
    }
  }, [page, tc])

  const loadSettings = useCallback(async () => {
    try {
      setSettingsError(null)
      const all = await settingsApi.all()
      setSettings(all)
      setDrafts(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, String(v)])))
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : tc('error'))
    }
  }, [tc])

  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  useEffect(() => {
    if (isSuper) void loadSettings()
  }, [isSuper, loadSettings])

  const saveSetting = async (key: string) => {
    setSavingKey(key)
    setSavedKey(null)
    setSettingsError(null)
    try {
      const raw = drafts[key] ?? ''
      // Numbers stay numbers; booleans stay booleans (zod union on the API).
      const value = raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(Number(raw)) ? raw : Number(raw)
      await settingsApi.update(key, value)
      setSavedKey(key)
      await loadSettings()
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : tc('error'))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-4 text-2xl font-bold">{t('auditTitle')}</h1>
        {auditError && <Alert>{auditError}</Alert>}
        {!audit && !auditError && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {audit && (
          <Card className="overflow-x-auto p-0">
            {audit.data.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">{t('auditEmpty')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 text-start dark:border-gray-700">
                  <tr className="text-start text-xs uppercase text-gray-500">
                    <th className="px-4 py-3 text-start">{t('at')}</th>
                    <th className="px-4 py-3 text-start">{t('action')}</th>
                    <th className="px-4 py-3 text-start">{t('actor')}</th>
                    <th className="px-4 py-3 text-start">{t('entity')}</th>
                    <th className="px-4 py-3 text-start">{t('ip')}</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.map((row) => (
                    <tr key={row.publicId} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone="info">{row.action}</Badge>
                      </td>
                      <td className="px-4 py-2">{row.actorName ?? row.actorPublicId ?? '—'}</td>
                      <td className="px-4 py-2 text-gray-500">
                        {row.entityType}
                        {row.entityId ? ` · ${row.entityId}` : ''}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{row.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ←
              </Button>
              <span className="text-gray-500">
                {page} / {Math.max(1, audit.meta.totalPages)}
              </span>
              <Button
                variant="secondary"
                disabled={page >= audit.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                →
              </Button>
            </div>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-xl font-bold">{t('settingsTitle')}</h2>
        {!isSuper && <p className="mb-4 text-sm text-gray-500">{t('superOnly')}</p>}
        {settingsError && <Alert>{settingsError}</Alert>}
        {savedKey && <Alert tone="success">{t('settingsSaved')}</Alert>}
        {isSuper && settings && (
          <Card className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 dark:border-gray-700">
                <tr className="text-xs uppercase text-gray-500">
                  <th className="px-4 py-3 text-start">{t('settingKey')}</th>
                  <th className="px-4 py-3 text-start">{t('settingValue')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {Object.keys(settings)
                  .sort()
                  .map((key) => (
                    <tr key={key} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-2 font-mono text-xs">{key}</td>
                      <td className="px-4 py-2">
                        <input
                          className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs dark:border-gray-600 dark:bg-gray-900"
                          value={drafts[key] ?? ''}
                          onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                          aria-label={key}
                        />
                      </td>
                      <td className="px-4 py-2 text-end">
                        <Button
                          variant="secondary"
                          loading={savingKey === key}
                          onClick={() => void saveSetting(key)}
                        >
                          {tc('save')}
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  )
}
