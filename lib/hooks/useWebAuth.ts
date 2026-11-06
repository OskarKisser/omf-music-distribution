"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase";
import { appendCurrentTelegramHash } from "@/lib/telegram";
import { forgetWebAdmin } from "@/lib/admin";
import type { User } from "@supabase/supabase-js";

/**
 * Последний известный ответ «кто вошёл» на весь сеанс вкладки. Без него каждый экран в вебе
 * начинал с «проверяем…» и показывал экран загрузки при каждом переходе.
 * null — ещё не знаем, undefined — не вошёл, User — вошёл.
 */
let knownUser: User | null | undefined = null;

/** Сбросить при выходе, чтобы следующий экран не взял старого пользователя. */
export function forgetWebUser() {
  knownUser = null;
  forgetWebAdmin();
}

/**
 * Hook для проверки веб-авторизации
 * Возвращает null пока идет проверка, User если залогинен, undefined если нет
 */
export function useWebAuth(options?: { redirectToLogin?: boolean }) {
  const [user, setUser] = useState<User | null | undefined>(() => knownUser);
  const router = useRouter();
  const pathname = usePathname();
  const { redirectToLogin = false } = options || {};

  useEffect(() => {
    const supabase = createSupabaseBrowser();

    const apply = (next: User | undefined) => {
      knownUser = next;
      setUser(next);
      if (!next && redirectToLogin && pathname !== "/login") {
        router.replace(appendCurrentTelegramHash("/login"));
      }
    };

    // Сессия читается из локального хранилища: ответ быстрый, но асинхронный — поэтому и кэш выше.
    supabase.auth.getSession().then(({ data: { session } }) => apply(session?.user ?? undefined));

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => apply(session?.user ?? undefined));

    return () => {
      subscription.unsubscribe();
    };
  }, [redirectToLogin, router, pathname]);

  return user;
}

/**
 * Hook для logout
 */
export function useLogout() {
  const router = useRouter();

  const logout = async () => {
    const supabase = createSupabaseBrowser();
    await supabase.auth.signOut();
    forgetWebUser();
    router.replace(appendCurrentTelegramHash("/login"));
  };

  return { logout };
}
