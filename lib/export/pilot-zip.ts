import JSZip from "jszip";

import { writePilotWorkbook } from "@/lib/export/pilot-excel";
import { buildPilotExport, type PilotExportInput } from "@/lib/export/pilot-export";
import { writeSessionDocument } from "@/lib/export/pilot-word";
import type { TeachingClass } from "@/lib/domain";
import type { TutorRepository } from "@/lib/repository/types";

export const WORD_FOLDER = "Transcripts (Word)";

function safeName(text: string) {
  return text.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "class";
}

/**
 * Load one class's assignments and sessions, for a class the caller has
 * already loaded with getClass and authorised. Only class- and
 * assignment-scoped queries are used.
 */
export async function loadPilotExportInput(repository: Pick<TutorRepository, "listAssignmentsForClass" | "listSessionsForAssignments">, teachingClass: TeachingClass, exportedAt = new Date()): Promise<PilotExportInput> {
  const assignments = await repository.listAssignmentsForClass(teachingClass.id);
  const sessions = await repository.listSessionsForAssignments(assignments.map((item) => item.id));
  return { teachingClass, assignments, sessions, exportedAt };
}

export interface PilotZip {
  fileName: string;
  workbookName: string;
  buffer: Buffer;
}

export async function buildPilotZip(input: PilotExportInput): Promise<PilotZip> {
  const data = buildPilotExport(input);
  const stem = `socratic-pilot-${safeName(data.classCode)}-${data.exportDate}`;
  const zip = new JSZip();
  const workbookName = `${stem}.xlsx`;
  zip.file(workbookName, await writePilotWorkbook(data), { date: data.exportedAt });
  const folder = zip.folder(WORD_FOLDER)!;
  for (const record of data.sessions) {
    folder.file(record.summary.fileName, await writeSessionDocument(record), { date: data.exportedAt });
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { fileName: `${stem}.zip`, workbookName, buffer };
}
