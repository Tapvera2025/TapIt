import { ApplicationError } from '../../errors.js';

export const CHAT_ERROR_CODES = {
  CONVERSATION_NOT_FOUND: 'CHAT_CONVERSATION_NOT_FOUND',
  MESSAGE_NOT_FOUND: 'CHAT_MESSAGE_NOT_FOUND',
  NOT_A_MEMBER: 'CHAT_NOT_A_MEMBER',
  NOT_SENDER: 'CHAT_NOT_SENDER',
  RECIPIENT_NOT_FOUND: 'CHAT_RECIPIENT_NOT_FOUND',
  VALIDATION_FAILED: 'CHAT_VALIDATION_FAILED',
} as const;

export class ChatNotFoundError extends ApplicationError {
  constructor(what: 'conversation' | 'message' = 'conversation') {
    super(
      `${what === 'conversation' ? 'Conversation' : 'Message'} not found`,
      404,
      what === 'conversation' ? CHAT_ERROR_CODES.CONVERSATION_NOT_FOUND : CHAT_ERROR_CODES.MESSAGE_NOT_FOUND,
    );
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
