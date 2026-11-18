import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class AcceptOfferDto {
  // the price the client saw when he decided
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  expectedPrice!: number;
}