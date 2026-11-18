import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [DeliveriesModule],
  providers: [TasksService],
})
export class TasksModule {}