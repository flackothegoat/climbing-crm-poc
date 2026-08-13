import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { HoldsModule } from './holds/holds.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { TeamModule } from './team/team.module';
import { WallsModule } from './walls/walls.module';

@Module({
  imports: [InfrastructureModule, AuthModule, TeamModule, HoldsModule, WallsModule, HealthModule],
})
export class AppModule {}
