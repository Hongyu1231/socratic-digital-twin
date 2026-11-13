import {
  BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

import { describeMinutes, type SessionRecord } from "@/lib/export/pilot-export";

const FONT = "Calibri";

function labelled(label: string, value: string) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)],
  });
}

function cell(text: string, bold = false) {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });
}

/** Keep the resident's line breaks as separate lines in Word. */
function textRuns(text: string) {
  return text.split(/\r?\n/).map((line, index) => new TextRun({ text: line, ...(index > 0 ? { break: 1 } : {}) }));
}

/** A clean printed record of one session: summary, phase table, then the conversation. */
export function buildSessionDocument(record: SessionRecord): Document {
  const { summary, messages } = record;
  const children: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(`Resident ${summary.code}, ${summary.caseTitle}`)] }),
    labelled("Attempt", summary.attempt === 1 ? "First try at this case" : `Try ${summary.attempt} at this case`),
    labelled("Started", `${summary.startedText} (Singapore time)`),
    labelled("Finished", summary.finishedText ? `${summary.finishedText} (Singapore time)` : "Not finished yet"),
    labelled("Time spent", `${describeMinutes(summary.timeSpentMinutes)}, not counting pauses${summary.status === "in_progress" ? " (up to their last message)" : ""}`),
    labelled("Longest gap between messages", summary.longestGapMinutes === null ? "Not enough messages to tell" : `${describeMinutes(summary.longestGapMinutes)}, not counting pauses`),
    labelled("Session status", summary.statusLabel),
    labelled("AI score", summary.aiScore === null ? "No score yet" : `${summary.aiScore} out of 100`),
    labelled("Times they asked for help", String(summary.helpRequests)),
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240 }, children: [new TextRun("How each phase went")] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" }, bottom: { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" },
        left: { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" }, right: { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" }, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" },
      },
      rows: [
        new TableRow({ tableHeader: true, children: [cell("Phase", true), cell("How it went", true)] }),
        ...summary.phases.map((phase) => new TableRow({ children: [cell(`Phase ${phase.order}: ${phase.title}`), cell(phase.label)] })),
      ],
    }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240 }, children: [new TextRun("The conversation")] }),
  ];

  let shownPhase: number | null = null;
  for (const message of messages) {
    if (message.phaseOrder !== shownPhase) {
      shownPhase = message.phaseOrder;
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2, spacing: { before: 240 },
        children: [new TextRun(message.phaseTitle ? `Phase ${message.phaseOrder}: ${message.phaseTitle}` : `Phase ${message.phaseOrder}`)],
      }));
    }
    const note = message.help === "Asked for help" ? " (pressed Help)" : message.help ? " (in reply to a help request)" : "";
    children.push(new Paragraph({
      spacing: { after: 140 },
      children: [
        new TextRun({ text: `${message.speaker}:`, bold: true }),
        new TextRun({ text: ` ${message.sentText}${note}`, color: "6B6B6B", size: 18 }),
        new TextRun({ text: "", break: 1 }),
        ...textRuns(message.text),
      ],
    }));
  }
  if (messages.length === 0) children.push(new Paragraph("No messages were recorded for this session."));

  return new Document({
    creator: "Socratic Digital Twin",
    title: `Resident ${summary.code}, ${summary.caseTitle}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ children }],
  });
}

export async function writeSessionDocument(record: SessionRecord): Promise<Buffer> {
  return Packer.toBuffer(buildSessionDocument(record));
}
