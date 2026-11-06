import { AppLayout } from "@/app/_components/app-layout";

export default function InvoicesLayout({ children }: LayoutProps<"/invoices">) {
  return <AppLayout>{children}</AppLayout>;
}
