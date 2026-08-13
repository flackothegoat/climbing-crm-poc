import { z } from 'zod';
import { parseWithSchema } from '../common/zod-validation';
import { AUTH_POLICY } from './auth.constants';

const email = z.string().trim().toLowerCase().email('请输入有效邮箱').max(254);
const password = z
  .string()
  .min(AUTH_POLICY.passwordMinLength, '密码至少需要 12 位')
  .max(AUTH_POLICY.passwordMaxLength);

const registerSchema = z.object({
  email,
  password,
  organizationName: z
    .string()
    .trim()
    .min(AUTH_POLICY.organizationNameMinLength)
    .max(AUTH_POLICY.organizationNameMaxLength),
});
const loginSchema = z.object({
  email,
  password: z.string().min(1).max(AUTH_POLICY.passwordMaxLength),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export function parseRegisterInput(input: unknown): RegisterInput {
  return parse(registerSchema, input);
}

export function parseLoginInput(input: unknown): LoginInput {
  return parse(loginSchema, input);
}

const parse = parseWithSchema;
