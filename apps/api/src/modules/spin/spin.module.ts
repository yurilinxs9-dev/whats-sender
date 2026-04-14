import { Global, Module } from '@nestjs/common';
import { SpinService } from './spin.service';

@Global()
@Module({
  providers: [SpinService],
  exports: [SpinService],
})
export class SpinModule {}
