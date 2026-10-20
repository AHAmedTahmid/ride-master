import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'dv'],
  defaultLocale: 'en',
  localePrefix: 'always',
})
