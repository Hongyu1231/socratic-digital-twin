import { ProfessorReview } from "./professor-review";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProfessorReview sessionId={id} />;
}
