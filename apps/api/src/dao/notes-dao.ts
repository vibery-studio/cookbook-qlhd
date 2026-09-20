/**
 * Notes DAO. Demo-only — showcases idempotency + ownership. A real
 * product would replace this file with its own resource DAO.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { notes } from "../db/schema";

export interface NoteDto {
  id: string;
  userId: string;
  title: string;
  body: string;
  createdAt: number;
}

export interface CreateNoteInput {
  id: string;
  userId: string;
  title: string;
  body: string;
  createdAt: number;
}

export async function createNote(db: Db, input: CreateNoteInput): Promise<NoteDto> {
  const rows = await db.insert(notes).values(input).returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error("createNote: insert returned no rows");
  }
  return row;
}

export async function findNoteById(db: Db, id: string): Promise<NoteDto | null> {
  const row = await db.query.notes.findFirst({ where: eq(notes.id, id) });
  return row ?? null;
}
