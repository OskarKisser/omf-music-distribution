/**
 * Приведение WAV к глубине, которую принимают площадки (16–24 бит).
 * 16/24-бит PCM возвращаются без изменений, 32-бит float/int и 64-бит float — как 24-бит PCM.
 * Чистый TS: на Vercel нет ffmpeg.
 */

const FORMAT_PCM = 1;
const FORMAT_IEEE_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

const INT24_MAX = 8_388_607;
const INT24_MIN = -8_388_608;

/** Чанки, описывающие float-данные: после конвертации они неверны. */
const DROPPED_CHUNKS = new Set(["fact", "PEAK"]);

type Chunk = { id: string; offset: number; size: number };

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function readChunks(view: DataView): Chunk[] | null {
  if (view.byteLength < 12) return null;
  if (readFourCC(view, 0) !== "RIFF" || readFourCC(view, 8) !== "WAVE") return null;

  const chunks: Chunk[] = [];
  let pos = 12;
  while (pos + 8 <= view.byteLength) {
    const offset = pos + 8;
    // Потоковые рекордеры пишут в размер 0xFFFFFFFF, поэтому ограничиваем концом файла.
    const size = Math.min(view.getUint32(pos + 4, true), view.byteLength - offset);
    chunks.push({ id: readFourCC(view, pos), offset, size });
    pos = offset + size + (size % 2);
  }
  return chunks;
}

/**
 * Возвращает исходный буфер, если конвертация не нужна или это не распознанный WAV.
 */
export function ensureWavBitDepthForDelivery(input: ArrayBuffer): ArrayBuffer {
  const view = new DataView(input);
  const chunks = readChunks(view);
  if (!chunks) return input;

  const fmt = chunks.find((c) => c.id === "fmt ");
  const data = chunks.find((c) => c.id === "data");
  if (!fmt || !data || fmt.size < 16) return input;

  const formatTag = view.getUint16(fmt.offset, true);
  const channels = view.getUint16(fmt.offset + 2, true);
  const sampleRate = view.getUint32(fmt.offset + 4, true);
  const bits = view.getUint16(fmt.offset + 14, true);
  const codec =
    formatTag === FORMAT_EXTENSIBLE && fmt.size >= 40
      ? view.getUint32(fmt.offset + 24, true)
      : formatTag;

  const isFloat32 = codec === FORMAT_IEEE_FLOAT && bits === 32;
  const isFloat64 = codec === FORMAT_IEEE_FLOAT && bits === 64;
  const isPcm32 = codec === FORMAT_PCM && bits === 32;
  if (channels < 1 || (!isFloat32 && !isFloat64 && !isPcm32)) return input;

  const sourceBytes = bits / 8;
  const sampleCount = Math.floor(data.size / sourceBytes);
  const dataSize = sampleCount * 3;
  const kept = chunks.filter((c) => !DROPPED_CHUNKS.has(c.id));

  const chunkTotal = (size: number) => 8 + size + (size % 2);
  const outputSize = kept.reduce((total, c) => {
    if (c.id === "fmt ") return total + chunkTotal(16);
    if (c === data) return total + chunkTotal(dataSize);
    return total + chunkTotal(c.size);
  }, 12);

  const outputBytes = new Uint8Array(outputSize);
  const sourceView = new Uint8Array(input);
  const out = new DataView(outputBytes.buffer);

  const writeFourCC = (offset: number, id: string) => {
    for (let i = 0; i < 4; i += 1) out.setUint8(offset + i, id.charCodeAt(i));
  };

  writeFourCC(0, "RIFF");
  out.setUint32(4, outputSize - 8, true);
  writeFourCC(8, "WAVE");

  let pos = 12;
  for (const chunk of kept) {
    writeFourCC(pos, chunk.id);

    if (chunk.id === "fmt ") {
      out.setUint32(pos + 4, 16, true);
      out.setUint16(pos + 8, FORMAT_PCM, true);
      out.setUint16(pos + 10, channels, true);
      out.setUint32(pos + 12, sampleRate, true);
      out.setUint32(pos + 16, sampleRate * channels * 3, true);
      out.setUint16(pos + 20, channels * 3, true);
      out.setUint16(pos + 22, 24, true);
      pos += chunkTotal(16);
      continue;
    }

    if (chunk === data) {
      out.setUint32(pos + 4, dataSize, true);
      let dst = pos + 8;
      for (let i = 0; i < sampleCount; i += 1) {
        const src = data.offset + i * sourceBytes;
        let sample: number;
        if (isPcm32) {
          sample = view.getInt32(src, true) >> 8;
        } else {
          const value = isFloat32 ? view.getFloat32(src, true) : view.getFloat64(src, true);
          sample = Math.round(value * 8_388_608);
          if (sample > INT24_MAX) sample = INT24_MAX;
          else if (sample < INT24_MIN) sample = INT24_MIN;
        }
        // NaN в битовых операциях становится нулём, то есть тишиной.
        out.setUint8(dst, sample & 0xff);
        out.setUint8(dst + 1, (sample >> 8) & 0xff);
        out.setUint8(dst + 2, (sample >> 16) & 0xff);
        dst += 3;
      }
      pos += chunkTotal(dataSize);
      continue;
    }

    out.setUint32(pos + 4, chunk.size, true);
    outputBytes.set(sourceView.subarray(chunk.offset, chunk.offset + chunk.size), pos + 8);
    pos += chunkTotal(chunk.size);
  }

  return outputBytes.buffer;
}
