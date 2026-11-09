import { describe, expect, it } from "vitest";
import {
  buildTrackAudioFilename,
  claimUniqueFilename,
  sanitizeTrackFilename
} from "@/lib/track-filename";
import { ensureWavBitDepthForDelivery } from "@/lib/wav-bit-depth";

type Extra = { id: string; bytes: number[] };

function buildWav(args: {
  tag: number;
  bits: number;
  channels?: number;
  samples: number[];
  before?: Extra[];
  after?: Extra[];
}): ArrayBuffer {
  const channels = args.channels ?? 1;
  const bytesPerSample = args.bits / 8;
  const dataSize = args.samples.length * bytesPerSample;
  const size = (c: Extra) => 8 + c.bytes.length + (c.bytes.length % 2);
  const extras = [...(args.before ?? []), ...(args.after ?? [])].reduce((t, c) => t + size(c), 0);
  const total = 12 + 24 + 8 + dataSize + extras;
  const view = new DataView(new ArrayBuffer(total));
  const cc = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  const writeExtras = (list: Extra[] | undefined, start: number) => {
    let pos = start;
    for (const c of list ?? []) {
      cc(pos, c.id);
      view.setUint32(pos + 4, c.bytes.length, true);
      c.bytes.forEach((b, i) => view.setUint8(pos + 8 + i, b));
      pos += size(c);
    }
    return pos;
  };

  cc(0, "RIFF");
  view.setUint32(4, total - 8, true);
  cc(8, "WAVE");
  let pos = writeExtras(args.before, 12);
  cc(pos, "fmt ");
  view.setUint32(pos + 4, 16, true);
  view.setUint16(pos + 8, args.tag, true);
  view.setUint16(pos + 10, channels, true);
  view.setUint32(pos + 12, 48000, true);
  view.setUint32(pos + 16, 48000 * channels * bytesPerSample, true);
  view.setUint16(pos + 20, channels * bytesPerSample, true);
  view.setUint16(pos + 22, args.bits, true);
  pos += 24;
  cc(pos, "data");
  view.setUint32(pos + 4, dataSize, true);
  args.samples.forEach((s, i) => {
    const o = pos + 8 + i * bytesPerSample;
    if (args.tag === 3 && args.bits === 32) view.setFloat32(o, s, true);
    else if (args.tag === 3) view.setFloat64(o, s, true);
    else if (args.bits === 32) view.setInt32(o, s, true);
    else if (args.bits === 16) view.setInt16(o, s, true);
  });
  writeExtras(args.after, pos + 8 + dataSize);
  return view.buffer;
}

function readWav(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const ids: string[] = [];
  let fmtAt = -1;
  let dataAt = -1;
  let dataSize = 0;
  let pos = 12;
  while (pos + 8 <= view.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(buffer, pos, 4));
    const size = view.getUint32(pos + 4, true);
    ids.push(id);
    if (id === "fmt ") fmtAt = pos + 8;
    if (id === "data") {
      dataAt = pos + 8;
      dataSize = size;
    }
    pos += 8 + size + (size % 2);
  }
  const sampleAt = (i: number) => {
    const o = dataAt + i * 3;
    return (view.getInt8(o + 2) << 16) | (view.getUint8(o + 1) << 8) | view.getUint8(o);
  };
  return {
    ids,
    riffSize: view.getUint32(4, true),
    tag: view.getUint16(fmtAt, true),
    channels: view.getUint16(fmtAt + 2, true),
    sampleRate: view.getUint32(fmtAt + 4, true),
    byteRate: view.getUint32(fmtAt + 8, true),
    blockAlign: view.getUint16(fmtAt + 12, true),
    bits: view.getUint16(fmtAt + 14, true),
    dataSize,
    sampleAt
  };
}

