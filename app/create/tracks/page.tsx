"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, UserPlus, X } from "lucide-react";
import { CreateShell } from "@/features/release/createRelease/components/CreateShell";
import { WizardActionBar } from "@/features/release/createRelease/components/WizardActionBar";
import { StepGate } from "@/features/release/createRelease/components/StepGate";
import { useStepGuard } from "@/features/release/createRelease/guards";
import { tracksSchema } from "@/features/release/createRelease/schemas";
import type { CreateTracks } from "@/features/release/createRelease/types";
import { useCreateReleaseDraftStore } from "@/features/release/createRelease/store";
import {
  saveDraftAction,
  uploadTrackWavAtIndex,
  uploadTracksForDraftStep
} from "@/features/release/createRelease/actions";
import { FormFieldError } from "@/components/FormFieldError";
import { MAX_WAV_MB } from "@/lib/storage-buckets";
import {
  GLASS_FIELD_ERROR_STRONG,
  WIZARD_FIELD_LABEL_CLASS,
  WIZARD_INPUT_CLASS
} from "@/lib/glass-form-classes";
import {
  acquireTelegramClosingConfirmation,
  releaseTelegramClosingConfirmation,
  triggerHaptic
} from "@/lib/telegram";
import { validateWavFile } from "@/lib/wav-validator";
import { toast } from "sonner";
import { BusyLabel } from "@/components/BusyLabel";

const FileUploader = dynamic(
  () => import("@/components/FileUploader").then((m) => m.FileUploader),
  { ssr: false }
);

const MAX_FEATURING_ARTISTS = 12;

