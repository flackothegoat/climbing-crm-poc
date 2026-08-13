import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitationPublicController, TeamController } from './team.controller';
import { TeamInvitationService } from './team-invitation.service';
import { TeamMemberService } from './team-member.service';

@Module({
  imports: [AuthModule],
  controllers: [TeamController, InvitationPublicController],
  providers: [TeamInvitationService, TeamMemberService],
})
export class TeamModule {}
