import JSZip from "jszip";

import { writePilotWorkbook } from "@/lib/export/pilot-excel";
import { buildPilotExport, type PilotExportInput } from "@/lib/export/pilot-export";
import { writeSessionDocument } from "@/lib/export/pilot-word";
import type { TutorRepository } from "@/lib/repository/types";

export const WORD_FOLDER = "Transcripts (Word)";

function safeName(text: string) {
  return text.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "class";
}

/** Gather everything one class's export needs from the repository. */
export async function loadPilotExportInput(repository: TutorRepository, classId: string, exportedAt = new Date()): Promise<PilotExportInput | null> {
  const teachingClass = (await repository.listClasses()).find((item) => item.id === classId);
  if (!teachingClass) return null;
  const assignments = (await repository.listAssignments()).filter((item) => item.classId === classId);
  const assignmentIds = new Set(assignments.map((item) => item.id));
  const sessions = assignmentIds.size
    ? (await repository.listSessions()).filter((bundle) => bundle.session.assignmentId && assignmentIds.has(bundle.session.assignmentId))
    : [];
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
