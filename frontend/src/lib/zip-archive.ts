export interface ZipTextEntry {
  name: string;
  content: string;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) !== 0
      ? 0xedb88320 ^ (current >>> 1)
      : current >>> 1;
  }
  return current >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeFilename(value: string, fallback: string) {
  const leaf = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.split("")
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"|?*'.includes(character)
        ? "-"
        : character,
    )
    .join("")
    .trim();
  return (leaf || fallback).slice(0, 180);
}

function makeUniqueName(name: string, used: Set<string>) {
  if (!used.has(name.toLocaleLowerCase("vi-VN"))) {
    used.add(name.toLocaleLowerCase("vi-VN"));
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    const key = candidate.toLocaleLowerCase("vi-VN");
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
  }
  return `${Date.now()}-${name}`;
}

function concatBytes(chunks: Uint8Array[]) {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function createStoredZip(entries: ZipTextEntry[]) {
  if (!entries.length || entries.length > 1_000) {
    throw new Error("Danh sách file ZIP không hợp lệ");
  }
  const encoder = new TextEncoder();
  const usedNames = new Set<string>();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  entries.forEach((entry, index) => {
    const name = makeUniqueName(
      safeFilename(entry.name, `transcript-${index + 1}.txt`),
      usedNames,
    );
    const nameBytes = encoder.encode(name);
    const contentBytes = encoder.encode(String(entry.content || ""));
    const checksum = crc32(contentBytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, contentBytes.length, true);
    localView.setUint32(22, contentBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    localChunks.push(local, contentBytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, contentBytes.length, true);
    centralView.setUint32(24, contentBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(nameBytes, 46);
    centralChunks.push(central);

    localOffset += local.length + contentBytes.length;
  });

  const centralDirectory = concatBytes(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);

  const archive = concatBytes([...localChunks, centralDirectory, end]);
  return new Blob([archive.buffer], { type: "application/zip" });
}
