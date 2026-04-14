export type UazApiWebhookEvent =
  | 'message.delivery'
  | 'message.read'
  | 'message.reply'
  | 'message.blocked'
  | 'instance.status';

export interface UazApiWebhookPayload {
  event: UazApiWebhookEvent;
  /** The WhatsApp message ID returned when the message was sent */
  messageId?: string;
  /** The instance token or identifier that sent/received the event */
  instanceToken?: string;
  /** The instance name */
  instanceName?: string;
  /** The phone number of the contact involved */
  phone?: string;
  /** Reply content (for message.reply events) */
  replyContent?: string;
  /** Instance connection state (for instance.status events) */
  state?: 'open' | 'close' | 'connecting';
  /** Timestamp of the event */
  timestamp?: string;
}
