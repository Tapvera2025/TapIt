import { z } from 'zod';

export const MAX_NOTE_LENGTH = 50_000;

export const saveNoteSchema = z.object({
  content: z
    .string({ required_error: 'Note content is required' })
    .max(
      MAX_NOTE_LENGTH,
      `Note content must not exceed ${MAX_NOTE_LENGTH.toLocaleString()} characters`,
    ),
});

export const historyIdParamSchema = z.object({
  id: z.string().uuid('Invalid history entry ID'),
});

export type SaveNoteInput = z.infer<typeof saveNoteSchema>;
export type HistoryIdParam = z.infer<typeof historyIdParamSchema>;
