import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/ui/sidebar";
import { SearchConversationShell } from "./ai-input-footer";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string; chatId?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const resolvedSearchParams = await searchParams;
  const q = (resolvedSearchParams?.q ?? "").toString();
  const chatId = resolvedSearchParams?.chatId?.toString();

  return (
    <main className="h-screen w-full bg-[#f8f8f7] flex overflow-hidden">
      {/* Desktop: persistent left sidebar */}
      <div className="hidden lg:block h-full shrink-0">
        <AppSidebar />
      </div>

      {/* Mobile / small screens: sidebar in sticky top bar */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="lg:hidden z-40">
          <AppSidebar />
        </div>

        <section className="flex-1 flex flex-col h-full min-w-0">
          <div className="flex-1 min-h-0">
            <SearchConversationShell
              tab="chat"
              searchQuery={q}
              shouldShowTabs={false}
              overallSummaryLines={[]}
              summary={null}
              webItems={[]}
              mediaItems={[]}
              isWeatherQuery={false}
              weatherItems={[]}
              youtubeItems={[]}
              shoppingItems={[]}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
