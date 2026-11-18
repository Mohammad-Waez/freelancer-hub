import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { WalletModule } from './wallet/wallet.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { StorageModule } from './storage/storage.module.js';
import { OffersModule } from './offers/offers.module.js';
import { DeliveriesModule } from './deliveries/deliveries.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module.js';
import { FreelancersModule } from './freelancers/freelancers.module.js';
import { validateEnv } from './config/env.validation.js';

@Module({
  imports: [
     ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    PrismaModule,
    PlatformModule,
    AuthModule,
    WalletModule,
    CategoriesModule,
    ProjectsModule,
    PrismaModule,
    StorageModule,
    PlatformModule,
    OffersModule,
    DeliveriesModule,
    TasksModule,
    AdminModule,
    FreelancersModule,
  ],
  providers: [
    // order matters: JwtAuthGuard sets request.user, RolesGuard reads it
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
