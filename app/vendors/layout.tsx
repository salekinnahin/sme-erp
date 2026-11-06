import { AppLayout } from "@/app/_components/app-layout";

export default function VendorsLayout({ children }: LayoutProps<"/vendors">) {
  return <AppLayout>{children}</AppLayout>;
}
