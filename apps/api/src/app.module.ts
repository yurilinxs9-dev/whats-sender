import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WebSocketModule } from './modules/websocket/websocket.module';
import { InstancesModule } from './modules/instances/instances.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { QueuesModule } from './modules/queues/queues.module';
import { UazApiModule } from './modules/uazapi/uazapi.module';
import { SpinModule } from './modules/spin/spin.module';
import { WarmupModule } from './modules/warmup/warmup.module';
import { HealthMonitorModule } from './modules/health-monitor/health-monitor.module';
import { HealthController } from './modules/health/health.controller';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { WebhookModule } from './modules/webhook/webhook.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6379');
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port || '6379', 10),
            password: url.password || undefined,
            tls: redisUrl.startsWith('rediss://') ? {} : undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    WebSocketModule,
    InstancesModule,
    ContactsModule,
    TemplatesModule,
    CampaignsModule,
    QueuesModule,
    UazApiModule,
    SpinModule,
    WarmupModule,
    HealthMonitorModule,
    DispatchModule,
    WebhookModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
