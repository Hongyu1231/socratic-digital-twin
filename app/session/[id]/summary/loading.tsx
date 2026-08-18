/**
 * Gives the summary route a Suspense boundary. Without it a client-side
 * transition holds the previous page on screen until the whole route is ready,
 * which reads as a frozen app.
 */
export default function SummaryLoading() {
  return (
    <div className="content-shell" aria-busy="true" aria-label="Loading your session summary">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">Learning synthesis</span>
          <h1>Session summary</h1>
        </div>
      </div>
      <div className="skeleton-card" aria-hidden="true" />
    </div>
  );
}
