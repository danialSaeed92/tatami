// The dojo wall.
//
// PART 1 - RELEASE & REMEDIATE
// Comments + emoji reactions are wrapped in the `wall-reactions-comments` flag.
//   flag ON  -> new code path: <Engagement/> (reactions bar + comment thread)
//   flag OFF -> old code path: read-only announcement posts
// useFlags() re-renders this page the moment the flag changes, so a release or
// rollback is visible instantly with no page reload.

import { useCallback, useEffect, useState } from 'react';
import { useFlags } from 'launchdarkly-react-client-sdk';
import { useAuth } from '../App.jsx';
import { api } from '../lib/api.js';
import { FLAGS, flagValue } from '../lib/flags.js';
import { initials, timeAgo } from '../lib/format.js';
import { useToast } from '../components/Toasts.jsx';
import UpcomingStrip from '../components/UpcomingStrip.jsx';

export default function Wall() {
  const flags = useFlags();
  const engagementOn = flagValue(flags, FLAGS.WALL_REACTIONS);
  const [data, setData] = useState(null);
  const toast = useToast();

  const load = useCallback(() => api.get('/posts').then(setData).catch((e) => toast(e.message, 'error')), [toast]);

  // Re-fetch when the flag flips so the server-side data (comments, reactions)
  // matches what the flag now allows.
  useEffect(() => { load(); }, [load, engagementOn]);
  useEffect(() => {
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="wall-layout">
      <section className="wall">
        <h1 className="page-title">Dojo wall</h1>
        <Composer onPosted={load} />
        {!data && <div className="card skeleton" />}
        {data?.posts.map((p) => (
          <PostCard key={p.id} post={p} emoji={data.emoji} engagementOn={engagementOn} onChange={load} />
        ))}
        {data && data.posts.length === 0 && <p className="muted center">No posts yet. Say hello to your club!</p>}
      </section>
      <aside className="wall-side">
        <UpcomingStrip />
      </aside>
    </div>
  );
}

function Composer({ onPosted }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post('/posts', { body, pinned });
      setBody('');
      setPinned(false);
      onPosted();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card composer" onSubmit={submit}>
      <div className="avatar">{initials(user.name)}</div>
      <div className="grow">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={user.role === 'coach' ? 'Post an announcement for the club…' : 'Share something with your club…'} rows={2} maxLength={2000} />
        <div className="composer-actions">
          {user.role === 'coach' ? (
            <label className="check small"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to top</label>
          ) : <span />}
          <button className="btn primary sm" disabled={busy || !body.trim()}>Post</button>
        </div>
      </div>
    </form>
  );
}

function PostCard({ post, emoji, engagementOn, onChange }) {
  const toast = useToast();

  async function remove() {
    if (!confirm('Delete this post?')) return;
    await api.del(`/posts/${post.id}`).catch((e) => toast(e.message, 'error'));
    onChange();
  }

  return (
    <article className={`card post ${post.pinned ? 'pinned' : ''}`}>
      <header className="post-head">
        <div className={`avatar ${post.author.role === 'coach' ? 'coach' : ''}`}>{initials(post.author.name)}</div>
        <div className="grow">
          <strong>{post.author.name}</strong>{post.author.role === 'coach' && <span className="tag">Coach</span>}
          <div className="small muted">{timeAgo(post.createdAt)}{post.pinned && ' · 📌 Pinned'}</div>
        </div>
        {post.canDelete && <button className="btn ghost sm" onClick={remove} aria-label="Delete post">Delete</button>}
      </header>
      <p className="post-body">{post.body}</p>
      {/* ---- Feature flag: wall-reactions-comments ---- */}
      {engagementOn && <Engagement post={post} emoji={emoji} onChange={onChange} />}
    </article>
  );
}

// NEW CODE PATH (behind wall-reactions-comments)
function Engagement({ post, emoji, onChange }) {
  const toast = useToast();
  const [picker, setPicker] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const reactions = post.reactions ?? [];
  const comments = post.comments ?? [];

  async function call(fn) {
    setBusy(true);
    try {
      await fn();
      onChange();
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const react = (e) => { setPicker(false); call(() => api.post(`/posts/${post.id}/reactions`, { emoji: e })); };
  const removeComment = (id) => call(() => api.del(`/comments/${id}`));
  async function submitComment(e) {
    e.preventDefault();
    if (comment.trim() && (await call(() => api.post(`/posts/${post.id}/comments`, { body: comment })))) setComment('');
  }

  return (
    <div className="engagement">
      <div className="reactions">
        {reactions.map((r) => (
          <button key={r.emoji} className={`reaction ${r.mine ? 'mine' : ''}`} onClick={() => react(r.emoji)} disabled={busy}>
            {r.emoji} <span>{r.count}</span>
          </button>
        ))}
        <div className="picker-wrap">
          <button className="reaction add" onClick={() => setPicker((p) => !p)} aria-label="Add reaction" disabled={busy}>＋ React</button>
          {picker && (
            <div className="picker">
              {emoji.map((e) => <button key={e} onClick={() => react(e)}>{e}</button>)}
            </div>
          )}
        </div>
        <span className="small muted push">{comments.length} comment{comments.length === 1 ? '' : 's'}</span>
      </div>
      {comments.length > 0 && (
        <ul className="comments">
          {comments.map((c) => (
            <li key={c.id}>
              <div className="avatar xs">{initials(c.author.name)}</div>
              <div className="comment-bubble">
                <strong>{c.author.name}</strong> <span className="small muted">{timeAgo(c.createdAt)}</span>
                <div>{c.body}</div>
              </div>
              {c.canDelete && <button className="link small" onClick={() => removeComment(c.id)}>Delete</button>}
            </li>
          ))}
        </ul>
      )}
      <form className="comment-form" onSubmit={submitComment}>
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" maxLength={1000} />
        <button className="btn sm" disabled={busy || !comment.trim()}>Reply</button>
      </form>
    </div>
  );
}
