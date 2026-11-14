import { SocraticChat } from "../socratic-chat";

export default async function TranscriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SocraticChat sessionId={id} readOnly />;
}
