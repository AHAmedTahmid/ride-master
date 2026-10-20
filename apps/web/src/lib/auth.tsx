'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ApiError,
  authApi,
  meApi,
  refreshSession,
  setAccessToken,
  type UserProfile,
} from './api'

type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  status: AuthStatus
  profile: UserProfile | null
  loginWithResult: (result: { accessToken: string }, profile?: UserProfile) => Promise<void>
  logout: () => Promise<void>
  switchRole: (role: string, companyId?: string) => Promise<void>
  reloadProfile: () => Promise<void>
  error: string | null
  clearError: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshing = useRef(false)

  const loadProfile = useCallback(async () => {
    const me = await meApi.me()
    setProfile(me)
    return me
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await refreshSession()
        if (cancelled) return
        setAccessToken(result.accessToken)
        await loadProfile()
        if (!cancelled) setStatus('authenticated')
      } catch (err) {
        if (cancelled) return
        // A failed refresh simply means "not signed in" — not an error state.
        if (err instanceof ApiError && (err.status === 401 || err.status === 0)) {
          setStatus('anonymous')
        } else {
          setError(err instanceof Error ? err.message : 'error')
          setStatus('anonymous')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadProfile])

  const loginWithResult = useCallback(
    async (result: { accessToken: string }) => {
      setAccessToken(result.accessToken)
      await loadProfile()
      setStatus('authenticated')
    },
    [loadProfile],
  )

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Network failures still clear local state.
    }
    setProfile(null)
    setStatus('anonymous')
  }, [])

  const switchRole = useCallback(
    async (role: string, companyId?: string) => {
      refreshing.current = true
      try {
        const result = await meApi.switchRole(role, companyId)
        setAccessToken(result.accessToken)
        await loadProfile()
      } finally {
        refreshing.current = false
      }
    },
    [loadProfile],
  )

  const reloadProfile = useCallback(async () => {
    if (status !== 'authenticated') return
    await loadProfile()
  }, [loadProfile, status])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      profile,
      loginWithResult,
      logout,
      switchRole,
      reloadProfile,
      error,
      clearError: () => setError(null),
    }),
    [status, profile, loginWithResult, logout, switchRole, reloadProfile, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** Route for each active role (single source of truth for redirects). */
export function homePathForRole(role: UserProfile['activeRole']): string {
  switch (role) {
    case 'superadmin':
      return '/admin'
    case 'company_owner':
      return '/company'
    case 'driver':
      return '/driver'
    case 'rider':
      return '/rider'
  }
}
