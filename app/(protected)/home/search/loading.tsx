"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/ui/sidebar";
import { Header } from "@/components/ui/header-1";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { AtomLogo } from "@/components/logo";

export default function Loading() {
  const [userText, setUserText] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const rawQuery = params.get("q") || "";
      const trimmedQuery = rawQuery.trim();
      setUserText(trimmedQuery ? `search  ${trimmedQuery}` : "");
    } catch {
      setUserText("");
    }
  }, []);

  return (
    <main className="h-screen bg-white flex overflow-hidden">
      <div className="sticky top-0 h-screen self-start">
        <AppSidebar />
      </div>
      <section className="flex-1 flex flex-col items-center">
        <div className="w-full">
          <Header />
        </div>
        <div className="w-full flex-1 flex justify-center px-4 pb-24">
          <div className="w-full max-w-3xl flex flex-col">
            <Conversation className="flex-1">
              <ConversationContent>
                {userText && (
                  <Message from="user" className="ml-auto">
                    <MessageContent className="bg-neutral-100 text-neutral-900 rounded-xl px-4 py-2 shadow-sm text-center">
                      {userText}
                    </MessageContent>
                  </Message>
                )}
                <Message from="assistant" className="mr-auto">
                  <div className="flex items-start gap-3 w-full flex-row">
                    <div className="shrink-0">
                      <AtomLogo size={28} className="text-foreground" />
                    </div>
                    <div className="w-full pt-1">
                      <MessageContent className="mt-1 text-blue-600 dark:text-blue-400">
                        Searching up…
                      </MessageContent>
                    </div>
                  </div>
                </Message>
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </div>
        </div>
      </section>
    </main>
  );
}
