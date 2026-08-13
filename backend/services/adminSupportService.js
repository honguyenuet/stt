async function updateAdminSupportTicketStatus(db, ticketId, status) {
  const { rows } = await db.query(
    `UPDATE support_tickets
     SET status = $1::varchar,
         updated_at = NOW(),
         resolved_at = CASE
           WHEN $1::varchar IN ('resolved', 'closed') THEN NOW()
           ELSE NULL
         END
     WHERE id = $2
     RETURNING *`,
    [status, ticketId],
  );
  return rows[0] || null;
}

module.exports = { updateAdminSupportTicketStatus };
