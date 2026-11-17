export function ModelOutputStamp({ className }: { className?: string }) {
  return (
    <p
      className={`rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-[10px] tracking-wide text-amber-200 uppercase ${className ?? ""}`}
    >
      MODEL OUTPUT — NOT OFFICIAL
    </p>
  );
}