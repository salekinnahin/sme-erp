import { AppLayout } from "@/app/_components/app-layout";

export default function ProductsLayout({ children }: LayoutProps<"/products">) {
  return <AppLayout>{children}</AppLayout>;
}
