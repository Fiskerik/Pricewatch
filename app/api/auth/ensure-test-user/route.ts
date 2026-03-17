import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from '@/lib/auth'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (email !== TEST_USER_EMAIL || password !== TEST_USER_PASSWORD) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 })
    }

    const admin = supabaseAdmin()
    const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers()
    if (listError) {
      console.error('Failed to list users while ensuring test user:', listError.message)
      return NextResponse.json({ error: 'Could not verify test user.' }, { status: 500 })
    }

    const existingUser = listedUsers.users.find((candidate: { email?: string | null }) =>
      (candidate.email ?? '').trim().toLowerCase() === TEST_USER_EMAIL
    )

    let userId = existingUser?.id
    if (!userId) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        email_confirm: true,
      })

      if (createError || !created?.user?.id) {
        console.error('Failed creating test user:', createError?.message ?? 'unknown error')
        return NextResponse.json({ error: 'Could not create test user.' }, { status: 500 })
      }

      userId = created.user.id
    }

    const { error: storeError } = await admin
      .from('stores')
      .upsert({ user_id: userId, plan: 'pro' }, { onConflict: 'user_id' })

    if (storeError) {
      console.error('Failed upserting test user store:', storeError.message)
      return NextResponse.json({ error: 'Could not set test user plan.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Unexpected error ensuring test user:', error)
    return NextResponse.json({ error: 'Unexpected server error.' }, { status: 500 })
  }
}
