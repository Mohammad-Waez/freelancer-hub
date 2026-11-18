import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RejectDeliveryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;

  // extra time the freelancer gets for the revision
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  extraDays!: number;
}