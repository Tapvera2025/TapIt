import { describe, expect, it } from 'vitest';
import {
  historyIdParamSchema,
  MAX_NOTE_LENGTH,
  saveNoteSchema,
} from './validators.js';

describe('My Notepad validators', () => {
  describe('saveNoteSchema', () => {
    it('accepts valid note content of typical length', () => {
      const result = saveNoteSchema.parse({ content: 'Hello world notepad' });
      expect(result.content).toBe('Hello world notepad');
    });

    it('accepts empty string note content', () => {
      const result = saveNoteSchema.parse({ content: '' });
      expect(result.content).toBe('');
    });

    it('accepts note content exactly at the 50,000 character limit', () => {
      const largeContent = 'a'.repeat(MAX_NOTE_LENGTH);
      const result = saveNoteSchema.parse({ content: largeContent });
      expect(result.content.length).toBe(MAX_NOTE_LENGTH);
    });

    it('rejects note content exceeding the 50,000 character limit', () => {
      const tooLargeContent = 'a'.repeat(MAX_NOTE_LENGTH + 1);
      expect(() => saveNoteSchema.parse({ content: tooLargeContent })).toThrow();
    });

    it('rejects missing content field', () => {
      expect(() => saveNoteSchema.parse({})).toThrow();
    });

    it('rejects non-string content values', () => {
      expect(() => saveNoteSchema.parse({ content: 12345 })).toThrow();
      expect(() => saveNoteSchema.parse({ content: null })).toThrow();
      expect(() => saveNoteSchema.parse({ content: {} })).toThrow();
    });
  });

  describe('historyIdParamSchema', () => {
    it('accepts valid UUID', () => {
      const id = '123e4567-e89b-12d3-a456-426614174000';
      const result = historyIdParamSchema.parse({ id });
      expect(result.id).toBe(id);
    });

    it('rejects non-UUID strings', () => {
      expect(() => historyIdParamSchema.parse({ id: 'abc-123' })).toThrow();
      expect(() => historyIdParamSchema.parse({ id: '' })).toThrow();
    });
  });
});
