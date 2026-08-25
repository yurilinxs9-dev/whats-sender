import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { Module } from '@nestjs/common';
import { InstancesController } from './instances.controller';
import { InstancesService } from './instances.service';

@Module({
  imports: [WhatsAppModule],
  controllers: [InstancesController],
  providers: [InstancesService],
  exports: [InstancesService],
})
export class InstancesModule {}
