import { Global, Module } from '@nestjs/common';
import { PlatformService } from './platform.service.js';

@Global()
@Module({
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}