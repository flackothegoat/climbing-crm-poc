import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { HoldsModule } from './holds/holds.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { TeamModule } from './team/team.module';
import { RoutesModule } from './routes/routes.module';

@Module({
  imports: [InfrastructureModule, AuthModule, TeamModule, HoldsModule, RoutesModule, HealthModule],
})
export class AppModule {}
