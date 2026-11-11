import { ApplicationError } from '../../errors.js';

export const CHAT_ERROR_CODES = {
  CONVERSATION_NOT_FOUND: 'CHAT_CONVERSATION_NOT_FOUND',
  MESSAGE_NOT_FOUND: 'CHAT_MESSAGE_NOT_FOUND',
  ATTACHMENT_NOT_FOUND: 'CHAT_ATTACHMENT_NOT_FOUND',
  SCHEDULED_NOT_FOUND: 'CHAT_SCHEDULED_MESSAGE_NOT_FOUND',
  NOT_A_MEMBER: 'CHAT_NOT_A_MEMBER',
  NOT_SENDER: 'CHAT_NOT_SENDER',
  RECIPIENT_NOT_FOUND: 'CHAT_RECIPIENT_NOT_FOUND',
  VALIDATION_FAILED: 'CHAT_VALIDATION_FAILED',
  EDIT_WINDOW_CLOSED: 'CHAT_EDIT_WINDOW_CLOSED',
  CLIENT_NOT_ALLOWED: 'CHAT_CLIENT_NOT_ALLOWED',
} as const;

type Missing = 'conversation' | 'message' | 'attachment' | 'scheduled';

const MISSING: Record<Missing, { text: string; code: string }> = {
  conversation: { text: 'Conversation not found', code: CHAT_ERROR_CODES.CONVERSATION_NOT_FOUND },
  message: { text: 'Message not found', code: CHAT_ERROR_CODES.MESSAGE_NOT_FOUND },
  attachment: { text: 'File not found', code: CHAT_ERROR_CODES.ATTACHMENT_NOT_FOUND },
  scheduled: { text: 'Scheduled message not found', code: CHAT_ERROR_CODES.SCHEDULED_NOT_FOUND },
};

export class ChatNotFoundError extends ApplicationError {
  constructor(what: Missing = 'conversation') {
    super(MISSING[what].text, 404, MISSING[what].code);
  }
}

/** Thrown when someone tries to unsend, edit or otherwise act on a message they did not send. */
export class ChatNotSenderError extends ApplicationError {
  constructor() {
    super('Only the sender may do this', 403, CHAT_ERROR_CODES.NOT_SENDER);
  }
}

export class ChatValidationError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 422, CHAT_ERROR_CODES.VALIDATION_FAILED, details);
  }
}

/** The 15-minute edit window has passed (product decision): the message stays as sent. */
export class ChatEditWindowClosedError extends ApplicationError {
  constructor(minutes: number) {
    super(`Messages can only be edited within ${minutes} minutes of sending`, 422, CHAT_ERROR_CODES.EDIT_WINDOW_CLOSED);
  }
}

/** An employee-only chat capability (pinning, saving, scheduling, search) requested by a client account. */
export class ChatClientNotAllowedError extends ApplicationError {
  constructor() {
    super('This is not available in the client portal', 403, CHAT_ERROR_CODES.CLIENT_NOT_ALLOWED);
  }
}
