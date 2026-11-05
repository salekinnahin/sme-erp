import { AppHeader } from "@/app/_components/app-header";

export default function SalesOrdersLayout({ children }: LayoutProps<"/sales-orders">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 print:max-w-none print:p-0">
      {/* App chrome is not printed (see the print view). */}
      <div className="print:hidden">
        <AppHeader />
      </div>
      <div className="mt-8 print:mt-0">{children}</div>
    </main>
  );
}
