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

  /* ===== Keep input above mobile keyboard and set input height CSS var ===== */
  function setKbSafeBottom(px){
    document.documentElement.style.setProperty('--kb-safe-bottom', `${Math.max(0, Math.floor(px))}px`);
  }
  function updateInputHeightVar(){
    const bottom = document.querySelector('.bottom');
    if (!bottom) return;
    const h = Math.max(40, Math.round(bottom.getBoundingClientRect().height));
    document.documentElement.style.setProperty('--input-h', h + 'px');
  }

  // VisualViewport reacts to keyboard
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const applyVV = () => {
      const bottomGap = (window.innerHeight - (vv.height + vv.offsetTop));
      setKbSafeBottom(bottomGap);
      maybeScrollToBottom(true);
      updateInputHeightVar();
    };
    vv.addEventListener('resize', applyVV);
    vv.addEventListener('scroll', applyVV);
    applyVV();
  } else {
    updateInputHeightVar();
  }

  // Update input height var when the input bar resizes (safe for desktop too)
  const ro = new ResizeObserver(() => updateInputHeightVar());
  const bottomEl = document.querySelector('.bottom');
  if (bottomEl) ro.observe(bottomEl);

  /* ===== Smart autoscroll (only if user is near bottom) ===== */
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

  const mo = new MutationObserver(() => maybeScrollToBottom(false));
  if (messages) mo.observe(messages, { childList: true });

  /* ===== Render helpers ===== */
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

  /* ===== UI actions (existing buttons only) ===== */
  function connectNow() {
    socket.emit('setProfile', { gender: selGender?.value || 'secret', seeking: selSeeking?.value || 'any' });
    socket.emit('connectRequest');
  }
  btnConnect?.addEventListener('click', connectNow);
  btnNext?.addEventListener('click', () => { clearChat(); addStrip('მიმდინარეობს პარტნიორის შერჩევა...', 'violet'); socket.emit('next'); });
  btnBlock?.addEventListener('click', () => socket.emit('block'));
  btnExit?.addEventListener('click', () => window.location.href = '/');
  btnReport?.addEventListener('click', () => {
    const reason = prompt('რაც შეიძლება მოკლედ აღწერე დარღვევა (არასავალდებულო):', '');
    const doBlock = confirm('დაბლოკო მომხმარებელი და გადახვიდე შემდეგზე?');
    try { window.getSelection()?.removeAllRanges?.(); } catch {}
    socket.emit('report', { reason, blockNext: !!doBlock });
    if (doBlock) { clearChat(); addStrip('მიმდინარეობს პარტნიორის შერჩევა...', 'violet'); } else { alert('ანგარიში გადაიგზავნა.'); }
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    socket.emit('message', text);
    input.value = '';
    input.focus();                 // keep keyboard open
    socket.emit('typing', false);
    maybeScrollToBottom(true);     // jump to bottom after sending
  });
  input?.addEventListener('input', () => {
    socket.emit('typing', true);
    clearTimeout(input._tt);
    input._tt = setTimeout(()=> socket.emit('typing', false), 700);
  });
  input?.addEventListener('focus', () => { maybeScrollToBottom(true); });

  /* ===== socket events ===== */
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

  // initial
  addStrip('მიმდინარეობს პარტნიორის შერჩევა...', 'violet');
  updateInputHeightVar();
})();
