import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { MAX_DOCUMENT_BYTES, UploadDocumentSchema } from '@ride-master/shared'
import { AuthContext, CurrentUser, Roles } from '../../common/decorators/auth.decorators'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { CompanyDocumentsService, UploadedFile as MultipartFile } from './company-documents.service'

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies/me/documents')
export class CompanyDocumentsController {
  constructor(private readonly documents: CompanyDocumentsService) {}

  /** Multipart upload: field 'file' plus type/expiryDate fields. */
  @Post()
  @Roles('company_owner')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  upload(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(UploadDocumentSchema))
    body: Parameters<CompanyDocumentsService['upload']>[1],
    @UploadedFile() file?: MultipartFile,
  ) {
    return this.documents.upload(auth, body, file)
  }

  /** Expiring signed URL to view the stored document. */
  @Get(':publicId/url')
  @Roles('company_owner')
  signedUrl(@CurrentUser() auth: AuthContext, @Param('publicId') publicId: string) {
    return this.documents.signedUrl(auth, publicId)
  }

  @Delete(':publicId')
  @Roles('company_owner')
  remove(@CurrentUser() auth: AuthContext, @Param('publicId') publicId: string) {
    return this.documents.remove(auth, publicId)
  }
}
