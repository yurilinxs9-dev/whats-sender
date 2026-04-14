import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  transports: ['websocket'],
  pingInterval: 20000,
  pingTimeout: 25000,
})
export class SenderGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SenderGateway.name);

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers.authorization?.split(' ')[1];
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = this.jwtService.verify(token, {
        secret: this.config.get('JWT_SECRET'),
      });
      const tenantId = payload.tenantId ?? payload.tenant_id;
      client.data.userId = payload.sub;
      client.data.tenantId = tenantId;
      client.join(`user:${payload.sub}`);
      if (tenantId) client.join(`tenant:${tenantId}`);
      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub} tenant: ${tenantId})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  private toTenant(tenantId: string | undefined) {
    return tenantId ? this.server.to(`tenant:${tenantId}`) : this.server;
  }

  emitCampaignProgress(campaignId: string, data: Record<string, unknown>, tenantId?: string) {
    this.toTenant(tenantId).emit('campaign:progress', { campaignId, ...data });
  }

  emitCampaignCompleted(campaignId: string, tenantId?: string) {
    this.toTenant(tenantId).emit('campaign:completed', { campaignId });
  }

  emitInstanceStatusChanged(instanceName: string, status: string, tenantId?: string) {
    this.toTenant(tenantId).emit('instance:status-changed', { instanceName, status });
  }

  emitHealthAlert(data: Record<string, unknown>, tenantId?: string) {
    this.toTenant(tenantId).emit('health:alert', data);
  }
}
