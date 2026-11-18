var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, StreamableFile, } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map } from 'rxjs';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator.js';
import { Paginated } from '../responses/paginated.js';
let ResponseInterceptor = class ResponseInterceptor {
    reflector;
    constructor(reflector) {
        this.reflector = reflector;
    }
    intercept(context, next) {
        const message = this.reflector.getAllAndOverride(RESPONSE_MESSAGE_KEY, [
            context.getHandler(),
            context.getClass(),
        ]) ?? 'Success';
        return next.handle().pipe(map((result) => {
            if (result instanceof StreamableFile)
                return result;
            if (result instanceof Paginated) {
                return {
                    success: true,
                    message,
                    data: result.items,
                    meta: result.meta,
                };
            }
            return { success: true, message, data: result ?? null };
        }));
    }
};
ResponseInterceptor = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Reflector])
], ResponseInterceptor);
export { ResponseInterceptor };
//# sourceMappingURL=response.interceptor.js.map