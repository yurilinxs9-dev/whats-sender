import { Global, Module } from '@nestjs/common';
import { UazApiService } from './uazapi.service';

@Global()
@Module({
  providers: [UazApiService],
  exports: [UazApiService],
})
export class UazApiModule {}
