const pool = require("../db");

const DEFAULT_FOLDER_NAME = "Dự án mới";
const MAX_FOLDER_NAME_LENGTH = 160;

function createFolderError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeFolderName(value, { allowDefault = false } = {}) {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name && allowDefault) return DEFAULT_FOLDER_NAME;
  if (!name) throw createFolderError("Vui lòng nhập tên thư mục");
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw createFolderError("Tên thư mục chứa ký tự không hợp lệ");
  }
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    throw createFolderError(
      `Tên thư mục không được vượt quá ${MAX_FOLDER_NAME_LENGTH} ký tự`,
    );
  }
  return name;
}

function normalizeFolderRow(row) {
  return row
    ? {
        ...row,
        id: Number(row.id),
        item_count: Number(row.item_count || 0),
      }
    : null;
}

async function getOrCreateDefaultFolder(userId, { db = pool } = {}) {
  await db.query(
    `INSERT INTO transcription_folders (user_id, name)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, DEFAULT_FOLDER_NAME],
  );
  const { rows } = await db.query(
    `SELECT id, name, created_at, updated_at
     FROM transcription_folders
     WHERE user_id = $1 AND LOWER(name) = LOWER($2)
     ORDER BY id ASC
     LIMIT 1`,
    [userId, DEFAULT_FOLDER_NAME],
  );
  if (!rows[0]) {
    throw createFolderError("Không khởi tạo được thư mục mặc định", 500);
  }
  return normalizeFolderRow(rows[0]);
}

async function resolveUserFolder(userId, folderId, { db = pool } = {}) {
  if (folderId === null || folderId === undefined || folderId === "") {
    return getOrCreateDefaultFolder(userId, { db });
  }
  const id = Number.parseInt(folderId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw createFolderError("Thư mục không hợp lệ");
  }
  const { rows } = await db.query(
    `SELECT id, name, created_at, updated_at
     FROM transcription_folders
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [id, userId],
  );
  if (!rows[0]) throw createFolderError("Không tìm thấy thư mục", 404);
  return normalizeFolderRow(rows[0]);
}

async function createUserFolder(userId, rawName, { db = pool } = {}) {
  const name = normalizeFolderName(rawName);
  try {
    const { rows } = await db.query(
      `INSERT INTO transcription_folders (user_id, name)
       VALUES ($1, $2)
       RETURNING id, name, created_at, updated_at`,
      [userId, name],
    );
    return normalizeFolderRow(rows[0]);
  } catch (error) {
    if (error?.code === "23505") {
      throw createFolderError("Tên thư mục đã tồn tại", 409);
    }
    throw error;
  }
}

async function listUserFolders(userId, { db = pool } = {}) {
  await getOrCreateDefaultFolder(userId, { db });
  const { rows } = await db.query(
    `SELECT folder.id, folder.name, folder.created_at, folder.updated_at,
            COUNT(transcript.id)::integer AS item_count
     FROM transcription_folders folder
     LEFT JOIN transcriptions transcript ON transcript.folder_id = folder.id
     WHERE folder.user_id = $1
     GROUP BY folder.id
     ORDER BY CASE WHEN LOWER(folder.name) = LOWER($2) THEN 0 ELSE 1 END,
              folder.created_at ASC, folder.id ASC`,
    [userId, DEFAULT_FOLDER_NAME],
  );
  return rows.map(normalizeFolderRow);
}

module.exports = {
  DEFAULT_FOLDER_NAME,
  MAX_FOLDER_NAME_LENGTH,
  createUserFolder,
  getOrCreateDefaultFolder,
  listUserFolders,
  normalizeFolderName,
  resolveUserFolder,
};
