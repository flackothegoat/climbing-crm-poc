import { ForbiddenException, Injectable } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import type { CurrentSession } from '../auth/session.service';

export enum Capability {
  TEAM_READ = 'TEAM_READ',
  TEAM_MANAGE = 'TEAM_MANAGE',
  HOLD_READ = 'HOLD_READ',
  HOLD_WRITE = 'HOLD_WRITE',
  HOLD_RECEIVE = 'HOLD_RECEIVE',
  HOLD_ADJUST = 'HOLD_ADJUST',
  HOLD_ARCHIVE = 'HOLD_ARCHIVE',
  ASSET_READ = 'ASSET_READ',
  ASSET_DRAFT_WRITE = 'ASSET_DRAFT_WRITE',
  ASSET_PUBLISH = 'ASSET_PUBLISH',
}

const l2Capabilities = new Set([
  Capability.TEAM_READ,
  Capability.HOLD_READ,
  Capability.HOLD_WRITE,
  Capability.HOLD_RECEIVE,
  Capability.ASSET_READ,
  Capability.ASSET_DRAFT_WRITE,
]);

const roleCapabilities: Record<MembershipRole, ReadonlySet<Capability>> = {
  [MembershipRole.L1_ADMIN]: new Set(Object.values(Capability)),
  [MembershipRole.L2_ADMIN]: l2Capabilities,
};

@Injectable()
export class AccessControlService {
  assert(session: CurrentSession, capability: Capability): void {
    if (!roleCapabilities[session.role].has(capability)) {
      throw new ForbiddenException('当前账号没有执行此操作的权限');
    }
  }
}
