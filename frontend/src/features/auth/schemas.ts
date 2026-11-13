import { z } from 'zod'

// Shared validation rules — mirror backend (app/services/auth.py PASSWORD_RULE).
export const passwordRule = z
  .string()
  .min(10, 'At least 10 characters')
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/\d/, 'Include a number')

export const emailRule = z.string().trim().email('Enter a valid email')

export const loginSchema = z.object({ email: emailRule, password: z.string().min(1, 'Enter your password'), otp: z.string().optional() })
export type LoginForm = z.infer<typeof loginSchema>

export const registerSchema = z.object({
  company: z.string().trim().min(2, 'Company name is required'),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/, '3–63 lowercase letters, numbers or dashes'),
  name: z.string().trim().min(1, 'Your name is required'),
  email: emailRule,
  password: passwordRule,
})
export type RegisterForm = z.infer<typeof registerSchema>

export const resetSchema = z
  .object({ password: passwordRule, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
export type ResetForm = z.infer<typeof resetSchema>
