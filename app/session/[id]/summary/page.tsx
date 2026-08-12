import { SessionSummaryView } from "./summary-view";

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionSummaryView sessionId={id} />;
}
