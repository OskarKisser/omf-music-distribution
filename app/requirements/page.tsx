"use client";

import { Suspense, useCallback, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { BotAvatar } from "bot-avatars";
import { AuthGuard } from "@/components/AuthGuard";
import { FeedbackCard } from "@/components/FeedbackCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { hapticMap } from "@/lib/haptic-map";
import { LibraryWebAside } from "@/components/library/LibraryWebAside";
import { parseFaqTopic } from "@/lib/faq-topics";

function FaqWithTopic() {
  const topic = parseFaqTopic(useSearchParams().get("topic"));
  return <LibraryWebAside openTopic={topic} />;
}

export default function RequirementsPage() {
  const [writeOpen, setWriteOpen] = useState(false);
  const closeWrite = useCallback(() => setWriteOpen(false), []);
  return (
    <AuthGuard>
      <div className="mx-auto min-h-app w-full max-w-lg px-1 pb-40 pt-6 text-omf-ink">
        <ScreenHeader
          title="Помощь"
          action={<BotAvatar type="blob" color="#2f3fe0" size={44} aria-label="Бот-помощник" />}
        />
        <button
          type="button"
          onClick={() => {
            hapticMap.impactLight();
            setWriteOpen(true);
          }}
          aria-haspopup="dialog"
          className="omf-focus mb-4 flex w-full items-center gap-3 rounded-control border border-[rgba(140,155,255,0.25)] bg-[rgba(47,63,224,0.13)] px-4 py-3 text-left transition-transform active:scale-[0.99]"
        >
          <MessageCircle className="h-[18px] w-[18px] shrink-0 text-omf-ultra-text" aria-hidden />
          <span className="text-[15px] font-medium text-omf-ink">Написать нам</span>
          <span className="ml-auto truncate text-[12.5px] text-omf-graphite">ошибка, идея или вопрос</span>
        </button>
        <Suspense fallback={<LibraryWebAside />}>
          <FaqWithTopic />
        </Suspense>
      </div>
      <BottomSheet
        open={writeOpen}
        onClose={closeWrite}
        header={(titleId) => (
          <div>
            <p id={titleId} className="text-[17px] font-semibold text-omf-ink">
              Написать нам
            </p>
            <p className="text-[12.5px] text-omf-graphite">Сообщение увидит команда omf</p>
          </div>
        )}
      >
        <FeedbackCard bare />
      </BottomSheet>
    </AuthGuard>
  );
}