describe("ensureWavBitDepthForDelivery", () => {
  it("конвертирует 32-bit float в 24-bit PCM и обрезает клиппинг", () => {
    const out = readWav(
      ensureWavBitDepthForDelivery(
        buildWav({ tag: 3, bits: 32, samples: [0, 0.5, -0.5, -1, 1.5, -1.5, NaN] })
      )
    );
    expect(out.tag).toBe(1);
    expect(out.bits).toBe(24);
    expect(out.sampleRate).toBe(48000);
    expect(out.byteRate).toBe(48000 * 3);
    expect(out.blockAlign).toBe(3);
    expect(out.dataSize).toBe(21);
    expect([0, 1, 2, 3, 4, 5, 6].map(out.sampleAt)).toEqual([
      0, 4194304, -4194304, -8388608, 8388607, -8388608, 0
    ]);
  });

  it("конвертирует 64-bit float и 32-bit PCM", () => {
    const float64 = readWav(ensureWavBitDepthForDelivery(buildWav({ tag: 3, bits: 64, samples: [0.25] })));
    expect(float64.bits).toBe(24);
    expect(float64.sampleAt(0)).toBe(2097152);

    const pcm32 = readWav(
      ensureWavBitDepthForDelivery(buildWav({ tag: 1, bits: 32, samples: [0x7fffff00, -256] }))
    );
    expect(pcm32.bits).toBe(24);
    expect([pcm32.sampleAt(0), pcm32.sampleAt(1)]).toEqual([8388607, -1]);
  });

  it("не трогает 16-bit PCM и не-WAV", () => {
    const pcm16 = buildWav({ tag: 1, bits: 16, samples: [1, 2] });
    expect(ensureWavBitDepthForDelivery(pcm16)).toBe(pcm16);
    const notWav = new TextEncoder().encode("definitely not a wav").buffer as ArrayBuffer;
    expect(ensureWavBitDepthForDelivery(notWav)).toBe(notWav);
  });

  it("сохраняет посторонние чанки, убирает float-чанки, держит корректный RIFF", () => {
    const result = ensureWavBitDepthForDelivery(
      buildWav({
        tag: 3,
        bits: 32,
        channels: 2,
        samples: [0.1, 0.2, 0.3],
        before: [{ id: "JUNK", bytes: [1, 2, 3] }, { id: "fact", bytes: [1, 0, 0, 0] }],
        after: [{ id: "LIST", bytes: [9, 9] }, { id: "PEAK", bytes: [1, 2] }]
      })
    );
    const out = readWav(result);
    expect(out.ids).toEqual(["JUNK", "fmt ", "data", "LIST"]);
    expect(out.riffSize).toBe(result.byteLength - 8);
    expect(out.blockAlign).toBe(6);
  });

  it("считает реальный хвост, если в размере data записано 0xFFFFFFFF", () => {
    const wav = buildWav({ tag: 3, bits: 32, samples: [0.5, 0.5] });
    new DataView(wav).setUint32(40, 0xffffffff, true);
    expect(readWav(ensureWavBitDepthForDelivery(wav)).dataSize).toBe(6);
  });
});

describe("track filename", () => {
  it("сохраняет кириллицу и пробелы", () => {
    expect(sanitizeTrackFilename("Мой трек (мастер).WAV")).toBe("Мой трек (мастер).WAV");
  });

  it("приводит macOS-имена к NFC", () => {
    expect(sanitizeTrackFilename("Мои\u0306.wav")).toBe("Мой.wav");
  });

  it("вычищает пути, управляющие символы и кавычки", () => {
    expect(sanitizeTrackFilename("../../etc/evil.wav")).toBe("evil.wav");
    expect(sanitizeTrackFilename("C:\\Music\\a.wav")).toBe("a.wav");
    expect(sanitizeTrackFilename('a"\r\nb.wav')).toBe("a___b.wav");
    expect(sanitizeTrackFilename("...")).toBeNull();
    expect(sanitizeTrackFilename(null)).toBeNull();
  });

  it("при обрезке длинного имени оставляет расширение", () => {
    const name = sanitizeTrackFilename(`${"я".repeat(400)}.wav`)!;
    expect(Array.from(name)).toHaveLength(180);
    expect(name.endsWith(".wav")).toBe(true);
  });

  it("выбирает имя: клиентское → название → fallback", () => {
    expect(buildTrackAudioFilename({ originalFilename: "mix.wav", title: "Song", fallback: "0.wav" })).toBe("mix.wav");
    expect(buildTrackAudioFilename({ originalFilename: null, title: "Song", fallback: "0.wav" })).toBe("Song.wav");
    expect(buildTrackAudioFilename({ originalFilename: null, title: "", fallback: "0.wav" })).toBe("0.wav");
  });

  it("разводит одинаковые имена без учёта регистра", () => {
    const used = new Set<string>();
    expect(claimUniqueFilename("Master.wav", used)).toBe("Master.wav");
    expect(claimUniqueFilename("master.WAV", used)).toBe("master (2).WAV");
    expect(claimUniqueFilename("master.wav", used)).toBe("master (3).wav");
  });
});
