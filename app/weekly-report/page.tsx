import { redirect } from "next/navigation";

export default function WeeklyReportRedirectPage() {
  redirect("/?scheduleId=weekly-report-schedule");
}
