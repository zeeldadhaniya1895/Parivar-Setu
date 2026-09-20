import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { schemesConfig } from "@/lib/schemes";

/** Eligibility thresholds are simplified demo values, not official criteria. Shown wherever they are used. */
export function DemoNotice() {
  return (
    <Alert>
      <AlertTitle>Demo criteria</AlertTitle>
      <AlertDescription>
        {schemesConfig.notice} Rules version {schemesConfig.version}.
      </AlertDescription>
    </Alert>
  );
}
