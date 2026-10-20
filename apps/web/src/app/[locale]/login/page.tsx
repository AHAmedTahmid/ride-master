'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { ApiError, authApi } from '@/lib/api'
import { homePathForRole, useAuth } from '@/lib/auth'
import { Alert, Button, Card, Input } from '@/components/ui'

type Mode = 'phone' | 'admin'
type PhoneStep = 'phone' | 'code'

export default function LoginPage() {
  const t = useTranslations('login')
  const tc = useTranslations('common')
  const { status, profile, loginWithResult } = useAuth()
  const { replace } = useRouter()

  const [mode, setMode] = useState<Mode>('phone')
  const [purpose, setPurpose] = useState<'login' | 'register'>('login')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [preAuthToken, setPreAuthToken] = useState<string | null>(null)
  const [step, setStep] = useState<PhoneStep>('phone')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  // Already signed in → home for the active role.
  useEffect(() => {
    if (status === 'authenticated' && profile) {
      replace({ pathname: homePathForRole(profile.activeRole) })
    }
  }, [status, profile, replace])

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await fn()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.message === 'No account for this number. Register first.'
            ? t('noAccount')
            : err.message,
        )
      } else {
        setError(tc('error'))
      }
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () =>
    withBusy(async () => {
      await authApi.requestOtp(phone, purpose)
      setStep('code')
      setInfo(t('codeSent', { phone }))
      setCooldown(30)
    })

  const verifyCode = () =>
    withBusy(async () => {
      const result = await authApi.verifyOtp(phone, code, purpose)
      await loginWithResult(result)
    })

  const adminContinue = () =>
    withBusy(async () => {
      const result = await authApi.adminLogin(email, password)
      setPreAuthToken(result.preAuthToken)
    })

  const adminTotp = () =>
    withBusy(async () => {
      if (!preAuthToken) return
      const result = await authApi.adminVerifyTotp(email, totp, preAuthToken)
      await loginWithResult(result)
    })

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-1 text-2xl font-bold">{t('title')}</h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">{tc('tagline')}</p>

        <div className="mb-6 flex rounded-lg border border-gray-200 p-1 dark:border-gray-700">
          {(['phone', 'admin'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setError(null)
                setInfo(null)
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
                mode === m
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {m === 'phone' ? t('phoneTab') : t('adminTab')}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}
        {info && (
          <div className="mb-4">
            <Alert tone="info">{info}</Alert>
          </div>
        )}

        {mode === 'phone' && step === 'phone' && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void sendCode()
            }}
          >
            <Input
              label={t('phoneLabel')}
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder={t('phonePlaceholder')}
              help={t('phoneHelp')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="purpose"
                  checked={purpose === 'login'}
                  onChange={() => setPurpose('login')}
                />
                {t('purposeLogin')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="purpose"
                  checked={purpose === 'register'}
                  onChange={() => setPurpose('register')}
                />
                {t('purposeRegister')}
              </label>
            </div>
            <Button type="submit" loading={busy} className="w-full">
              {t('sendCode')}
            </Button>
          </form>
        )}

        {mode === 'phone' && step === 'code' && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void verifyCode()
            }}
          >
            <Input
              label={t('codeLabel')}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
            <Button type="submit" loading={busy} className="w-full" disabled={code.length !== 6}>
              {t('verify')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={cooldown > 0}
              onClick={() => void sendCode()}
            >
              {cooldown > 0 ? t('resendIn', { seconds: cooldown }) : t('resend')}
            </Button>
          </form>
        )}

        {mode === 'admin' && !preAuthToken && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void adminContinue()
            }}
          >
            <Input
              label={t('emailLabel')}
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label={t('passwordLabel')}
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" loading={busy} className="w-full">
              {t('adminSignIn')}
            </Button>
          </form>
        )}

        {mode === 'admin' && preAuthToken && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void adminTotp()
            }}
          >
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('totpStep')}</p>
            <Input
              label={t('totpLabel')}
              name="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
            <Button type="submit" loading={busy} className="w-full" disabled={totp.length !== 6}>
              {t('verify')}
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
