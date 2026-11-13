import { Link } from 'react-router-dom'
import { Logo } from '@/components/layout/Logo'

export function NotFoundPage({ message = "We couldn't find that page." }: { message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-lg text-fg">{message}</p>
      <Link to="/home" className="text-primary">Go to Home</Link>
    </div>
  )
}

export function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10 text-md leading-relaxed">
      <Logo withText />
      <h1 className="mt-6 text-xl font-bold">Privacy policy</h1>
      <p className="mt-3 text-fg-secondary">This workspace stores the information you and your visitors provide (names, emails, chat transcripts, page views, IP addresses and browser details) to deliver customer support. Data is kept until an administrator deletes it or a retention rule removes it.</p>
      <p className="mt-3 text-fg-secondary">Visitors can request an export or erasure of their data from the workspace owner. Administrators can export or anonymize a visitor from the admin privacy tools.</p>
      <p className="mt-3 text-fg-secondary">Sessions use a secure, http-only cookie for sign-in. No advertising trackers are used.</p>
    </div>
  )
}
