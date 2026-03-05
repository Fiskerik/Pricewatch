import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export async function GET() {
  try {
    const logoPath = path.join(process.cwd(), 'public', 'logo.jpg')
    const logo = await readFile(logoPath)

    return new NextResponse(logo, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.log('[logo.jpg route] failed to read logo.jpg', String(error))
    return new NextResponse('Logo not found', { status: 404 })
  }
}
