const crypto = require("crypto");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");
const ffmpegStaticPath = require("ffmpeg-static");
const pool = require("../db");
const {
  resolveStoredAudioPath,
} = require("./transcriptionService");
const { recordQuotaUsage } = require("./quotaService");

const execFileAsync = promisify(execFile);
const MULTITRACK_MAX_TRACKS = 5;
const MULTITRACK_MIX_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.MULTITRACK_MIX_TIMEOUT_MS || 20 * 60 * 1000),
);
const MULTITRACK_MERGE_LEASE_MS = MULTITRACK_MIX_TIMEOUT_MS + 5 * 60 * 1000;

function trackSpeakerKey(index) {
  return `track-${Number(index) + 1}`;
}

function normalizeTrackName(value, index) {
  const clean = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 100);
  return clean || `Người nói ${Number(index) + 1}`;
}

function isStaleMerge(batch, now = Date.now()) {
  if (batch?.status !== "merging") return false;
  const updatedAt = new Date(batch.updated_at || 0).getTime();
  return (
    !Number.isFinite(updatedAt) ||
    updatedAt <= 0 ||
    now - updatedAt > MULTITRACK_MERGE_LEASE_MS
  );
}

function mergeMultitrackTranscripts(tracks) {
  const normalizedTracks = tracks.map((track, index) => {
    const trackIndex = Number.isInteger(Number(track.trackIndex))
      ? Number(track.trackIndex)
      : index;
    const speaker = trackSpeakerKey(trackIndex);
    return {
      ...track,
      trackIndex,
      speaker,
      trackName: normalizeTrackName(track.trackName, trackIndex),
      words: (Array.isArray(track.words) ? track.words : [])
        .map((word) => {
          const start = Number(word?.start);
          const end = Number(word?.end);
          const text = String(word?.text || "").trim();
          if (!text || !Number.isFinite(start)) return null;
          return {
            ...word,
            text,
            start: Math.max(0, start),
            end: Number.isFinite(end) ? Math.max(start, end) : start,
            speaker,
            trackIndex,
          };
        })
        .filter(Boolean),
    };
  });

  const words = normalizedTracks
    .flatMap((track) => track.words)
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.trackIndex - right.trackIndex ||
        left.end - right.end,
    )
    .map(({ trackIndex: _trackIndex, ...word }) => word);
  const speakerNames = Object.fromEntries(
    normalizedTracks.map((track) => [track.speaker, track.trackName]),
  );

  const segments = [];
  let current = null;
  for (const word of words) {
    const shouldSplit =
      !current ||
      current.speaker !== word.speaker ||
      word.start - current.end > 1800 ||
      current.words.length >= 55;
    if (shouldSplit) {
      current = {
        speaker: word.speaker,
        start: word.start,
        end: word.end,
        words: [],
      };
      segments.push(current);
    }
    current.words.push(word);
    current.end = Math.max(current.end, word.end);
  }

  const text = segments
    .map(
      (segment) =>
        `${speakerNames[segment.speaker]}: ${segment.words
          .map((word) => word.text)
          .join(" ")
          .replace(/\s+([,.;:!?])/g, "$1")}`,
    )
    .join("\n\n");
  const languages = Array.from(
    new Set(
      normalizedTracks
        .map((track) => String(track.sourceLanguage || "").trim())
        .filter(Boolean),
    ),
  );

  return {
    text,
    words,
    segments,
    speakerNames,
    duration: Math.max(
      0,
      ...normalizedTracks.map((track) => Number(track.duration) || 0),
    ),
    processingSeconds: normalizedTracks.reduce(
      (total, track) => total + (Number(track.processingSeconds) || 0),
      0,
    ),
    sourceLanguage: languages.length === 1 ? languages[0] : "multi",
    providerAttempts: normalizedTracks.flatMap((track) =>
      (Array.isArray(track.providerAttempts) ? track.providerAttempts : []).map(
        (attempt) => ({
          ...attempt,
          track: track.trackName,
        }),
      ),
    ),
  };
}

async function mixAudioTracks(trackPaths, outputPath) {
  const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStaticPath || "ffmpeg";
  const inputArgs = trackPaths.flatMap((trackPath) => ["-i", trackPath]);
  const inputs = trackPaths.map((_, index) => `[${index}:a]`).join("");
  const filter = `${inputs}amix=inputs=${trackPaths.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`;
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      ...inputArgs,
      "-filter_complex",
      filter,
      "-map",
      "[aout]",
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath,
    ],
    {
      timeout: MULTITRACK_MIX_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}

async function getMultitrackBatchForUser(batchId, userId) {
  const { rows } = await pool.query(
    `SELECT batch.id, batch.name, batch.status, batch.expected_tracks,
            batch.output_transcription_id, batch.error_message,
            batch.created_at, batch.updated_at, batch.completed_at,
            COALESCE(AVG(job.progress), CASE WHEN batch.status = 'completed' THEN 100 ELSE 0 END)::float AS progress,
            COUNT(job.id)::integer AS track_count
     FROM transcription_batches batch
     LEFT JOIN transcription_jobs job
       ON job.payload->>'batchId' = batch.id::text
      AND job.payload->>'batchKind' = 'multitrack'
     WHERE batch.id = $1 AND batch.user_id = $2
     GROUP BY batch.id`,
    [batchId, userId],
  );
  return rows[0] || null;
}

