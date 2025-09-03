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

  function scrollToBottom(){
    requestAnimationFrame(()=> {
      const m = document.getElementById('messages');
      if (!m) return;
      m.scrollTop = m.scrollHeight;
      if (m.lastElementChild) {
        m.lastElementChild.scrollIntoView({ block: 'end', inline: 'nearest' });
      }
    });
  }

  let typing = false;
  let typingTimeout = null;

  function fmtTime(ts){
    const d = new Date(ts || Date.now());
    const pad = (n)=>String(n).padStart(2,'0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function addStrip(text, kind){
    const el = document.createElement('div');
    el.className = `msg strip ${kind}`;
    el.textContent = text;
    messages.appendChild(el);
    scrollToBottom();
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
    scrollToBottom();
  }

  function clearChat(){
    if (messages) messages.innerHTML = '';
  }

  function setStatus(s) {
    clearChat();
    if (s === 'connected') {
      addStrip('დაკავშირებული ხართ უცნობთან.', 'green');
      typingEl.hidden = true;
    } else if (s === 'disconnected') {
      addStrip('საუბარი დასრულდა.', 'violet');
      typingEl.hidden = true;
    } else if (s === 'searching') {
      addStrip('მიმდინარეობს პარტნიორის შერჩევა...', 'violet');
    }
    scrollToBottom();
  }

  function connectNow() {
    socket.emit('setProfile', { gender: selGender.value, seeking: selSeeking.value });
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
    socket.emit('typing', false);
  });

  input?.addEventListener('input', () => {
    if (typingTimeout) clearTimeout(typingTimeout);
    if (!typing) {
      typing = true;
      socket.emit('typing', true);
    }
    typingTimeout = setTimeout(() => {
      typing = false;
      socket.emit('typing', false);
    }, 700);
  });

  // socket events
  socket.on('message', ({ from, text, ts }) => addRow(from, text, ts || Date.now()));
  socket.on('system', (t) => addStrip(t, 'violet'));
  socket.on('status', ({ type }) => setStatus(type));
  socket.on('typing', (isTyping) => {
    typingEl.hidden = !isTyping;
    typingEl.textContent = isTyping ? 'ის წერს...' : '';
    scrollToBottom();
  });
  socket.on('online', (n) => { onlineEl.textContent = String(n); });

  // Initial tips
  addStrip('მიმდინარეობს პარტნიორის შერჩევა...', 'violet');
})();
