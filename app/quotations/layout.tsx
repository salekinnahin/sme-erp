import { AppLayout } from "@/app/_components/app-layout";

export default function QuotationsLayout({ children }: LayoutProps<"/quotations">) {
  return <AppLayout>{children}</AppLayout>;
}
