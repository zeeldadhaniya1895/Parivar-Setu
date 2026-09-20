import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function Home({ searchParams }: { searchParams: Promise<{ needs?: string }> }) {
  const { needs } = await searchParams;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Parivar Setu</h1>
        <p className="text-muted-foreground">
          One verified Family ID for Gujarat that connects scattered scheme records, catches leakage, and tells
          every family what they are entitled to.
        </p>
      </div>

      {needs === "officer" && (
        <Alert>
          <AlertTitle>Choose the officer role first</AlertTitle>
          <AlertDescription>That page is for department officers.</AlertDescription>
        </Alert>
      )}

      <Alert>
        <AlertTitle>Demo mode</AlertTitle>
        <AlertDescription>
          There is no sign-in. All data is synthetic and all eligibility thresholds are simplified demo values, not
          official criteria. The role below only switches the view.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Department officer</CardTitle>
            <CardDescription>Dashboard, families, match lineage, flags and the review queue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/api/role" method="post">
              <input type="hidden" name="role" value="officer" />
              <Button type="submit" size="lg">Continue as officer</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Citizen</CardTitle>
            <CardDescription>Look up a Family ID, see eligible schemes, and ask the assistant.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/api/role" method="post">
              <input type="hidden" name="role" value="citizen" />
              <Button type="submit" size="lg" variant="outline">Continue as citizen</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
