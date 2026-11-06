import { AppLayout } from "@/app/_components/app-layout";

export default function CustomersLayout({ children }: LayoutProps<"/customers">) {
  return <AppLayout>{children}</AppLayout>;
}
