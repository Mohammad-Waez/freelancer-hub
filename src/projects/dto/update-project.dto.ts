import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateProjectDto } from './create-project.dto.js';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  // in multipart requests booleans arrive as the text "true"
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean()
  removeAttachment?: boolean;
}