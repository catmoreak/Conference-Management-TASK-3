export default function Loading() {
  return (
    <div className="flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-4 bg-bg-primary">
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-border-soft border-t-accent-green"
        role="status"
        aria-label="Loading"
      />
      <p className="text-sm font-medium text-text-secondary">Loading...</p>
    </div>
  );
}
