export const AUTH_POLICY = {
  passwordMinLength: 12,
  passwordMaxLength: 128,
  organizationNameMinLength: 2,
  organizationNameMaxLength: 80,
  loginRateLimit: { attempts: 10, windowMinutes: 15 },
  loginIpRateLimit: { attempts: 100, windowMinutes: 15 },
  registerRateLimit: { attempts: 5, windowMinutes: 60 },
  invitationRateLimit: { attempts: 8, windowMinutes: 15 },
  invitationIpRateLimit: { attempts: 50, windowMinutes: 15 },
  bcryptRounds: 12,
} as const;
