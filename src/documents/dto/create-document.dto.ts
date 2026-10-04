import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDocumentDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Defaults to "Untitled" when empty',
    example: 'CRDT talk',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Hello, world' })
  @IsOptional()
  @IsString()
  content?: string;
}
