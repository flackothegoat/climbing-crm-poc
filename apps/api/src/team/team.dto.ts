import { BadRequestException } from '@nestjs/common';
import { MembershipStatus } from '@prisma/client';
import { z } from 'zod';
import { AUTH_POLICY } from '../auth/auth.constants';

const email = z.string().trim().toLowerCase().email('请输入有效邮箱').max(254);
const displayName = z.string().trim().min(2, '姓名至少需要 2 个字符').max(50);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const createInvitationSchema = z.object({ email });
const acceptInvitationSchema = z.object({
  displayName,
  password: z
    .string()
    .min(AUTH_POLICY.passwordMinLength, '密码至少需要 12 位')
    .max(AUTH_POLICY.passwordMaxLength),
});
const updateMemberSchema = z
  .object({
    displayName: displayName.optional(),
    jobTitle: optionalText(50),
    responsibility: optionalText(200),
    status: z.nativeEnum(MembershipStatus).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要提供一个修改字段');
const tokenSchema = z.string().min(20).max(200);

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const parseCreateInvitation = (input: unknown) => parse(createInvitationSchema, input);
export const parseAcceptInvitation = (input: unknown) => parse(acceptInvitationSchema, input);
export const parseUpdateMember = (input: unknown) => parse(updateMemberSchema, input);
export const parseInvitationToken = (input: unknown) => parse(tokenSchema, input);

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new BadRequestException(result.error.issues[0]?.message ?? '请求参数不符合要求');
}
