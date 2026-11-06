import { AppLayout } from "@/app/_components/app-layout";

export default function SalesOrdersLayout({ children }: LayoutProps<"/sales-orders">) {
  return <AppLayout>{children}</AppLayout>;
}
