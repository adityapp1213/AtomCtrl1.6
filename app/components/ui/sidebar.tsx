"use client";
import { cn } from "@/lib/utils";
import { AtomLogo } from "@/components/logo";
import { UserButton, useUser } from "@clerk/nextjs";
import Link, { LinkProps } from "next/link";
import Image from "next/image";
import React, { useState, createContext, useContext } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X, SquarePen, Trash2 } from "lucide-react";
import { useSupabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

interface Links {
  label: string;
  href: string;
  icon: React.JSX.Element | React.ReactNode;
}

interface SidebarContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

const SidebarContext = createContext<SidebarContextProps | undefined>(undefined);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export const SidebarProvider = ({ children, open: openProp, setOpen: setOpenProp, animate = true }: { children: React.ReactNode; open?: boolean; setOpen?: React.Dispatch<React.SetStateAction<boolean>>; animate?: boolean }) => {
  const [openState, setOpenState] = useState(false);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;
  return <SidebarContext.Provider value={{ open, setOpen, animate }}>{children}</SidebarContext.Provider>;
};

export const Sidebar = ({ children, open, setOpen, animate }: { children: React.ReactNode; open?: boolean; setOpen?: React.Dispatch<React.SetStateAction<boolean>>; animate?: boolean }) => {
  return (
    <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
      {children}
    </SidebarProvider>
  );
};

export const SidebarBody = (props: React.ComponentProps<typeof motion.div>) => {
  return (
    <>
      <DesktopSidebar {...props} />
      <MobileSidebar {...(props as React.ComponentProps<"div">)} />
    </>
  );
};

export const DesktopSidebar = ({ className, children, ...props }: React.ComponentProps<typeof motion.div>) => {
  const { open, animate } = useSidebar();
  return (
    <motion.div
      className={cn(
        "h-full px-4 pt-2 pb-4 hidden md:flex md:flex-col bg-neutral-100 dark:bg-neutral-800 w-[300px] flex-shrink-0",
        className
      )}
      animate={{ width: animate ? (open ? "300px" : "60px") : "300px" }}
      {...props}
    >
      {children}
    </motion.div>
  );
};

export const MobileSidebar = ({ className, children, ...props }: React.ComponentProps<"div">) => {
  const { open, setOpen } = useSidebar();
  return (
    <>
      <div
        className={cn(
          "sticky top-0 left-0 right-0 z-40 px-4 pt-4 pb-2 flex flex-row md:hidden items-center bg-white dark:bg-neutral-900 w-full",
          className
        )}
        {...props}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 text-neutral-900 dark:text-neutral-100"
          aria-label="Open sidebar"
        >
          <Image
            src="/sidebaricon.png"
            alt="Sidebar"
            width={26}
            height={26}
            className="h-8 w-8"
          />
          <AtomLogo
            className="h-8 w-auto text-neutral-900 dark:text-neutral-100"
            ariaLabel="App logo"
            title="App"
            size={32}
          />
          <span className="text-2xl font-semibold font-serif italic text-neutral-900 dark:text-neutral-100">
            Ctrl 1.6 Beta
          </span>
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className={cn(
              "fixed inset-0 z-[100] bg-white dark:bg-neutral-900 flex flex-col md:hidden",
              className
            )}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <AtomLogo
                  className="h-8 w-auto text-neutral-900 dark:text-neutral-100"
                  ariaLabel="App logo"
                  title="App"
                  size={32}
                />
                <span className="text-xl font-semibold font-serif italic text-neutral-900 dark:text-neutral-100">
                  Ctrl 1.6 Beta
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-neutral-800 dark:text-neutral-200"
                aria-label="Close sidebar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export const SidebarLink = ({ link, className, ...props }: { link: Links; className?: string; props?: LinkProps }) => {
  const { open, animate } = useSidebar();
  return (
    <Link href={link.href} className={cn("flex items-center justify-start gap-2 group/sidebar py-2", className)} {...props}>
      {link.icon}
      <motion.span animate={{ display: animate ? (open ? "inline-block" : "none") : "inline-block", opacity: animate ? (open ? 1 : 0) : 1 }} className="text-neutral-700 dark:text-neutral-200 text-sm group-hover/sidebar:translate-x-1 transition duration-150 whitespace-pre inline-block !p-0 !m-0">
        {link.label}
      </motion.span>
    </Link>
  );
};

export const AppSidebar = () => {
  return (
    <Sidebar>
      <SidebarBody className="border-r border-neutral-200 dark:border-neutral-800">
        <AppSidebarContent />
      </SidebarBody>
    </Sidebar>
  );
};

type HistoryItem = {
  id: string;
  request_type: string;
  timestamp: string;
  response_status: number | null;
};

const LocalHistory = () => {
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const deleteChat = useMutation(api.chat.deleteChat);
  const { setOpen } = useSidebar();

  const userId = user?.id ?? null;
  const chats = useQuery(
    api.chat.listUserChats,
    userId ? { userId } : "skip"
  );

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId) return;
    try {
      await deleteChat({ userId, sessionId });
    } catch (err) {
      console.error("Failed to delete chat", err);
    }
    const currentChatId = searchParams.get("chatId");
    if (currentChatId === sessionId) {
      router.push("/home");
    }
  };

  const activeChatId = searchParams.get("chatId");

  if (!chats || !chats.length) return null;

  return (
    <div className="flex flex-col gap-2 mb-4">
      <ul className="space-y-1">
        {chats.map((item: any) => {
          const isActive = activeChatId === item.sessionId;
          return (
            <li key={item.sessionId} className="group relative">
              {isActive && (
                <span className="absolute left-2 top-2 h-2 w-2 rounded-full bg-red-500" />
              )}
              <Link
                href={`/home/search?chatId=${encodeURIComponent(item.sessionId)}`}
                className={cn(
                  "block rounded-md border border-neutral-200 dark:border-neutral-700 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors",
                  isActive
                    ? "bg-neutral-100 dark:bg-neutral-800 pl-5 pr-2"
                    : "px-2"
                )}
                onClick={() => {
                  if (typeof window !== "undefined" && window.innerWidth < 768) {
                    setOpen(false);
                  }
                }}
              >
                <div className="flex justify-between gap-2 pr-6">
                  <span className="font-medium truncate">
                    {item.name || item.title || "New chat"}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-400">
                  {new Date(item.updatedAt || item.createdAt).toLocaleTimeString()}
                </div>
              </Link>
              <button
                onClick={(e) => handleDelete(e, item.sessionId)}
                className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-red-500 transition-all"
                aria-label="Delete chat"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const AppSidebarContent = () => {
  const { user } = useUser();
  const { open, setOpen } = useSidebar();
  const showRequestHistory = false;
  const displayName =
    user?.fullName ??
    user?.primaryEmailAddress?.emailAddress ??
    user?.username ??
    "Account";

  if (!open) {
    return (
      <div className="flex h-full flex-col items-center">
        <button
          type="button"
          className="mt-0 flex h-11 w-11 items-center justify-center rounded-md bg-transparent text-neutral-900 dark:text-neutral-100 outline-none transition hover:bg-neutral-200/70 dark:hover:bg-neutral-700/70 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-neutral-500"
          aria-label="Open sidebar"
          onClick={() => setOpen(true)}
        >
          <AtomLogo
            className="h-9 w-9"
            ariaLabel="Atom Ctrl logo"
            title="Atom Ctrl"
            size={33}
          />
        </button>
        <Link
          href="/home"
          aria-label="New chat"
          className="mt-3 flex h-10 w-10 items-center justify-center rounded-md text-neutral-900 dark:text-neutral-100 hover:bg-neutral-200/80 dark:hover:bg-neutral-700/80 transition-colors"
        >
          <SquarePen className="w-4 h-4" />
        </Link>
        <div className="mt-auto pb-2">
          <UserButton />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="hidden md:flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AtomLogo
            className="h-9 w-9 text-neutral-900 dark:text-neutral-100"
            ariaLabel="Atom Ctrl logo"
            title="Atom Ctrl"
            size={33}
          />
          <span className="text-lg font-semibold font-serif italic text-neutral-900 dark:text-neutral-100">
            atom ctrl
          </span>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:text-red-600 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500 outline-none"
          aria-label="Collapse sidebar"
          onClick={() => setOpen(false)}
        >
          <span className="-mr-px text-lg leading-none">&lt;</span>
        </button>
      </div>
      <Link
        href="/home"
        className="flex items-center gap-2 px-2 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 rounded-md hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 transition-colors"
      >
        <SquarePen className="w-4 h-4" />
        <span>New chat</span>
      </Link>
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          History
        </h2>
        <LocalHistory />
        {showRequestHistory && <RequestHistory userId={user?.id ?? null} />}
      </div>
      <div className="mt-2 pt-3 border-t border-neutral-200 dark:border-neutral-700 flex items-center gap-3">
        <UserButton />
        <span className="text-sm text-neutral-700 dark:text-neutral-200 truncate">
          {displayName}
        </span>
      </div>
    </div>
  );
};

const RequestHistory = ({ userId }: { userId: string | null }) => {
  const supabase = useSupabase();
  const [items, setItems] = React.useState<HistoryItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!supabase || !userId) return;
    const sb = supabase;
    let cancelled = false;
    setLoadError(null);

    async function loadInitial() {
      setLoading(true);
      try {
        const { data, error } = await sb
          .from("user_requests")
          .select("id, request_type, timestamp, response_status")
          .eq("user_id", userId)
          .order("timestamp", { ascending: false })
          .limit(20);
        if (error) {
          const message = error.message;
          const code = (error as { code?: string }).code;
          const details = (error as { details?: string }).details;
          const status = (error as { status?: number }).status;
          const normalized = (message || "").toLowerCase();
          const isKeyError =
            normalized.includes("no suitable key") ||
            normalized.includes("wrong key type");
          const isAuthError =
            status === 401 ||
            status === 403 ||
            normalized.includes("jwt") ||
            normalized.includes("not authorized") ||
            normalized.includes("permission denied");
          if (isKeyError) {
            console.warn("[history:load_initial:key_error]", {
              message,
              code,
              details,
            });
            if (!cancelled) {
              setLoadError(null);
              setItems([]);
              setCursor(null);
            }
          } else if (isAuthError) {
            if (!cancelled) {
              setLoadError(null);
              setItems([]);
              setCursor(null);
            }
          } else {
            console.error("[history:load_initial:error]", {
              message,
              code,
              details,
            });
            if (!cancelled) {
              setLoadError(message || "History query failed");
            }
          }
          return;
        }
        if (!cancelled && Array.isArray(data)) {
          const rows = data as HistoryItem[];
          setItems(rows);
          const last = rows[rows.length - 1];
          setCursor(last ? last.timestamp : null);
          setLoadError(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInitial();

    const channel = supabase
      .channel("user_requests_history")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_requests",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as HistoryItem & { user_id?: string };
          setItems((prev) => {
            const exists = prev.some((it) => it.id === row.id);
            if (exists) return prev;
            return [{ id: row.id, request_type: row.request_type, timestamp: row.timestamp, response_status: row.response_status ?? null }, ...prev].slice(0, 50);
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  async function loadMore() {
    if (!supabase || !userId || !cursor || loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_requests")
        .select("id, request_type, timestamp, response_status")
        .eq("user_id", userId)
        .lt("timestamp", cursor)
        .order("timestamp", { ascending: false })
        .limit(20);
      if (error) {
        const message = error.message;
        const code = (error as { code?: string }).code;
        const details = (error as { details?: string }).details;
        const status = (error as { status?: number }).status;
        const normalized = (message || "").toLowerCase();
        const isAuthError =
          status === 401 ||
          status === 403 ||
          normalized.includes("jwt") ||
          normalized.includes("not authorized") ||
          normalized.includes("permission denied");
        if (!isAuthError) {
          console.error("[history:load_more:error]", {
            message,
            code,
            details,
          });
        }
        return;
      }
      if (Array.isArray(data) && data.length) {
        const rows = data as HistoryItem[];
        setItems((prev) => [...prev, ...rows]);
        const last = rows[rows.length - 1];
        setCursor(last ? last.timestamp : cursor);
      } else {
        setCursor(null);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!userId) {
    return null;
  }

  if (loadError) {
    return (
      <div className="mt-2 text-xs text-red-500 dark:text-red-400">
        History unavailable. {loadError}
      </div>
    );
  }

  if (!items.length && loading) {
    return (
      <div className="space-y-2 mt-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-6 w-full rounded-md bg-neutral-200 dark:bg-neutral-700" />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
        No history yet.
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <span className="font-medium truncate">{item.request_type}</span>
              {item.response_status != null && (
                <span className={cn("shrink-0", item.response_status >= 200 && item.response_status < 400 ? "text-emerald-500" : "text-red-500")}>
                  {item.response_status}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-400">
              {new Date(item.timestamp).toLocaleTimeString()}
            </div>
          </li>
        ))}
      </ul>
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300 hover:underline self-start disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
};
