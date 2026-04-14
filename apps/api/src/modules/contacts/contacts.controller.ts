import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { createContactSchema } from './dto/create-contact.dto';
import { updateContactSchema } from './dto/update-contact.dto';
import { importContactsSchema } from './dto/import-contacts.dto';
import { createListSchema } from './dto/create-list.dto';
import { updateListSchema } from './dto/update-list.dto';
import { listContactsBodySchema } from './dto/list-contacts-body.dto';
import type { AuthUser } from '../../common/types/auth-user';

@Controller('contacts')
export class ContactsController {
  constructor(private contactsService: ContactsService) {}

  // ─── Stats (before :id) ─────────────────────────────

  @Get('stats')
  async stats(@Req() req: Request & { user: AuthUser }) {
    return this.contactsService.getContactStats(req.user.tenantId);
  }

  // ─── Contact Lists (before :id) ─────────────────────

  @Get('lists')
  async listLists(@Req() req: Request & { user: AuthUser }) {
    return this.contactsService.listContactLists(req.user.tenantId);
  }

  @Post('lists')
  @HttpCode(201)
  async createList(
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = createListSchema.parse(body);
    return this.contactsService.createContactList(data, req.user.tenantId);
  }

  @Patch('lists/:id')
  async updateList(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = updateListSchema.parse(body);
    return this.contactsService.updateContactList(id, data, req.user.tenantId);
  }

  @Delete('lists/:id')
  async removeList(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.contactsService.removeContactList(id, req.user.tenantId);
  }

  @Get('lists/:id/contacts')
  async getListContacts(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contactsService.getListContacts(
      id,
      req.user.tenantId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post('lists/:id/contacts')
  @HttpCode(200)
  async addContactsToList(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = listContactsBodySchema.parse(body);
    return this.contactsService.addContactsToList(id, data.contactIds, req.user.tenantId);
  }

  @Delete('lists/:id/contacts')
  async removeContactsFromList(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = listContactsBodySchema.parse(body);
    return this.contactsService.removeContactsFromList(id, data.contactIds, req.user.tenantId);
  }

  // ─── Import (before :id) ────────────────────────────

  @Post('import')
  @HttpCode(201)
  async importContacts(
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = importContactsSchema.parse(body);
    return this.contactsService.importContacts(data, req.user.tenantId);
  }

  @Post('import-txt')
  @HttpCode(201)
  async importFromText(
    @Body() body: { text: string; list_name: string },
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.contactsService.importFromText(
      body.text,
      body.list_name,
      req.user.tenantId,
    );
  }

  // ─── Contacts CRUD ─────────────────────────────────

  @Get()
  async list(
    @Req() req: Request & { user: AuthUser },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('engagement') engagement?: string,
    @Query('list_id') listId?: string,
  ) {
    return this.contactsService.listContacts({
      tenantId: req.user.tenantId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search: search || undefined,
      engagement: engagement || undefined,
      listId: listId || undefined,
    });
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.contactsService.findOneContact(id, req.user.tenantId);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = createContactSchema.parse(body);
    return this.contactsService.createContact(data, req.user.tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = updateContactSchema.parse(body);
    return this.contactsService.updateContact(id, data, req.user.tenantId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.contactsService.removeContact(id, req.user.tenantId);
  }
}
