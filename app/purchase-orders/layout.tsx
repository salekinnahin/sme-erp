import { AppLayout } from "@/app/_components/app-layout";

export default function PurchaseOrdersLayout({ children }: LayoutProps<"/purchase-orders">) {
  return <AppLayout>{children}</AppLayout>;
}
