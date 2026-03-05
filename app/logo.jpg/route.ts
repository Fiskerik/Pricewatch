import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export async function GET() {
  try {
    const logoPath = path.join(process.cwd(), 'public', 'logo.png')
    const logo = await readFile(logoPath)

    return new NextResponse(logo, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.log('[logo.png route] failed to read logo.png', String(error))
    return new NextResponse('Logo not found', { status: 404 })
  }
}
