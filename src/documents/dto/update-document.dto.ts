import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDocumentDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Replaces the whole title when present',
    example: 'Renamed title',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description: 'Replaces the whole content when present',
    example: 'New content',
  })
  @IsOptional()
  @IsString()
  content?: string;
}
