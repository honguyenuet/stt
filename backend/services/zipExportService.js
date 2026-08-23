const path = require("path");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = Math.max(1980, safeDate.getFullYear());
  const dosTime =
    (safeDate.getHours() << 11) |
    (safeDate.getMinutes() << 5) |
    Math.floor(safeDate.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((safeDate.getMonth() + 1) << 5) |
    safeDate.getDate();
  return { dosDate, dosTime };
}

function sanitizeZipName(value, fallback = "file") {
  const clean = String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return clean || fallback;
}

function uniqueZipPath(name, usedNames) {
  const parsed = path.posix.parse(name.replace(/\\/g, "/"));
  let candidate = `${parsed.dir ? `${parsed.dir}/` : ""}${parsed.name}${parsed.ext}`;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${parsed.dir ? `${parsed.dir}/` : ""}${parsed.name}-${counter}${parsed.ext}`;
    counter += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  const usedNames = new Set();
  let offset = 0;

  for (const entry of entries) {
    const body = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(String(entry.data || ""), "utf8");
    const filename = uniqueZipPath(
      sanitizeZipName(entry.name, "export.txt"),
      usedNames,
    );
    const nameBuffer = Buffer.from(filename, "utf8");
    const checksum = crc32(body);
    const { dosDate, dosTime } = dosDateTime(
      entry.date ? new Date(entry.date) : new Date(),
    );

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(body.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, body);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(body.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + body.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

module.exports = {
  createZipBuffer,
  sanitizeZipName,
};
