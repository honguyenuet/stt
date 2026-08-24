const pool = require("../db");

const ACCESS_MODES = new Set(["view", "edit"]);

function normalizeAccessMode(value) {
  return ACCESS_MODES.has(value) ? value : "view";
}

function createTranscriptAccessError() {
  const error = new Error("Không tìm thấy transcript");
  error.statusCode = 404;
  return error;
}

function getTranscriptAccessCondition({
  transcriptAlias = "transcript",
  userParameter = "$1",
  mode = "view",
} = {}) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(transcriptAlias)) {
    throw new TypeError("Transcript alias không hợp lệ");
  }
  if (!/^\$\d+$/.test(userParameter)) {
    throw new TypeError("User parameter không hợp lệ");
  }
  const normalizedMode = normalizeAccessMode(mode);
  const editClause =
    normalizedMode === "edit" ? "AND folder.team_permission = 'edit'" : "";
  return `(
    ${transcriptAlias}.user_id = ${userParameter}
    OR EXISTS (
      SELECT 1
      FROM transcription_folders folder
      JOIN workspace_members owner_member
        ON owner_member.user_id = folder.user_id
       AND owner_member.status = 'active'
      JOIN workspace_members requester
        ON requester.workspace_id = owner_member.workspace_id
       AND requester.status = 'active'
      WHERE folder.id = ${transcriptAlias}.folder_id
        AND folder.visibility = 'team'
        ${editClause}
        AND requester.user_id = ${userParameter}
    )
  )`;
}

async function requireTranscriptAccess(
  userId,
  transcriptId,
  { db = pool, mode = "view", lock = false } = {},
) {
  const normalizedMode = normalizeAccessMode(mode);
  const condition = getTranscriptAccessCondition({
    transcriptAlias: "transcript",
    userParameter: "$2",
    mode: normalizedMode,
  });
  const { rows } = await db.query(
    `SELECT transcript.id,
            transcript.user_id AS owner_user_id,
            transcript.folder_id,
            folder.visibility,
            folder.team_permission,
            (transcript.user_id = $2 OR folder.team_permission = 'edit') AS can_edit
     FROM transcriptions transcript
     LEFT JOIN transcription_folders folder ON folder.id = transcript.folder_id
     WHERE transcript.id = $1 AND ${condition}
     LIMIT 1
     ${lock ? "FOR UPDATE OF transcript" : ""}`,
    [transcriptId, userId],
  );
  const row = rows[0];
  if (!row) throw createTranscriptAccessError();
  return {
    transcriptId: Number(row.id),
    ownerUserId: Number(row.owner_user_id),
    folderId: row.folder_id ? Number(row.folder_id) : null,
    visibility: row.visibility === "team" ? "team" : "private",
    teamPermission: row.team_permission === "view" ? "view" : "edit",
    canEdit: Boolean(row.can_edit),
  };
}

module.exports = {
  getTranscriptAccessCondition,
  normalizeAccessMode,
  requireTranscriptAccess,
};
