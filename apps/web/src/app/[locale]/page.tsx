'use client'

import { useEffect } from 'react'
import { useRouter } from '@/i18n/navigation'
import { homePathForRole, useAuth } from '@/lib/auth'
import { Spinner } from '@/components/ui'

export default function IndexPage() {
  const { status, profile } = useAuth()
  const { replace } = useRouter()

  useEffect(() => {
    if (status === 'anonymous') {
      replace({ pathname: '/login' })
    } else if (status === 'authenticated' && profile) {
      replace({ pathname: homePathForRole(profile.activeRole) })
    }
  }, [status, profile, replace])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="h-8 w-8 text-brand-600" />
    </div>
  )
}
