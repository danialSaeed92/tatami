// Attendance statistics. A class counts toward a member's attendance % once a
// coach has taken attendance for it, it matches the member's age group, and it
// happened after they joined.

import { localStamp } from './db.js';

export function audienceSql(alias = 's') {
  // kids  -> kids + all ; teens/adults -> adults + all
  return `(${alias}.audience = 'all' OR (${alias}.audience = 'kids' AND :age = 'kids') OR (${alias}.audience = 'adults' AND :age != 'kids'))`;
}

export function attendanceStats(db, user, now = localStamp()) {
  const row = db.prepare(`
    SELECT COUNT(*) AS eligible, COALESCE(SUM(a.present), 0) AS attended
    FROM sessions s
    LEFT JOIN attendance a ON a.session_id = s.id AND a.user_id = :uid
    WHERE s.dojo_id = :dojo AND s.type = 'class' AND s.starts_at < :now AND s.starts_at >= :joined
      AND ${audienceSql('s')}
      AND EXISTS (SELECT 1 FROM attendance t WHERE t.session_id = s.id)`)
    .get({ uid: user.id, dojo: user.dojo.id, now, joined: user.createdAt.slice(0, 16), age: user.ageGroup });
  const eligible = Number(row.eligible);
  const attended = Number(row.attended);
  return { eligible, attended, pct: eligible ? Math.round((attended / eligible) * 100) : null };
}
