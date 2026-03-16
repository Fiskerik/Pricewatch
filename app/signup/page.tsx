'use client'
import { useState } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import Link from 'next/link'

export default function SignupPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
  const supabase = isSupabaseConfigured ? createClientComponentClient() : null
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) {
      console.error('Signup blocked: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
      setAuthError('Signup is temporarily unavailable. Please contact support.')
      return
    }

    setLoading(true)
    setAuthError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      console.error('Magic link signup failed:', error.message)
      setAuthError(error.message)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  const handleGoogleLogin = async () => {
    if (!supabase) {
      console.error('Google signup blocked: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
      setAuthError('Google signup is temporarily unavailable. Please contact support.')
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
      console.error('Google signup failed:', error.message)
      setAuthError(error.message)
      setGoogleLoading(false)
      return
    }
    setGoogleLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-8">
            <div className="w-7 h-7 bg-black rounded-md flex items-center justify-center text-white font-bold">⚡</div>
            <span className="font-bold">PriceWatch</span>
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight">Start for free</h1>
          <p className="text-gray-500 text-sm mt-1">No credit card required. Up and running in 2 minutes.</p>
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
              <p className="text-gray-500 text-sm">We sent a magic link to <strong>{email}</strong>. Click it to create your account.</p>
            </div>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
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
              <button
                type="submit"
                disabled={loading || !isSupabaseConfigured}
                className="w-full bg-black text-white font-bold py-2.5 rounded-lg text-sm hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending link...' : 'Create free account'}
              </button>
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={googleLoading || !isSupabaseConfigured}
                className="w-full border border-gray-200 text-gray-900 font-semibold py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {googleLoading ? 'Redirecting...' : 'Continue with Google'}
              </button>
              <p className="text-xs text-gray-400 text-center">
                By signing up, you agree to our terms and privacy policy.
              </p>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-black font-semibold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
