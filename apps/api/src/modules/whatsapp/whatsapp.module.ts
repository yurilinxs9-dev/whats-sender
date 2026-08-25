import { Module } from '@nestjs/common';
import { UazApiModule } from '../uazapi/uazapi.module';
import { EvolutionService } from './evolution.service';
import { ProviderResolver } from './provider-resolver.service';

@Module({
  imports: [UazApiModule],
  providers: [EvolutionService, ProviderResolver],
  exports: [EvolutionService, ProviderResolver],
})
export class WhatsAppModule {}
