const VERSION_SOURCES = new Set(["owner", "shared", "restore"]);

function cleanDisplayName(value) {
  const name = String(value || "")
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return name || "Người dùng";
}

function normalizeVersionActor({ actorUserId, actorName, source } = {}) {
  const parsedUserId = Number.parseInt(String(actorUserId || ""), 10);
  return {
    actorUserId:
      Number.isInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : null,
    actorName: cleanDisplayName(actorName),
    source: VERSION_SOURCES.has(source) ? source : "owner",
  };
}

async function insertTranscriptVersion(
  client,
  transcript,
  {
    label = "Auto-save",
    actorUserId = null,
    actorName = "Người dùng",
    source = "owner",
    maxVersions = 50,
  } = {},
) {
  const actor = normalizeVersionActor({ actorUserId, actorName, source });
  const retentionLimit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(maxVersions), 10) || 50),
  );
  await client.query(
    `INSERT INTO transcription_versions (
       transcription_id, user_id, text, words, speaker_names, label,
       actor_user_id, actor_name, change_source
     ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)`,
    [
      transcript.id,
      transcript.user_id,
      String(transcript.text || ""),
      JSON.stringify(Array.isArray(transcript.words) ? transcript.words : []),
      JSON.stringify(
        transcript.speaker_names &&
          typeof transcript.speaker_names === "object" &&
          !Array.isArray(transcript.speaker_names)
          ? transcript.speaker_names
          : {},
      ),
      String(label || "Auto-save").trim().slice(0, 120) || "Auto-save",
      actor.actorUserId,
      actor.actorName,
      actor.source,
    ],
  );
  await client.query(
    `DELETE FROM transcription_versions
     WHERE id IN (
       SELECT id
       FROM transcription_versions
       WHERE transcription_id = $1
       ORDER BY created_at DESC, id DESC
       OFFSET $2
     )`,
    [transcript.id, retentionLimit],
  );
}

module.exports = {
  insertTranscriptVersion,
  normalizeVersionActor,
};
