import { AppHeader } from "@/app/_components/app-header";

export default function ProductsLayout({ children }: LayoutProps<"/products">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8">
      <AppHeader />
      <div className="mt-8">{children}</div>
    </main>
  );
}