async function finalizeMultitrackBatch(batchId) {
  const client = await pool.connect();
  let batch;
  let tracks;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [batchId]);
    const batchResult = await client.query(
      `SELECT * FROM transcription_batches WHERE id = $1 FOR UPDATE`,
      [batchId],
    );
    batch = batchResult.rows[0];
    if (
      !batch ||
      ["completed", "failed", "cancelled"].includes(batch.status) ||
      (batch.status === "merging" && !isStaleMerge(batch))
    ) {
      await client.query("COMMIT");
      return batch || null;
    }

    const children = await client.query(
      `SELECT transcript.id, transcript.folder_id, transcript.filename,
              transcript.file_size, transcript.duration, transcript.processing_seconds,
              transcript.words, transcript.source_language, transcript.audio_filename,
              transcript.provider_attempts, job.status,
              (job.payload->>'batchTrackIndex')::integer AS track_index,
              job.payload->>'batchTrackName' AS track_name
       FROM transcription_jobs job
       JOIN transcriptions transcript ON transcript.id = job.transcription_id
       WHERE job.payload->>'batchId' = $1
         AND job.payload->>'batchKind' = 'multitrack'
       ORDER BY (job.payload->>'batchTrackIndex')::integer ASC`,
      [batchId],
    );
    tracks = children.rows;
    const terminal = tracks.filter((track) =>
      ["completed", "failed", "cancelled"].includes(track.status),
    );
    const failed = tracks.find((track) =>
      ["failed", "cancelled"].includes(track.status),
    );

    if (failed && terminal.length === Number(batch.expected_tracks)) {
      await client.query(
        `UPDATE transcription_batches
         SET status = 'failed', error_message = $2, completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [batchId, "Một hoặc nhiều track không thể chuyển đổi."],
      );
      await client.query("COMMIT");
      return { ...batch, status: "failed" };
    }
    if (
      tracks.length !== Number(batch.expected_tracks) ||
      terminal.length !== Number(batch.expected_tracks)
    ) {
      await client.query(
        `UPDATE transcription_batches
         SET status = 'processing', updated_at = NOW()
         WHERE id = $1 AND status IN ('queued', 'processing')`,
        [batchId],
      );
      await client.query("COMMIT");
      return { ...batch, status: "processing" };
    }

    await client.query(
      `UPDATE transcription_batches
       SET status = 'merging', error_message = NULL, updated_at = NOW()
       WHERE id = $1`,
      [batchId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const outputFilename = `multitrack-${crypto.randomUUID()}.mp3`;
  const outputPath = resolveStoredAudioPath(outputFilename);
  try {
    const trackPaths = tracks.map((track) =>
      resolveStoredAudioPath(track.audio_filename),
    );
    await mixAudioTracks(trackPaths, outputPath);
    const merged = mergeMultitrackTranscripts(
      tracks.map((track) => ({
        trackIndex: track.track_index,
        trackName: track.track_name,
        words: track.words,
        duration: track.duration,
        processingSeconds: track.processing_seconds,
        sourceLanguage: track.source_language,
        providerAttempts: track.provider_attempts,
      })),
    );
    const outputStat = await fs.promises.stat(outputPath);
    const finalizeClient = await pool.connect();
    try {
      await finalizeClient.query("BEGIN");
      const inserted = await finalizeClient.query(
        `INSERT INTO transcriptions (
           user_id, folder_id, filename, file_size, duration, processing_seconds,
           text, words, segments, speaker_names, audio_filename, source_language,
           transcription_provider, provider_attempts, status, completed_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb,
                 $11, $12, 'multitrack', $13::jsonb, 'completed', NOW())
         RETURNING id`,
        [
          batch.user_id,
          tracks[0]?.folder_id || null,
          batch.name,
          outputStat.size,
          merged.duration,
          merged.processingSeconds,
          merged.text,
          JSON.stringify(merged.words),
          JSON.stringify(merged.segments),
          JSON.stringify(merged.speakerNames),
          outputFilename,
          merged.sourceLanguage,
          JSON.stringify(merged.providerAttempts),
        ],
      );
      const outputTranscriptionId = inserted.rows[0].id;
      await finalizeClient.query(
        `UPDATE transcription_batches
         SET status = 'completed', output_transcription_id = $2,
             completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [batchId, outputTranscriptionId],
      );
      await recordQuotaUsage({
        userId: batch.user_id,
        transcriptionId: outputTranscriptionId,
        durationSeconds: merged.duration,
        source: "multitrack",
        db: finalizeClient,
      });
      await finalizeClient.query(
        `DELETE FROM transcriptions
         WHERE id = ANY($1::integer[])`,
        [tracks.map((track) => track.id)],
      );
      await finalizeClient.query("COMMIT");
      await Promise.all(
        tracks.map((track) =>
          fs.promises
            .unlink(resolveStoredAudioPath(track.audio_filename))
            .catch(() => {}),
        ),
      );
      return {
        ...batch,
        status: "completed",
        output_transcription_id: outputTranscriptionId,
      };
    } catch (error) {
      await finalizeClient.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      finalizeClient.release();
    }
  } catch (error) {
    await fs.promises.unlink(outputPath).catch(() => {});
    await pool.query(
      `UPDATE transcription_batches
       SET status = 'failed', error_message = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [batchId, `Không thể hợp nhất multitrack: ${error.message}`.slice(0, 2000)],
    );
    throw error;
  }
}

module.exports = {
  MULTITRACK_MAX_TRACKS,
  finalizeMultitrackBatch,
  getMultitrackBatchForUser,
  isStaleMerge,
  mergeMultitrackTranscripts,
  normalizeTrackName,
};
