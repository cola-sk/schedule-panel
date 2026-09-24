import { redirect } from "next/navigation";

export default function AISettingsRedirectPage() {
  redirect("/settings?tab=ai");
}
