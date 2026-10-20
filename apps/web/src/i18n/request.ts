import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'

export default getRequestConfig(async ({ locale }) => {
  // Routing guarantees the locale is one of ours; keep TS honest anyway.
  const safeLocale = routing.locales.includes(locale as 'en' | 'dv')
    ? (locale as 'en' | 'dv')
    : routing.defaultLocale

  return {
    locale: safeLocale,
    messages: (await import(`./messages/${safeLocale}.json`)).default,
  }
})
