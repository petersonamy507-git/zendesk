import { useEffect, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, FormField, Input, Notice } from '@/components/ui'
import { Logo } from '@/components/layout/Logo'
import { api, apiError } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { emailRule, loginSchema, registerSchema, resetSchema, type LoginForm, type RegisterForm, type ResetForm } from '../schemas'
import { z } from 'zod'

function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-[400px] rounded-lg bg-surface p-8 shadow-modal">
        <div className="mb-6 flex flex-col items-center gap-2 text-fg">
          <Logo size={36} withText />
          <h1 className="text-md text-fg-secondary">{title}</h1>
        </div>
        {children}
        {footer && <div className="mt-6 text-center text-sm text-fg-secondary">{footer}</div>}
      </div>
    </div>
  )
}

export function LoginPage() {
  const login = useAuth((s) => s.login)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [needOtp, setNeedOtp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) })
  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    try {
      await login(v.email, v.password, v.otp)
      navigate(params.get('next') || '/home', { replace: true })
    } catch (e) {
      const err = apiError(e)
      if (err.code === 'mfa_required') setNeedOtp(true)
      else setError(err.message)
    }
  })
  return (
    <AuthLayout title="Sign in to your workspace" footer={<>New here? <Link className="text-primary" to="/register">Create a workspace</Link></>}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1">
        {error && <Notice tone="danger">{error}</Notice>}
        <FormField label="Email" layout="stacked" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </FormField>
        <FormField label="Password" layout="stacked" error={formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </FormField>
        {needOtp && (
          <FormField label="Verification code" layout="stacked" hint="Enter the 6-digit code from your authenticator app">
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus {...register('otp')} />
          </FormField>
        )}
        <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting} className="mt-3">
          Sign in
        </Button>
        <Link to="/forgot-password" className="mt-3 text-center text-sm text-primary">
          Forgot password?
        </Link>
      </form>
    </AuthLayout>
  )
}

export function RegisterPage() {
  const reg = useAuth((s) => s.register)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState, setValue } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) })
  const [subTouched, setSubTouched] = useState(false)
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    try {
      await reg(v)
      navigate('/home', { replace: true })
    } catch (e) {
      setError(apiError(e).message)
    }
  })
  return (
    <AuthLayout title="Create your support workspace" footer={<>Already have an account? <Link className="text-primary" to="/login">Sign in</Link></>}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1">
        {error && <Notice tone="danger">{error}</Notice>}
        <FormField label="Company" layout="stacked" error={formState.errors.company?.message}>
          <Input {...register('company', { onChange: (e) => !subTouched && setValue('subdomain', slug(e.target.value), { shouldValidate: formState.isSubmitted }) })} />
        </FormField>
        <FormField label="Workspace address" layout="stacked" error={formState.errors.subdomain?.message} hint="Used by your chat widget and help center">
          <Input {...register('subdomain', { onChange: () => setSubTouched(true) })} />
        </FormField>
        <FormField label="Your name" layout="stacked" error={formState.errors.name?.message}>
          <Input autoComplete="name" {...register('name')} />
        </FormField>
        <FormField label="Work email" layout="stacked" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </FormField>
        <FormField label="Password" layout="stacked" error={formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </FormField>
        <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting} className="mt-3">
          Create workspace
        </Button>
      </form>
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const { register, handleSubmit, formState } = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: emailRule })) })
  const onSubmit = handleSubmit(async (v) => {
    await api.post('/auth/forgot-password', v).catch(() => undefined)
    setSent(true)
  })
  return (
    <AuthLayout title="Reset your password" footer={<Link className="text-primary" to="/login">Back to sign in</Link>}>
      {sent ? (
        <Notice tone="info">If an account exists for that email, we've sent a link to reset your password. It expires in 1 hour.</Notice>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1">
          <FormField label="Email" layout="stacked" error={formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...register('email')} />
          </FormField>
          <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting} className="mt-3">
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

function TokenPasswordPage({ title, endpoint, withName, done }: { title: string; endpoint: string; withName?: boolean; done: string }) {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const { register, handleSubmit, formState } = useForm<ResetForm>({ resolver: zodResolver(resetSchema) })
  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    try {
      await api.post(endpoint, { token, password: v.password, name: withName ? name || undefined : undefined })
      navigate(`/login?msg=${encodeURIComponent(done)}`, { replace: true })
    } catch (e) {
      setError(apiError(e).message)
    }
  })
  if (!token) return <AuthLayout title={title}><Notice tone="danger">This link is missing its token.</Notice></AuthLayout>
  return (
    <AuthLayout title={title}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1">
        {error && <Notice tone="danger">{error}</Notice>}
        {withName && (
          <FormField label="Your name" layout="stacked">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
        )}
        <FormField label="New password" layout="stacked" error={formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </FormField>
        <FormField label="Confirm password" layout="stacked" error={formState.errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...register('confirm')} />
        </FormField>
        <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting} className="mt-3">
          Continue
        </Button>
      </form>
    </AuthLayout>
  )
}

export const ResetPasswordPage = () => <TokenPasswordPage title="Choose a new password" endpoint="/auth/reset-password" done="Password updated — sign in" />
export const AcceptInvitePage = () => <TokenPasswordPage title="Join your team" endpoint="/auth/accept-invite" withName done="Account ready — sign in" />

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending')
  useEffect(() => {
    api.post('/auth/verify-email', { token: params.get('token') ?? '' }).then(() => setState('ok'), () => setState('error'))
  }, [params])
  return (
    <AuthLayout title="Email verification" footer={<Link className="text-primary" to="/home">Continue</Link>}>
      {state === 'pending' && <p className="text-center">Verifying…</p>}
      {state === 'ok' && <Notice tone="info">Your email is verified.</Notice>}
      {state === 'error' && <Notice tone="danger">This verification link is invalid or has expired.</Notice>}
    </AuthLayout>
  )
}
