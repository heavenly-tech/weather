import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function ProductLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-live="polite" aria-busy="true">
      <Skeleton className="h-6 w-48" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

export function ProductEmpty({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent className="py-10">
        <p className="font-heading text-base">{title}</p>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

export function ProductError({ title, body }: { title: string; body: string }) {
  return (
    <Card className="ring-rose-500/30">
      <CardContent className="py-10">
        <p className="font-heading text-base text-rose-200">{title}</p>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
