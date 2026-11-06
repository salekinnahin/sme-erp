import { redirect } from "next/navigation";

/** The only settings section today. */
export default function SettingsPage() {
  redirect("/settings/organization");
}
