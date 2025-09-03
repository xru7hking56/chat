(function () {
  const socket = window.io();
  const $ = (sel) => document.querySelector(sel);

  const messages   = $('#messages');
  const form       = $('#send-form');
  const input      = $('#message');
  const typingEl   = $('#typing');
  const onlineEl   = $('#online');

  const btnConnect = $('#btn-connect');
  const btnNext    = $('#btn-next');
  const btnBlock   = $('#btn-block');
  const btnExit    = $('#btn-exit');
  const btnReport  = $('#btn-report');
  const selGender  = $('#sel-gender');
  const selSeeking = $('#sel-seeking');

  /* ============ Layout & keyboard handling ============ */
  function setKbSafeBottom(px){
    document.documentElement.style.setProperty('--kb-safe-bottom', `${Math.max(0, Math.floor(px))}px`);
  }
  function viewportHeight() {
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  }
  function computeLayout() {
    const header = document.querySelector('.bar');
    const bottom = document.querySelector('.bottom');
    const hH = header ? header.getBoundingClientRect().height : 0;
    const bH = bottom ? bottom.getBoundingClientRect().height : 0;
    const pad = 4;
    const vh = viewportHeight();
    const h = Math.max(120, Math.floor(vh - hH - bH - pad));
    if (messages) {
      messages.style.height = h + 'px';
      messages.style.maxHeight = h + 'px';
      messages.style.overflowY = 'auto';
    }
  }
  // VisualViewport to lift input above keyboard + recalc layout
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const applyVV = () => {
      const bottomGap = (window.innerHeight - (vv.height + vv.offsetTop));
      setKbSafeBottom(bottomGap);
      computeLayout();
      maybeScrollToBottom(true); // gentle nudge
    };
    vv.addEventListener('resize', applyVV);
    vv.addEventListener('scroll', applyVV);
    applyVV();
  }

  // Debounced resize/orientation handling
  let rAF;
  function scheduleLayout() {
    if (rAF) cancelAnimationFrame(rAF);
    rAF = requestAnimationFrame(() => { computeLayout(); maybeScrollToBottom(true); });
  }
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('orientationchange', () => setTimeout(scheduleLayout, 150));

  /* ============ Smart autoscroll ============ */
  function atBottom(threshold = 80) {
    if (!messages) return true;
    return (messages.scrollHeight - messages.scrollTop - messages.clientHeight) < threshold;
  }
  function scrollToBottom() {
    if (!messages) return;
    messages.scrollTop = messages.scrollHeight;
    const last = messages.lastElementChild;
    if (last) last.scrollIntoView({ block: 'end', inline: 'nearest' });
  }
  function maybeScrollToBottom(force = false) {
    if (force || atBottom()) scrollToBottom();
  }
  // Observe new nodes and autoscroll only if near bottom
  const mo = new MutationObserver(() => maybeScrollToBottom(false));
  if (messages) mo.observe(messages, { childList: true });

  /* ============ Render helpers ============ */
  function fmtTime(ts){
    const d = new Date(ts || Date.now());
    const pad = (n)=>String(n).padStart(2,'0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function addStrip(text, kind){
    const el = document.createElement('div');
    el.className = `msg strip ${kind||'violet'}`;
    el.textContent = text;
    messages.appendChild(el);
  }
  function addRow(who, text, ts){
    const row = document.createElement('div');
    row.className = `row ${who === 'you' ? 'you' : 'stranger'}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const whoEl = document.createElement('span');
    whoEl.className = `who ${who === 'you' ? 'you' : 'stranger'}`;
    whoEl.textContent = (who === 'you') ? 'შენ' : 'ის';
    const timeEl = document.createElement('span');
    timeEl.className = 'time';
    timeEl.textContent = fmtTime(ts);
    meta.appendChild(whoEl);
    meta.appendChild(timeEl);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const bar = document.createElement('span');
    bar.className = 'bar';
    const textEl = document.createElement('span');
    textEl.className = 'text';
    textEl.textContent = text;

    bubble.appendChild(bar);
    bubble.appendChild(textEl);

    row.appendChild(meta);
    row.appendChild(bubble);
    messages.appendChild(row);
  }
  function clearChat(){ if (messages) messages.innerHTML = ''; }

  /* ============ UI events (existing buttons only) ============ */
  function connectNow() {
    socket.emit('setProfile', { gender: selGender?.value || 'secret', seeking: selSeeking?.value || 'any' });
    socket.emit('connectRequest');
  }
  btnConnect?.addEventListener('click', connectNow);
  btnNext?.addEventListener('click', () => {
    clearChat();
    addStrip('მიმდინარეობს პარტნიორის შერჩევა...', 'violet');
    socket.emit('next');
  });
  btnBlock?.addEventListener('click', () => socket.emit('block'));
  btnExit?.addEventListener('click', () => window.location.href = '/');
  btnReport?.addEventListener('click', () => {
    const reason = prompt('რაც შეიძლება მოკლედ აღწერე დარღვევა (არასავალდებულო):', '');
    const doBlock = confirm('დაბლოკო მომხმარებელი და გადახვიდე შემდეგზე?');
    try { window.getSelection()?.removeAllRanges?.(); } catch {}
    socket.emit('report', { reason, blockNext: !!doBlock });
    if (doBlock) {
      clearChat();
      addStrip('მიმდინარეობს პარტნიორის შერჩევა...', 'violet');
    } else {
      alert('ანგარიში გადაიგზავნა.');
    }
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    socket.emit('message', text);
    input.value = '';
    input.focus();               // keep keyboard up
    socket.emit('typing', false);
    maybeScrollToBottom(true);
  });
  input?.addEventListener('input', () => {
    socket.emit('typing', true);
    clearTimeout(input._tt);
    input._tt = setTimeout(()=> socket.emit('typing', false), 700);
  });
  input?.addEventListener('focus', () => { scheduleLayout(); maybeScrollToBottom(true); });

  /* ============ socket events ============ */
  socket.on('message', ({ from, text, ts }) => addRow(from, text, ts || Date.now()));
  socket.on('system', (t) => addStrip(t, 'violet'));
  socket.on('status', ({ type }) => {
    clearChat();
    if (type === 'connected') {
      addStrip('დაკავშირებული ხართ უცნობთან.', 'green');
      typingEl.hidden = true;
      setTimeout(()=> input?.focus?.(), 50);
    } else if (type === 'disconnected') {
      addStrip('საუბარი დასრულდა.', 'violet');
      typingEl.hidden = true;
    } else if (type === 'searching') {
      addStrip('მიმდინარეობს პარტნიორის შერჩევა...', 'violet');
    }
    maybeScrollToBottom(true);
  });
  socket.on('typing', (isTyping) => {
    typingEl.hidden = !isTyping;
    typingEl.textContent = isTyping ? 'ის წერს...' : '';
    maybeScrollToBottom(false);
  });
  socket.on('online', (n) => { onlineEl && (onlineEl.textContent = String(n)); });

  // initial layout & hint
  scheduleLayout();
  addStrip('მიმდინარეობს პარტნიორის შერჩევა...', 'violet');
})();
