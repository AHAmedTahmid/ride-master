import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { AuthProvider } from '@/lib/auth'
import { ThemeProvider } from '@/components/theme-provider'
import { ServiceWorkerRegister } from '@/components/sw-register'
import { routing } from '@/i18n/routing'
import '../globals.css'

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'common' })
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: t('tagline'),
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icon.svg' },
  }
}

export const viewport: Viewport = {
  themeColor: '#1b6ef5',
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  if (!routing.locales.includes(locale as 'en' | 'dv')) notFound()
  setRequestLocale(locale)
  const messages = await getMessages()

  return (
    <html lang={locale} dir={locale === 'dv' ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <body className="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <AuthProvider>
              <ServiceWorkerRegister />
              {children}
            </AuthProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
