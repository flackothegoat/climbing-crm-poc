import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, SessionGuard],
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
