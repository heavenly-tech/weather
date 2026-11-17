export function ModelOutputStamp({ className }: { className?: string }) {
  return (
    <p
      className={`rounded-md border-2 border-amber-400 bg-amber-500/25 px-3 py-2 font-mono text-sm font-semibold tracking-wide text-amber-100 uppercase ${className ?? ""}`}
    >
      MODEL OUTPUT — NOT OFFICIAL
    </p>
  );
}