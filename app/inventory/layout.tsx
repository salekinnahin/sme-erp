import { AppLayout } from "@/app/_components/app-layout";

export default function InventoryLayout({ children }: LayoutProps<"/inventory">) {
  return <AppLayout>{children}</AppLayout>;
}