export default function CreateTracksPage() {
  const router = useRouter();
  const guard = useStepGuard("tracks");

  const releaseType = useCreateReleaseDraftStore((s) => s.metadata.releaseType);
  const releaseTitle = useCreateReleaseDraftStore((s) => s.metadata.releaseTitle);
  const storeTracks = useCreateReleaseDraftStore((s) => s.tracks);
  const storeTrackFiles = useCreateReleaseDraftStore((s) => s.trackFiles);
  const trackFilesMeta = useCreateReleaseDraftStore((s) => s.trackFilesMeta);
  const setTracks = useCreateReleaseDraftStore((s) => s.setTracks);
  const setTrackFile = useCreateReleaseDraftStore((s) => s.setTrackFile);
  const clearTrackFile = useCreateReleaseDraftStore((s) => s.clearTrackFile);
  const setTrackAudioUrlAt = useCreateReleaseDraftStore((s) => s.setTrackAudioUrlAt);
  const syncTrackFilesLength = useCreateReleaseDraftStore((s) => s.syncTrackFilesLength);
  const submitError = useCreateReleaseDraftStore((s) => s.submitError);
  const setSubmitError = useCreateReleaseDraftStore((s) => s.setSubmitError);
  const tracksUploadInProgress = useCreateReleaseDraftStore((s) => s.tracksUploadInProgress);
  const trackAudioUrlsFromDb = useCreateReleaseDraftStore((s) => s.trackAudioUrlsFromDb);

  const showResumeAudioBanner = useMemo(
    () =>
      trackAudioUrlsFromDb.some(
        (url, i) => Boolean(url?.trim()) && !storeTrackFiles[i]
      ),
    [trackAudioUrlsFromDb, storeTrackFiles]
  );

  const isSingle = releaseType === "single";
  const canAddTrack = !isSingle;
  /** Пока false — при смене названия релиза подставляем его в трек; после правки трека не перетираем (фиты / совместные названия). */
  const singleTrackTitleTouchedRef = useRef(false);

  // Compute initial tracks respecting the release-type constraint at mount time.
  // useState initializer runs once, so this captures the correct store snapshot
  // without subscribing to future changes.
  const [initialTracks] = useState<CreateTracks["tracks"]>(() => {
    const { tracks, metadata } = useCreateReleaseDraftStore.getState();
    const empty = {
      title: "",
      explicit: false,
      lyrics: "",
      featuringArtistNames: [] as string[]
    };
    const base =
      tracks.length > 0
        ? tracks.map((t) => ({
            ...t,
            featuringArtistNames: t.featuringArtistNames ?? []
          }))
        : [empty];
    if (metadata.releaseType === "single") {
      const row = base[0] ?? empty;
      const trackT = (row.title ?? "").trim();
      const releaseT = (metadata.releaseTitle ?? "").trim();
      return [{ ...row, title: trackT || releaseT }];
    }
    return base;
  });

  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    getValues,
    formState: { errors, isValid, isDirty, dirtyFields, isSubmitting }
  } = useForm<CreateTracks>({
    resolver: zodResolver(tracksSchema),
    mode: "onChange",
    defaultValues: { tracks: initialTracks }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "tracks"
  });

  // Post-mount hydration fix: after the component mounts on the client the
  // Zustand store is fully rehydrated from localStorage. We reset the form once
  // so the displayed values are guaranteed to match the persisted state, even on
  // a hard page-refresh where the SSR pass rendered empty defaults.
  const didHydrateRef = useRef(false);
  useEffect(() => {
    if (didHydrateRef.current) return;
    didHydrateRef.current = true;

    const {
      tracks: storedTracks,
      metadata: { releaseType: storedType, releaseTitle: storedReleaseTitle }
    } = useCreateReleaseDraftStore.getState();

    const empty = {
      title: "",
      explicit: false,
      lyrics: "",
      featuringArtistNames: [] as string[]
    };
    const base =
      storedTracks.length > 0
        ? storedTracks.map((t) => ({
            ...t,
            featuringArtistNames: t.featuringArtistNames ?? []
          }))
        : [empty];
    const freshTracks =
      storedType === "single"
        ? [
            {
              ...(base[0] ?? empty),
              title: (() => {
                const trackT = (base[0]?.title ?? "").trim();
                const releaseT = (storedReleaseTitle ?? "").trim();
                return trackT || releaseT;
              })()
            }
          ]
        : base;

    reset({ tracks: freshTracks }, { keepDirty: false });

    if (storedType === "single") {
      const t0 = (freshTracks[0]?.title ?? "").trim();
      const rt = (storedReleaseTitle ?? "").trim();
      singleTrackTitleTouchedRef.current = t0.length > 0 && t0 !== rt;
    }

    // If the cap trimmed the track list, sync the store immediately.
    if (storedType === "single" && storedTracks.length > 1) {
      const trackT = (base[0]?.title ?? "").trim();
      const releaseT = (storedReleaseTitle ?? "").trim();
      setTracks([
        {
          ...(base[0] ?? {
            title: "",
            explicit: false,
            lyrics: "",
            featuringArtistNames: []
          }),
          title: trackT || releaseT
        }
      ]);
      syncTrackFilesLength(1);
    }
  }, [reset, setTracks, syncTrackFilesLength]);

  // Сингл: по умолчанию название трека = название релиза; если пользователь уже ввёл своё (feat и т.д.) — не затираем.
  useEffect(() => {
    if (!isSingle) return;
    if (singleTrackTitleTouchedRef.current) return;
    setValue("tracks.0.title", releaseTitle, { shouldValidate: true, shouldDirty: false });
  }, [isSingle, releaseTitle, setValue]);

  const values = watch();
  const lastSyncedTracksRef = useRef<string>("");

  // Persist form values to store while editing (debounced).
  useEffect(() => {
    if (!isDirty) return;
    const serializedTracks = JSON.stringify(values.tracks);
    if (serializedTracks === lastSyncedTracksRef.current) return;
    const id = window.setTimeout(() => {
      setTracks(values.tracks);
      syncTrackFilesLength(values.tracks.length);
      lastSyncedTracksRef.current = serializedTracks;
    }, 200);
    return () => window.clearTimeout(id);
  }, [isDirty, setTracks, syncTrackFilesLength, values.tracks]);

  // Keep trackFiles array length in sync whenever the field-array length changes.
  useEffect(() => {
    syncTrackFilesLength(fields.length);
  }, [fields.length, syncTrackFilesLength]);

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [trackUploadProgress, setTrackUploadProgress] = useState<Record<number, number>>({});
  const [activeUploadIndex, setActiveUploadIndex] = useState<number | null>(null);
  const [isUploadingWav, setIsUploadingWav] = useState(false);
  const [showFeat, setShowFeat] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [expandedTracks, setExpandedTracks] = useState<boolean[]>([true]);

  useEffect(() => {
    if (isSingle) return;
    setExpandedTracks((prev) => {
      const next = prev.slice(0, fields.length);
      while (next.length < fields.length) next.push(false);
      if (next.length > 0 && !next.some(Boolean)) next[0] = true;
      return next;
    });
  }, [fields.length, isSingle]);

  /** Локальный прогресс XHR + флаг стора — блокируем «Далее», пока идёт реальный аплоад. */
  const isWavTransferActive = useMemo(
    () =>
      tracksUploadInProgress ||
      Object.keys(trackUploadProgress).length > 0,
    [tracksUploadInProgress, trackUploadProgress]
  );

  const handleNext = useCallback(
    async (data: CreateTracks) => {
      triggerHaptic("light");
      setSubmitAttempted(true);
      setSubmitError(null);
      setTracks(data.tracks);
      syncTrackFilesLength(data.tracks.length);

      // Re-read files from store at submit time (avoids stale closure).
      const currentFiles = useCreateReleaseDraftStore.getState().trackFiles;
      const missing = data.tracks.some((_t, idx) => !currentFiles[idx]);
      if (missing) {
        const msg = "Загрузите WAV-файл для каждого трека.";
        setSubmitError(msg);
        toast.error(msg);
        return;
      }

      setIsUploadingWav(true);
      setTrackUploadProgress({});
      acquireTelegramClosingConfirmation();
      try {
        const saved = await saveDraftAction();
        if (!saved.ok) {
          toast.error(saved.message);
          setSubmitError(saved.message);
          return;
        }
        const ok = await uploadTracksForDraftStep({
          onTrackProgress: (index, pct) => {
            setActiveUploadIndex(index);
            setTrackUploadProgress((prev) => ({ ...prev, [index]: pct }));
          }
        });
        if (!ok) {
          const msg =
            useCreateReleaseDraftStore.getState().submitError ?? "Не удалось загрузить WAV.";
          if (msg) toast.error(msg);
          return;
        }
        router.push("/create/review");
      } catch (unexpected) {
        console.error("[create/tracks handleNext]", unexpected);
        toast.error("Произошла ошибка. Попробуйте ещё раз.");
      } finally {
        releaseTelegramClosingConfirmation();
        setIsUploadingWav(false);
        setActiveUploadIndex(null);
        setTrackUploadProgress({});
      }
    },
    [router, setSubmitError, setTracks, syncTrackFilesLength]
  );

  const addFeaturingSlot = useCallback(
    (trackIndex: number) => {
      const cur = getValues(`tracks.${trackIndex}.featuringArtistNames`) ?? [];
      if (cur.length >= MAX_FEATURING_ARTISTS) return;
      triggerHaptic("light");
      setValue(`tracks.${trackIndex}.featuringArtistNames`, [...cur, ""], {
        shouldDirty: true,
        shouldValidate: true
      });
    },
    [getValues, setValue]
  );

  const setFeaturingAt = useCallback(
    (trackIndex: number, featIndex: number, value: string) => {
      const cur = [...(getValues(`tracks.${trackIndex}.featuringArtistNames`) ?? [])];
      cur[featIndex] = value;
      setValue(`tracks.${trackIndex}.featuringArtistNames`, cur, {
        shouldDirty: true,
        shouldValidate: true
      });
    },
    [getValues, setValue]
  );

  const removeFeaturingAt = useCallback(
    (trackIndex: number, featIndex: number) => {
      triggerHaptic("light");
      const cur = [...(getValues(`tracks.${trackIndex}.featuringArtistNames`) ?? [])];
      setValue(
        `tracks.${trackIndex}.featuringArtistNames`,
        cur.filter((_, i) => i !== featIndex),
        { shouldDirty: true, shouldValidate: true }
      );
    },
    [getValues, setValue]
  );

  return (
    <CreateShell title="Треки">
      {!guard.allowed ? (
        <StepGate
          title={guard.title}
          description={guard.description}
          actionLabel={guard.actionLabel}
          onAction={() => router.push(`/create/${guard.redirectTo}`)}
        />
      ) : (
        <form
          id="create-tracks-form"
          onSubmit={handleSubmit(handleNext, () => triggerHaptic("error"))}
          className="space-y-6"
        >
          {showResumeAudioBanner && (
            <div className="rounded-control border border-omf-line-strong bg-omf-surface px-4 py-3.5 text-[14px] leading-relaxed text-omf-graphite">
              <span className="font-bold text-omf-ink">Выбери WAV-файлы заново.</span> Мы сохранили
              их в черновике, но после возврата из списка релизов приложение не видит файлы на
              телефоне. Без этого отправить релиз на проверку не получится.
            </div>
          )}

          {fields.map((field, index) => (
            <motion.div
              key={field.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-5 border-t border-omf-line pt-6 first:border-t-0 first:pt-0"
            >
              {!isSingle ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedTracks((prev) => {
                        const next = [...prev];
                        while (next.length < fields.length) next.push(false);
                        next[index] = !next[index];
                        return next;
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="shrink-0 text-[16px] font-bold tracking-tight text-omf-ink">
                      Трек {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-omf-graphite">
                      {(values.tracks[index]?.title ?? "").trim() || "Без названия"}
                    </span>
                    {expandedTracks[index] ? (
                      <ChevronUp className="h-4 w-4 text-omf-graphite" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-omf-graphite" />
                    )}
                  </button>
                  {canAddTrack && fields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic("light");
                        remove(index);
                        syncTrackFilesLength(fields.length - 1);
                        setExpandedTracks((prev) => {
                          const next = prev.filter((_, i) => i !== index);
                          if (next.length > 0 && !next.some(Boolean)) next[0] = true;
                          return next;
                        });
                      }}
                      className="omf-focus shrink-0 rounded-control px-2 py-1.5 text-[13px] text-omf-graphite transition-colors hover:text-omf-red"
                      aria-label={`Удалить трек ${index + 1}`}
                    >
                      Удалить
                    </button>
                  )}
                </div>
              ) : isSingle ? null : (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[16px] font-bold tracking-tight text-omf-ink">
                    Трек {index + 1}
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className={`mb-2 block ${WIZARD_FIELD_LABEL_CLASS}`}>WAV-файл</label>
                {!isSingle && !expandedTracks[index] ? (
                  <div className="rounded-control border border-omf-line bg-omf-surface px-4 py-3 text-[14px] text-omf-graphite">
                    {storeTrackFiles[index] || trackFilesMeta[index]
                      ? "WAV выбран"
                      : "WAV не выбран"}
                  </div>
                ) : trackFilesMeta[index] && !storeTrackFiles[index] ? (
                  <div className="flex items-center gap-3 rounded-control border border-omf-line bg-omf-surface px-4 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-omf-green">
                      <CheckCircle2 className="h-4 w-4 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] text-omf-ink">
                        {trackFilesMeta[index].name}
                      </p>
                      <p className="text-[13px] text-omf-graphite">
                        {(trackFilesMeta[index].size / 1024 / 1024).toFixed(1)} МБ, загружен раньше
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => clearTrackFile(index)}
                      aria-label="Убрать файл"
                      className="omf-focus rounded-full p-1.5 text-omf-graphite transition-colors hover:text-omf-ink"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <FileUploader
                      label=""
                      accept=".wav,audio/wav,audio/x-wav,audio/wave,audio/vnd.wave"
                      maxSizeMb={MAX_WAV_MB}
                      type="wav"
                      initialFile={storeTrackFiles[index] ?? null}
                      onFileChange={(file) => {
                        setTrackFile(index, file);
                        setTrackAudioUrlAt(index, null);
                        if (!file) {
                          setTrackUploadProgress((prev) => {
                            const next = { ...prev };
                            delete next[index];
                            return next;
                          });
                          return;
                        }
                        void (async () => {
                          const validation = await validateWavFile(file);
                          if (!validation.ok) {
                            clearTrackFile(index);
                            setSubmitError(validation.reason);
                            toast.error(validation.reason);
                            return;
                          }
                          setTrackUploadProgress((prev) => ({ ...prev, [index]: 0 }));
                          const ok = await uploadTrackWavAtIndex({
                            index,
                            file,
                            onProgress: (pct) => {
                              setTrackUploadProgress((prev) => ({ ...prev, [index]: pct }));
                            }
                          });
                          if (ok) {
                            setTrackUploadProgress((prev) => ({ ...prev, [index]: 100 }));
                            window.setTimeout(() => {
                              setTrackUploadProgress((prev) => {
                                const next = { ...prev };
                                delete next[index];
                                return next;
                              });
                            }, 420);
                          } else {
                            setTrackUploadProgress((prev) => {
                              const next = { ...prev };
                              delete next[index];
                              return next;
                            });
                          }
                          if (!ok) {
                            const msg = useCreateReleaseDraftStore.getState().submitError;
                            if (msg) toast.error(msg);
                          }
                        })();
                      }}
                      invalid={submitAttempted && !storeTrackFiles[index]}
                      uploadProgressPercent={
                        typeof trackUploadProgress[index] === "number"
                          ? trackUploadProgress[index]!
                          : isUploadingWav && activeUploadIndex === index
                            ? (trackUploadProgress[index] ?? 0)
                            : null
                      }
                    />
                    <FormFieldError
                      message={
                        submitAttempted && !storeTrackFiles[index]
                          ? "Загрузите WAV-файл для этого трека."
                          : undefined
                      }
                    />
                  </>
                )}
              </div>

              {(isSingle || expandedTracks[index]) && (
                <>
                  {isSingle && index === 0 ? (
                    <div className="space-y-1.5">
                      <label className={`mb-2.5 block ${WIZARD_FIELD_LABEL_CLASS}`}>Название трека</label>
                      <input
                        {...register(`tracks.${index}.title` as const, {
                          onChange: (e) => {
                            const v = e.target.value;
                            singleTrackTitleTouchedRef.current = v.trim().length > 0;
                          }
                        })}
                        placeholder={releaseTitle.trim() || "Название трека"}
                        className={`${WIZARD_INPUT_CLASS} ${
                          errors.tracks?.[index]?.title && dirtyFields.tracks?.[index]?.title
                            ? GLASS_FIELD_ERROR_STRONG
                            : ""
                        }`}
                      />
                      <FormFieldError message={errors.tracks?.[index]?.title?.message} />
                      <p className="text-[12px] leading-snug text-omf-faint">Обычно совпадает с названием релиза</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className={`mb-2.5 block ${WIZARD_FIELD_LABEL_CLASS}`}>
                        Название трека
                      </label>
                      <input
                        {...register(`tracks.${index}.title` as const)}
                        placeholder="Название трека"
                        className={`${WIZARD_INPUT_CLASS} ${
                          errors.tracks?.[index]?.title && dirtyFields.tracks?.[index]?.title
                            ? GLASS_FIELD_ERROR_STRONG
                            : ""
                        }`}
                      />
                      <FormFieldError message={errors.tracks?.[index]?.title?.message} />
                    </div>
                  )}

                  {isSingle ? (
                    <div className="space-y-3 border-t border-omf-line pt-4">
                      <button
                        type="button"
                        onClick={() => setShowFeat((v) => !v)}
                        className="flex w-full items-center justify-between text-left"
                      >
                        <label className="mb-0 block cursor-pointer text-[15px] text-omf-ink">
                          Дополнительные артисты
                        </label>
                        {showFeat ? (
                          <ChevronUp className="h-4 w-4 text-omf-graphite" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-omf-graphite" />
                        )}
                      </button>
                      {showFeat && (
                        <>
                          <p className="text-[13px] leading-relaxed text-omf-graphite">
                            Если на треке есть фит или другой участник, кроме основного артиста, добавь
                            его имя. Имена со всех треков попадут в данные релиза.
                          </p>
                          <ul className="space-y-2">
                            {(values.tracks[index]?.featuringArtistNames ?? []).map((name, featIdx) => (
                              <li key={`${field.id}-feat-${featIdx}`} className="flex items-center gap-2">
                                <input
                                  value={name}
                                  onChange={(e) => setFeaturingAt(index, featIdx, e.target.value)}
                                  placeholder="Имя артиста"
                                  autoComplete="off"
                                  className={`${WIZARD_INPUT_CLASS} min-w-0 flex-1`}
                                />
                                <button
                                  type="button"
                                  onClick={() => removeFeaturingAt(index, featIdx)}
                                  className="omf-focus shrink-0 rounded-control px-3 py-3 text-[13px] text-omf-graphite transition-colors hover:text-omf-ink"
                                >
                                  Убрать
                                </button>
                              </li>
                            ))}
                          </ul>
                          {(values.tracks[index]?.featuringArtistNames ?? []).length <
                          MAX_FEATURING_ARTISTS ? (
                            <button
                              type="button"
                              onClick={() => addFeaturingSlot(index)}
                              className="omf-btn-secondary min-h-[44px] w-full text-[14px]"
                            >
                              <UserPlus className="h-4 w-4 shrink-0 opacity-90" />
                              Добавить артиста
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3 border-t border-omf-line pt-4">
                      <div>
                        <label className="mb-2 block text-[15px] text-omf-ink">
                          Дополнительные артисты
                        </label>
                        <p className="text-[13px] leading-relaxed text-omf-graphite">
                          Если на треке есть фит или другой участник, кроме основного артиста, добавь
                          его имя. Имена со всех треков попадут в данные релиза.
                        </p>
                      </div>
                      <ul className="space-y-2">
                        {(values.tracks[index]?.featuringArtistNames ?? []).map((name, featIdx) => (
                          <li key={`${field.id}-feat-${featIdx}`} className="flex items-center gap-2">
                            <input
                              value={name}
                              onChange={(e) => setFeaturingAt(index, featIdx, e.target.value)}
                              placeholder="Имя артиста"
                              autoComplete="off"
                              className={`${WIZARD_INPUT_CLASS} min-w-0 flex-1`}
                            />
                            <button
                              type="button"
                              onClick={() => removeFeaturingAt(index, featIdx)}
                              className="omf-focus shrink-0 rounded-control px-3 py-3 text-[13px] text-omf-graphite transition-colors hover:text-omf-ink"
                            >
                              Убрать
                            </button>
                          </li>
                        ))}
                      </ul>
                      {(values.tracks[index]?.featuringArtistNames ?? []).length <
                      MAX_FEATURING_ARTISTS ? (
                        <button
                          type="button"
                          onClick={() => addFeaturingSlot(index)}
                          className="omf-btn-secondary min-h-[44px] w-full text-[14px]"
                        >
                          <UserPlus className="h-4 w-4 shrink-0 opacity-90" />
                          Добавить артиста
                        </button>
                      ) : null}
                    </div>
                  )}

                  {isSingle ? (
                    <div className="space-y-3 border-t border-omf-line pt-4">
                      <button
                        type="button"
                        onClick={() => setShowLyrics((v) => !v)}
                        className="flex w-full items-center justify-between text-left"
                      >
                        <label
                          htmlFor={`track-${field.id}-lyrics`}
                          className="mb-0 block cursor-pointer text-[15px] text-omf-ink"
                        >
                          Текст песни
                        </label>
                        {showLyrics ? (
                          <ChevronUp className="h-4 w-4 text-omf-graphite" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-omf-graphite" />
                        )}
                      </button>
                      {showLyrics && (
                        <>
                          <textarea
                            id={`track-${field.id}-lyrics`}
                            {...register(`tracks.${index}.lyrics` as const)}
                            rows={5}
                            placeholder="Необязательно"
                            className={`${WIZARD_INPUT_CLASS} min-h-[120px] resize-y py-3`}
                          />
                          <FormFieldError message={errors.tracks?.[index]?.lyrics?.message} />
                          <LyricsContentNote />
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label
                        htmlFor={`track-${field.id}-lyrics`}
                        className={`mb-2.5 block ${WIZARD_FIELD_LABEL_CLASS}`}
                      >
                        Текст песни
                      </label>
                      <textarea
                        id={`track-${field.id}-lyrics`}
                        {...register(`tracks.${index}.lyrics` as const)}
                        rows={5}
                        placeholder="Необязательно"
                        className={`${WIZARD_INPUT_CLASS} min-h-[120px] resize-y py-3`}
                      />
                      <FormFieldError message={errors.tracks?.[index]?.lyrics?.message} />
                      <LyricsContentNote />
                    </div>
                  )}
                </>
              )}
            </motion.div>
          ))}

          {canAddTrack && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                append({ title: "", explicit: false, lyrics: "", featuringArtistNames: [] });
                setExpandedTracks((prev) => [...prev, true]);
                syncTrackFilesLength(fields.length + 1);
              }}
              className="omf-btn-secondary w-full"
            >
              Добавить трек
            </button>
          )}

          <FormFieldError message={submitError ?? undefined} messageClassName="text-center" />

          <WizardActionBar>
            <button
              type="submit"
              form="create-tracks-form"
              disabled={!isValid || isSubmitting || isUploadingWav || isWavTransferActive}
              className="create-flow-submit-target omf-btn-primary h-[52px] w-full text-[16px] font-medium"
            >
              <BusyLabel
                busy={isUploadingWav || isWavTransferActive || isSubmitting}
                busyText={isUploadingWav || isWavTransferActive ? "Загружаем WAV…" : "Сохраняем…"}
              >
                Дальше: проверка
              </BusyLabel>
            </button>
          </WizardActionBar>
        </form>
      )}
    </CreateShell>
  );
}

/** Напоминание под текстом песни: площадки в России снимают треки с упоминанием наркотиков. */
function LyricsContentNote() {
  return (
    <p className="mt-2 flex items-start gap-2 text-[13px] leading-snug text-omf-graphite">
      <AlertCircle className="mt-[2px] h-[15px] w-[15px] shrink-0 text-omf-yellow" aria-hidden />
      Без упоминаний наркотиков: в России площадки снимают такие треки. Если они есть, запикай их в WAV и убери из
      текста.
    </p>
  );
}
