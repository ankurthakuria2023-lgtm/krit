
(() => {
  const cfg = window.SCANMAT_SUPABASE_CONFIG || {};
  const $ = id => document.getElementById(id);

  // Run only on the messenger page.
  if (!$('loginForm')) return;

  let toastTimer;

  const say = message => {
    const toast = $('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  };

  const configured =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes('YOUR_PROJECT_REF') &&
    !cfg.SUPABASE_ANON_KEY.includes('YOUR_');

  if (!window.supabase || !configured) {
    if ($('loginError')) {
      $('loginError').textContent =
        'Add your Supabase project URL and public key to supabase-config.js first.';
    }
    if ($('loginStatus')) {
      $('loginStatus').textContent = 'Supabase setup needed';
    }
    return;
  }

  const db = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY
  );

  let user = null;
  let otherId = null;
  let replyId = null;
  let channel = null;

  const escapeHtml = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));

  const time = value =>
    new Date(value).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    });

  async function ensureApproved() {
    const { data, error } = await db
      .from('allowed_users')
      .select('user_id');

    if (error) throw error;

    const ids = (data || []).map(item => item.user_id);

    if (!ids.includes(user.id)) {
      throw new Error(
        'This account has not been invited to the private website.'
      );
    }

    otherId = ids.find(id => id !== user.id);

    if (!otherId) {
      throw new Error(
        'Add both account UUIDs to allowed_users before chatting.'
      );
    }
  }

  async function fileUrl(path) {
    const { data, error } = await db
      .storage
      .from('private-snaps')
      .createSignedUrl(path, 3600);

    if (error) return '';
    return data?.signedUrl || '';
  }

  async function renderMessages() {
    const box = $('chatLog');
    if (!box || !user) return;

    const { data, error } = await db
      .from('messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(300);

    if (error) throw error;

    box.innerHTML = '';

    if (!data?.length) {
      box.innerHTML = `
        <div class="empty-state">
          <span class="empty-heart">💌</span>
          <strong>Your story goes here.</strong><br>
          Send a message, a tiny thought, or a photo that made you think of each other.
        </div>`;
      return;
    }

    const pill = document.createElement('div');
    pill.className = 'date-pill';
    pill.textContent = 'A little conversation, just between us';
    box.appendChild(pill);

    for (const message of data) {
      const row = document.createElement('div');
      const mine = message.sender_id === user.id;

      row.className = 'message-row' + (mine ? ' mine' : '');

      let photo = '';

      if (message.photo_path) {
        const url = await fileUrl(message.photo_path);

        if (url) {
          photo = `
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
              <img src="${escapeHtml(url)}" alt="Shared photo">
            </a>`;
        }
      }

      row.innerHTML = `
        <div class="bubble">
          ${escapeHtml(message.body || '')}
          ${photo}
        </div>
        <div class="message-meta">
          ${mine ? 'You' : 'Them'} · ${time(message.created_at)}
        </div>
        <button class="reply-link" data-reply="${escapeHtml(message.id)}">
          ↩ Reply to this
        </button>`;

      box.appendChild(row);
    }

    box.scrollTop = box.scrollHeight;

    const last = data[data.length - 1];

    if ($('sidebarPreview')) {
      $('sidebarPreview').textContent =
        last.body || '📷 Shared a photo';
    }
  }

  async function renderReminders() {
    const box = $('reminderList');
    if (!box || !user) return;

    const { data, error } = await db
      .from('reminders')
      .select('*')
      .order('due_at', { ascending: true });

    if (error) throw error;

    box.innerHTML = '';

    if (!data?.length) {
      box.innerHTML = `
        <div class="status">
          No reminders yet. Add a tiny reminder for each other. 🌷
        </div>`;
      return;
    }

    for (const reminder of data) {
      const row = document.createElement('label');

      row.className =
        'reminder-item' + (reminder.done ? ' done' : '');

      row.innerHTML = `
        <input
          class="mini-check"
          type="checkbox"
          ${reminder.done ? 'checked' : ''}
          data-reminder="${escapeHtml(reminder.id)}"
        >
        <span class="reminder-title">
          ${escapeHtml(reminder.title)}
        </span>
        <span class="reminder-time">
          ${new Date(reminder.due_at).toLocaleString()}
        </span>`;

      box.appendChild(row);
    }
  }

  async function refresh() {
    try {
      await Promise.all([
        renderMessages(),
        renderReminders()
      ]);

      if ($('chatStatus')) {
        $('chatStatus').textContent =
          'Connected · messages sync live';
      }
    } catch (error) {
      if ($('chatStatus')) {
        $('chatStatus').textContent =
          'Could not load conversation';
      }

      say(error.message || 'Could not load messages');
    }
  }

  async function notifyOther() {
    try {
      await db.functions.invoke('send-push', {
        body: {
          recipient_id: otherId,
          title: 'A little message 🌷',
          body: 'You have a new message.'
        }
      });
    } catch (_) {
      // Push notifications are optional until configured.
    }
  }

  async function sendMessage(photoPath = null) {
    const input = $('messageText');
    const body = input.value.trim();

    if (!body && !photoPath) return;
    if (!user || !otherId) return;

    const { error } = await db.from('messages').insert({
      sender_id: user.id,
      recipient_id: otherId,
      body,
      photo_path: photoPath,
      reply_to: replyId
    });

    if (error) {
      say(error.message);
      return;
    }

    input.value = '';
    replyId = null;

    if ($('replyingTo')) {
      $('replyingTo').style.display = 'none';
    }

    await renderMessages();
    notifyOther();
  }

  // Login
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();

    $('loginError').textContent = 'Signing in…';

    const { data, error } = await db.auth.signInWithPassword({
      email: $('loginEmail').value.trim(),
      password: $('loginPassword').value
    });

    if (error) {
      $('loginError').textContent = error.message;
      return;
    }

    user = data.user;

    try {
      await ensureApproved();

      $('authGate').classList.add('hidden');
      $('loginStatus').textContent = 'Signed in privately';

      await refresh();
      startRealtime();
    } catch (error) {
      await db.auth.signOut();
      user = null;
      $('loginError').textContent = error.message;
    }
  });

  // Restore an existing session.
  async function boot() {
    const { data, error } = await db.auth.getSession();

    if (error || !data.session) return;

    user = data.session.user;

    try {
      await ensureApproved();

      $('authGate').classList.add('hidden');
      $('loginStatus').textContent = 'Signed in privately';

      await refresh();
      startRealtime();
    } catch (error) {
      $('loginError').textContent = error.message;
      await db.auth.signOut();
    }
  }

  // Live updates.
  function startRealtime() {
    if (channel) {
      db.removeChannel(channel);
    }

    channel = db
      .channel('little-something-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages'
        },
        () => renderMessages().catch(error => say(error.message))
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reminders'
        },
        () => renderReminders().catch(error => say(error.message))
      )
      .subscribe();
  }

  // Reminder drawer: button beside the attachment button.
  const reminderOverlay = $('reminderOverlay');
  const reminderBtn = $('reminderBtn');

  function setRemindersOpen(open) {
    if (!reminderOverlay || !reminderBtn) return;

    reminderOverlay.classList.toggle('open', open);
    reminderOverlay.setAttribute('aria-hidden', String(!open));
    reminderBtn.setAttribute('aria-expanded', String(open));

    if (open) {
      setTimeout(() => $('reminderTitle')?.focus(), 120);
    }
  }

  reminderBtn?.addEventListener('click', () => {
    setRemindersOpen(!reminderOverlay.classList.contains('open'));
  });

  $('closeReminders')?.addEventListener('click', () => {
    setRemindersOpen(false);
  });

  reminderOverlay?.addEventListener('click', event => {
    if (event.target === reminderOverlay) {
      setRemindersOpen(false);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setRemindersOpen(false);
    }
  });

  // Send messages.
  $('sendBtn')?.addEventListener('click', () => sendMessage());

  $('messageText')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  $('refreshBtn')?.addEventListener('click', refresh);

  // Reply to a message.
  $('chatLog')?.addEventListener('click', event => {
    const button = event.target.closest('[data-reply]');
    if (!button) return;

    replyId = button.dataset.reply;

    $('replyingTo').textContent =
      '↩ Replying to a message · your reply will be linked';

    $('replyingTo').style.display = 'block';
    $('messageText').focus();
  });

  // Upload a photo.
  $('photoInput')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      say('Please choose an image.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      say('Choose a photo smaller than 10 MB.');
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path =
      `${user.id}/${crypto.randomUUID()}-${safeName}`;

    const { error } = await db
      .storage
      .from('private-snaps')
      .upload(path, file, {
        contentType: file.type,
        upsert: false
      });

    if (error) {
      say(error.message);
      return;
    }

    await sendMessage(path);
    event.target.value = '';
  });

  // Create a reminder.
  $('reminderForm')?.addEventListener('submit', async event => {
    event.preventDefault();

    const title = $('reminderTitle').value.trim();
    const due = $('reminderDue').value;

    if (!title || !due || !user || !otherId) return;

    const { error } = await db.from('reminders').insert({
      creator_id: user.id,
      recipient_id: otherId,
      title,
      due_at: new Date(due).toISOString()
    });

    if (error) {
      say(error.message);
      return;
    }

    $('reminderTitle').value = '';
    await renderReminders();
    say('Reminder saved 🌷');
  });

  // Mark a reminder as complete.
  $('reminderList')?.addEventListener('change', async event => {
    const id = event.target.dataset.reminder;
    if (!id) return;

    const { error } = await db
      .from('reminders')
      .update({ done: event.target.checked })
      .eq('id', id);

    if (error) {
      say(error.message);
      return;
    }

    await renderReminders();
  });

  // Logout.
  $('logoutBtn')?.addEventListener('click', async () => {
    if (channel) {
      await db.removeChannel(channel);
    }

    await db.auth.signOut();
    location.reload();
  });

  // Dark mode.
  $('themeBtn')?.addEventListener('click', () => {
    document.body.classList.toggle('dark');

    const dark = document.body.classList.contains('dark');

    localStorage.setItem(
      'littleSomethingDark',
      dark ? '1' : '0'
    );

    $('themeBtn').textContent =
      dark ? '☀ Day mode' : '☾ Night mode';
  });

  if (localStorage.getItem('littleSomethingDark') === '1') {
    document.body.classList.add('dark');

    if ($('themeBtn')) {
      $('themeBtn').textContent = '☀ Day mode';
    }
  }

  // Optional push notifications.
  $('pushBtn')?.addEventListener('click', async () => {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !cfg.VAPID_PUBLIC_KEY ||
      cfg.VAPID_PUBLIC_KEY.includes('YOUR_')
    ) {
      say('Finish VAPID setup in README first.');
      return;
    }

    try {
      const registration =
        await navigator.serviceWorker.register('./sw.js');

      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        say('Notifications were not enabled.');
        return;
      }

      const encodedKey = cfg.VAPID_PUBLIC_KEY
        .replace(/-/g, '+')
        .replace(/_/g, '/');

      const applicationServerKey = Uint8Array.from(
        atob(encodedKey),
        char => char.charCodeAt(0)
      );

      const subscription =
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });

      const { error } = await db
        .from('push_subscriptions')
        .upsert({
          user_id: user.id,
          endpoint: subscription.endpoint,
          subscription: subscription.toJSON()
        }, {
          onConflict: 'endpoint'
        });

      if (error) throw error;

      say('Notifications enabled ♡');
    } catch (error) {
      say(error.message || 'Could not enable notifications');
    }
  });

  boot();
})();
