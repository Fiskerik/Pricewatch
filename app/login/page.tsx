'use client'
import { useState } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'
import Image from 'next/image'
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from '@/lib/auth'

export default function LoginPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
  const supabase = isSupabaseConfigured ? createClientComponentClient() : null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) {
      console.error('Login blocked: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
      setAuthError('Login is temporarily unavailable. Please contact support.')
      return
    }

    setLoading(true)
    setAuthError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      console.error('Magic link login failed:', error.message)
      setAuthError(error.message)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  const handleGoogleLogin = async () => {
    if (!supabase) {
      console.error('Google login blocked: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
      setAuthError('Google login is temporarily unavailable. Please contact support.')
      return
    }

    setGoogleLoading(true)
    setAuthError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      console.error('Google login failed:', error.message)
      setAuthError(error.message)
      setGoogleLoading(false)
      return
    }
    setGoogleLoading(false)
  }

  const handlePasswordLogin = async () => {
    if (!supabase) {
      console.error('Password login blocked: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
      setAuthError('Login is temporarily unavailable. Please contact support.')
      return
    }

    setPasswordLoading(true)
    setAuthError(null)

    const normalizedEmail = email.trim().toLowerCase()
    if (normalizedEmail !== TEST_USER_EMAIL) {
      console.warn('Blocked password login for non-test user', { email: normalizedEmail })
      setAuthError('Password login is only available for the test account right now. Use magic link or Google.')
      setPasswordLoading(false)
      return
    }

    if (password !== TEST_USER_PASSWORD) {
      console.warn('Rejected test user login with invalid password', { email: normalizedEmail })
      setAuthError('Invalid password for the test account.')
      setPasswordLoading(false)
      return
    }

    console.log('Ensuring test user exists before password login', { email: normalizedEmail })
    const ensureRes = await fetch('/api/auth/ensure-test-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, password }),
    })

    if (!ensureRes.ok) {
      const ensurePayload = await ensureRes.json().catch(() => null)
      const ensureMessage = ensurePayload?.error ?? 'Could not prepare test user account.'
      console.error('Ensuring test user failed:', ensureMessage)
      setAuthError(ensureMessage)
      setPasswordLoading(false)
      return
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })

    if (error) {
      console.error('Password login failed:', error.message)
      setAuthError(error.message)
      setPasswordLoading(false)
      return
    }

    if (data?.user) {
      const plan = normalizedEmail === TEST_USER_EMAIL ? 'pro' : 'free'
      await supabase.from('stores').upsert({ user_id: data.user.id, plan }, { onConflict: 'user_id' })
    }

    window.location.href = '/dashboard'
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-8">
            <Image src="/logo.png" alt="Pricingspy logo" width={28} height={28} className="rounded-md" />
            <span className="font-bold">Pricingspy</span>
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight">Welcome back</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in with magic link, password, or Google</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
          {authError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {authError}
            </div>
          )}
          {sent ? (
            <div className="text-center">
              <div className="text-4xl mb-4">📬</div>
              <h2 className="font-bold text-lg mb-2">Check your email</h2>
              <p className="text-gray-500 text-sm">We sent a magic link to <strong>{email}</strong>. Click it to sign in.</p>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-sm font-semibold block mb-1.5">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
                />
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-black transition-colors"
                />
              </div>
              <button
                type="button"
                onClick={handlePasswordLogin}
                disabled={passwordLoading || !isSupabaseConfigured || !email || !password}
                className="w-full bg-gray-900 text-white font-bold py-2.5 rounded-lg text-sm hover:bg-black transition-colors disabled:opacity-50"
              >
                {passwordLoading ? 'Signing in...' : 'Sign in with password'}
              </button>
              <button
                type="submit"
                disabled={loading || !isSupabaseConfigured}
                className="w-full bg-black text-white font-bold py-2.5 rounded-lg text-sm hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send magic link'}
              </button>
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={googleLoading || !isSupabaseConfigured}
                className="w-full border border-gray-200 text-gray-900 font-semibold py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {googleLoading ? 'Redirecting...' : 'Sign in with Google'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          No account?{' '}
          <Link href="/signup" className="text-black font-semibold hover:underline">Sign up free</Link>
        </p>
      </div>
    </div>
  )
}
