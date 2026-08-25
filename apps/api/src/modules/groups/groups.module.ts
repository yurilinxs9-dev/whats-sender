import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { QUEUE_GROUP_ADD } from '../queues/queue-constants';

@Module({
  imports: [
    WhatsAppModule,
    BullModule.registerQueue({ name: QUEUE_GROUP_ADD }),
  ],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
