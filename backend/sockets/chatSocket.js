// backend/sockets/chatSocket.js
const jwt = require('jsonwebtoken');
const db = require('../db');
const { ACCESS_COOKIE } = require('../middleware/auth');

const CAN_CHAT_ROLES = new Set(['admin', 'operator_admin', 'agent']);
const ROOM = 'agent_chat';

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;

  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });

  return out;
}

function attachChatSocket(io) {
  const nsp = io.of('/chat');

  // Auth middleware (handshake)
  nsp.use((socket, next) => {
    try {
      const cookieHeader = socket.request.headers.cookie || '';
      const cookies = parseCookies(cookieHeader);
      const token = cookies[ACCESS_COOKIE];

      if (!token) return next(new Error('NO_TOKEN'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (!payload?.role || !CAN_CHAT_ROLES.has(payload.role)) {
        return next(new Error('FORBIDDEN'));
      }

      socket.user = payload;
      return next();
    } catch (err) {
      return next(new Error('BAD_TOKEN'));
    }
  });

  nsp.on('connection', (socket) => {
    //console.log('[chat socket] CONNECTED namespace:', socket.nsp.name);
    // intră în camera globală
    socket.join(ROOM);

    socket.emit('chat:ready', { ok: true });

    // clientul cere sync după lastMessageId
    socket.on('chat:join', async ({ lastMessageId } = {}, ack) => {
      try {
        const afterId = Number.isFinite(Number(lastMessageId)) ? Number(lastMessageId) : null;

const sql = afterId
  ? `
    SELECT id, user_id AS userId, author_name AS authorName, role, content,
           attachment_url AS attachmentUrl, attachment_type AS attachmentType,
           created_at AS createdAt
    FROM agent_chat_messages
    WHERE id > ?
    ORDER BY id ASC
  `
  : `
    SELECT id, user_id AS userId, author_name AS authorName, role, content,
           attachment_url AS attachmentUrl, attachment_type AS attachmentType,
           created_at AS createdAt
    FROM agent_chat_messages
    ORDER BY id DESC
    LIMIT 50
  `;


        const params = afterId ? [afterId] : [];
        const q = await db.query(sql, params);
        const rows = Array.isArray(q) ? q : (q?.rows || q?.result || q?.results || []);
        const messages = afterId ? rows : rows.slice().reverse();


        socket.emit('chat:sync_response', { messages });
        if (typeof ack === 'function') ack({ ok: true, count: messages.length });
      } catch (e) {
        console.error('[chat socket] join/sync error:', e);
        if (typeof ack === 'function') ack({ ok: false });
      }
    });

    // trimite mesaj prin socket, salvează în DB, apoi broadcast
    socket.on('chat:send', async (payload = {}, ack) => {
      try {
        const content = String(payload?.content || '').trim();
        const attachment_url = payload?.attachment_url ?? null;
        const attachment_type = payload?.attachment_type ?? null;

        if (!content && !attachment_url) {
          if (typeof ack === 'function') ack({ ok: false, error: 'EMPTY' });
          return;
        }

        // IMPORTANT: exact ca în routes/chat.js (nu inventăm alt format)
        const sql = `
  INSERT INTO agent_chat_messages
    (user_id, author_name, role, content, attachment_url, attachment_type)
  VALUES (?, ?, ?, ?, ?, ?)
`;

        const params = [
          socket.user.id,
          socket.user.name || 'Agent',
          socket.user.role,
          content || null,
          attachment_url,
          attachment_type,
        ];


        const result = await db.query(sql, params);
        const insertedId = result?.insertId ?? result?.[0]?.insertId;


        const q2 = await db.query(
          `SELECT id, user_id AS userId, author_name AS authorName, role, content,
          attachment_url AS attachmentUrl, attachment_type AS attachmentType,
          created_at AS createdAt
   FROM agent_chat_messages WHERE id = ? LIMIT 1`,
          [insertedId]
        );

        const rows2 = Array.isArray(q2) ? q2 : (q2?.rows || q2?.result || q2?.results || []);
        const message = rows2?.[0] || null;

        // broadcast către toți agenții
        nsp.to(ROOM).emit('chat:new_message', { message });




        // ack către sender (confirmare)
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (e) {
        console.error('[chat socket] send error:', e);
        if (typeof ack === 'function') ack({ ok: false, error: 'SERVER' });
      }
    });
  });
}

module.exports = { attachChatSocket };
