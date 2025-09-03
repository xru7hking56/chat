(function () {
  const socket = window.io();
  const $ = (sel) => document.querySelector(sel);

  const topbar    = $('#topbar');
  const composer  = $('#composer');
  const main      = $('#main');
  const messages  = $('#messages');
  const form      = $('#send-form');
  const input     = $('#message');
  const typingEl  = $('#typing');
  const onlineEl  = $('#online');
  const newMsgBtn = $('#newmsg');

  const btnConnect = $('#btn-connect');
  const btnNext    = $('#btn-next');
  const btnBlock   = $('#btn-block');
  const btnExit    = $('#btn-exit');
  const btnReport  = $('#btn-report');
  const selGender  = $('#sel-gender');
  const selSeeking = $('#sel-seeking');

  let typing = false;
  let typingTimeout = null;

  // Dynamically set the scroll area to fill between fixed topbar and composer
  function updateInsets(){
    const top = Math.ceil(topbar.getBoundingClientRect().height);
    const bottom = Math.ceil(composer.getBoundingClientRect().height);
    const vh = Math.max(window.innerHeight, document.documentElement.clientHeight);
    main.style.top = top + 'px';
    main.style.bottom = bottom + 'px';
    main.style.height = (vh - top - bottom) + 'px';
    // place the new message pill just above the composer
    newMsgBtn.style.bottom = (bottom + 12) + 'px';
  }
  window.addEventListener('resize', updateInsets);
  window.addEventListener('orientationchange', updateInsets);
  window.addEventListener('load', updateInsets);

  function fmtTime(ts){
    const d = new Date(ts || Date.now());
    const pad = (n)=>String(n).padStart(2,'0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function clearChat(){ messages.innerHTML = ""; }

  // === Scrolling helpers (vinme-like behavior) ===
  function nearBottom(el, threshold=64){
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }
  function scrollToBottom(){ messages.scrollTop = messages.scrollHeight; }

  messages?.addEventListener('scroll', ()=>{
    if (nearBottom(messages)) newMsgBtn?.classList.add('hidden');
  });
  newMsgBtn?.addEventListener('click', ()=>{ scrollToBottom(); newMsgBtn?.classList.add('hidden'); });

  function addStrip(text, kind){ // kind: 'violet' | 'green'
    const el = document.createElement('div');
    el.className = `msg strip ${kind}`;
    el.textContent = text;
    messages.appendChild(el);
    scrollToBottom();
  }

  function addRow(who, text, ts){
    const wasNear = nearBottom(messages, 96);

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
    meta.appendChild(whoEl); meta.appendChild(timeEl);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const bar = document.createElement('span'); bar.className = 'bar';
    const textEl = document.createElement('span'); textEl.className = 'text'; textEl.textContent = text;
    bubble.appendChild(bar); bubble.appendChild(textEl);

    row.appendChild(meta); row.appendChild(bubble);
    messages.appendChild(row);

    if (wasNear) scrollToBottom(); else newMsgBtn?.classList.remove('hidden');
  }

  function setStatus(s) {
    clearChat();
    if (s === 'connected') { addStrip('დაკავშირებული ხართ უცნობთან.', 'green'); typingEl.hidden = true; scrollToBottom(); }
    else if (s === 'disconnected') { addStrip('საუბარი დასრულდა.', 'violet'); typingEl.hidden = true; scrollToBottom(); }
    else if (s === 'searching') { addStrip('მიმდინარეობს პარტნიორის შერჩევა...', 'violet'); scrollToBottom(); }
  }

  function connectNow() {
    socket.emit('setProfile', { gender: selGender?.value || 'secret', seeking: selSeeking?.value || 'any' });
    socket.emit('connectRequest');
  }

  // UI events
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

  // Auto-grow textarea and recompute insets when height changes
  function autoGrow(){
    const prev = input.style.height;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.4) + 'px';
    if (input.style.height !== prev) updateInsets();
  }
  input?.addEventListener('input', autoGrow);

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    socket.emit('message', text);
    input.value = '';
    autoGrow();
    socket.emit('typing', false);
  });

  // typing indicator
  input?.addEventListener('input', () => {
    if (typingTimeout) clearTimeout(typingTimeout);
    if (!typing) { typing = true; socket.emit('typing', true); }
    typingTimeout = setTimeout(() => { typing = false; socket.emit('typing', false); }, 700);
  });

  // socket events
  socket.on('message', ({ from, text, ts }) => { addRow(from, text, ts || Date.now()); });
  socket.on('system', (t) => addStrip(t, 'violet'));
  socket.on('status', ({ type }) => setStatus(type));
  socket.on('typing', (isTyping) => { typingEl.hidden = !isTyping; typingEl.textContent = isTyping ? 'ის წერს...' : ''; });
  socket.on('online', (n) => { if (onlineEl) onlineEl.textContent = String(n); });

  // Initial tip
  addStrip('მარტივი ანონიმური ჩათი. დააჭირე „დაკავშირება“.', 'violet');

  // Ensure layout is correct at start
  window.addEventListener('load', () => { autoGrow(); updateInsets(); setTimeout(scrollToBottom, 50); });
})();