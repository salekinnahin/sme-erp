import { AppLayout } from "@/app/_components/app-layout";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return <AppLayout>{children}</AppLayout>;
}
