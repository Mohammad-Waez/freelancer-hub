import { Module } from '@nestjs/common';
import { FreelancersController } from './freelancers.controller.js';
import { FreelancersService } from './freelancers.service.js';

@Module({
  controllers: [FreelancersController],
  providers: [FreelancersService],
  exports: [FreelancersService],
})
export class FreelancersModule {}