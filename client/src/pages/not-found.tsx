import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-full w-full flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md border-border/80 bg-card/95 shadow-xl overflow-hidden">
        <CardContent className="pt-12 pb-12 flex flex-col items-center text-center gap-6">
          <div className="rounded-2xl bg-primary/10 p-5">
            <Compass className="w-14 h-14 text-primary" aria-hidden="true" />
          </div>
          <div>
            <p className="text-5xl font-bold tracking-tight text-foreground">404</p>
            <p className="text-sm text-muted-foreground mt-2 font-medium">This page took a wrong turn</p>
            <p className="text-xs text-muted-foreground/80 mt-1 max-w-[240px] mx-auto">
              The route you’re looking for doesn’t exist. Head back to the dashboard to continue monitoring.
            </p>
          </div>
          <Link href="/">
            <Button size="lg" className="gap-2 rounded-xl font-semibold shadow-md">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back to dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
