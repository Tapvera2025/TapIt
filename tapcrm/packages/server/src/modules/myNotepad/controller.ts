import type { NextFunction, Request, Response } from 'express';
import type { RequestContext } from '../../platform/dal/context.js';
import { PlatformAuthenticationError } from '../../platform/errors.js';
import { success } from '../../platform/http/envelope.js';
import {
  clearNote,
  getCurrentNote,
  getHistoricalNote,
  getNoteHistory,
  saveNote,
} from './service.js';
import { historyIdParamSchema, saveNoteSchema } from './validators.js';

function getContext(req: Request): RequestContext {
  if (!req.ctx) {
    throw new PlatformAuthenticationError('Authentication required');
  }
  return req.ctx;
}

export async function getCurrentNoteController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const note = await getCurrentNote(ctx);
    res.status(200).json(success(note));
  } catch (error) {
    next(error);
  }
}

export async function saveNoteController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const input = saveNoteSchema.parse(req.body);
    const note = await saveNote(ctx, input);
    res.status(200).json(success(note));
  } catch (error) {
    next(error);
  }
}

export async function clearNoteController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const note = await clearNote(ctx);
    res.status(200).json(success(note));
  } catch (error) {
    next(error);
  }
}

export async function getNoteHistoryController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const history = await getNoteHistory(ctx);
    res.status(200).json(success(history));
  } catch (error) {
    next(error);
  }
}

export async function getHistoricalNoteController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = getContext(req);
    const { id } = historyIdParamSchema.parse(req.params);
    const item = await getHistoricalNote(ctx, id);
    res.status(200).json(success(item));
  } catch (error) {
    next(error);
  }
}
