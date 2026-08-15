import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import EmojiPicker from 'emoji-picker-react';

import { api, API } from './api';
import { encrypt, decrypt } from './crypto';

import {
  Search,
  Send,
  Paperclip,
  Mic,
  MoreVertical,
  Plus,
  LogOut,
  Moon,
  Sun,
  Users,
  CheckCheck,
  Smile,
  X,
} from 'lucide-react';

import './styles.css';


// ============================================================
// GET LOGGED-IN USER
// ============================================================

const userFrom = () => {
  try {
    return JSON.parse(localStorage.getItem('pulse-user'));
  } catch {
    return null;
  }
};


// ============================================================
// AUTHENTICATION
// Login / Register / Forgot Password / Reset Password
// ============================================================

function Auth({ onAuth }) {
  const resetToken = new URLSearchParams(
    window.location.search
  ).get('reset');

  const [mode, setMode] = useState(
    resetToken ? 'reset' : 'login'
  );

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
  });

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (e) => {
    e.preventDefault();

    setError('');
    setNotice('');

    try {
      // --------------------------------------------------------
      // FORGOT PASSWORD
      // --------------------------------------------------------

      if (mode === 'forgot') {
        const r = await api.post(
          '/api/auth/forgot-password',
          {
            email: form.email,
          }
        );

        setNotice(r.data.message);
        return;
      }

      // --------------------------------------------------------
      // RESET PASSWORD
      // --------------------------------------------------------

      if (mode === 'reset') {
        const r = await api.post(
          '/api/auth/reset-password',
          {
            token: resetToken,
            password: form.password,
          }
        );

        setNotice(r.data.message);

        window.history.replaceState(
          {},
          '',
          window.location.pathname
        );

        setMode('login');

        setForm({
          name: '',
          email: '',
          password: '',
        });

        return;
      }

      // --------------------------------------------------------
      // LOGIN / REGISTER
      // --------------------------------------------------------

      const r = await api.post(
        `/api/auth/${
          mode === 'login'
            ? 'login'
            : 'register'
        }`,
        form
      );

      localStorage.setItem(
        'pulse-token',
        r.data.token
      );

      localStorage.setItem(
        'pulse-user',
        JSON.stringify(r.data.user)
      );

      onAuth(r.data.user);
    } catch (e) {
      setError(
        e.response?.data?.error ||
          'Could not continue'
      );
    }
  };

  // ----------------------------------------------------------
  // PAGE TITLE
  // ----------------------------------------------------------

  const title = {
    login: 'Welcome back',
    register: 'Create your account',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
  }[mode];

  return (
    <main className="auth">
      <section>

        <div className="brand">
          ◉ Pulse
        </div>

        <h1>{title}</h1>

        <p>
          {mode === 'forgot'
            ? 'Enter your email and we will send a reset link.'
            : mode === 'reset'
              ? 'Your new password must have at least 8 characters.'
              : 'Private conversations, made simple.'}
        </p>

        <form onSubmit={submit}>

          {/* REGISTER NAME */}
          {mode === 'register' && (
            <input
              placeholder="Your name"
              required
              value={form.name}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                })
              }
            />
          )}

          {/* EMAIL */}
          {mode !== 'reset' && (
            <input
              type="email"
              placeholder="Email"
              required
              value={form.email}
              onChange={(e) =>
                setForm({
                  ...form,
                  email: e.target.value,
                })
              }
            />
          )}

          {/* PASSWORD */}
          {mode !== 'forgot' && (
            <input
              type="password"
              placeholder="Password (8+ characters)"
              minLength="8"
              required
              value={form.password}
              onChange={(e) =>
                setForm({
                  ...form,
                  password: e.target.value,
                })
              }
            />
          )}

          {/* ERROR */}
          {error && (
            <small>
              {error}
            </small>
          )}

          {/* SUCCESS MESSAGE */}
          {notice && (
            <small
              style={{
                color: '#168b65',
              }}
            >
              {notice}
            </small>
          )}

          {/* SUBMIT BUTTON */}
          <button>
            {mode === 'login'
              ? 'Sign in'
              : mode === 'register'
                ? 'Sign up'
                : mode === 'forgot'
                  ? 'Send reset link'
                  : 'Update password'}
          </button>

        </form>

        {/* LOGIN LINKS */}
        {mode === 'login' && (
          <>
            <button
              className="link"
              onClick={() =>
                setMode('forgot')
              }
            >
              Forgot password?
            </button>

            <button
              className="link"
              onClick={() =>
                setMode('register')
              }
            >
              New here? Create an account
            </button>
          </>
        )}

        {/* REGISTER LINK */}
        {mode === 'register' && (
          <button
            className="link"
            onClick={() =>
              setMode('login')
            }
          >
            Already have an account? Sign in
          </button>
        )}

        {/* FORGOT PASSWORD LINK */}
        {mode === 'forgot' && (
          <button
            className="link"
            onClick={() =>
              setMode('login')
            }
          >
            Back to sign in
          </button>
        )}

      </section>
    </main>
  );
}


// ============================================================
// GET OTHER USER IN CHAT
// ============================================================

const other = (chat, me) =>
  chat.type === 'group'
    ? {
        name:
          chat.title ||
          'Untitled group',
      }
    : chat.members.find(
        (x) =>
          x._id !== me.id &&
          x.id !== me.id
      ) || {
        name: 'Unknown',
      };


// ============================================================
// MAIN APP
// ============================================================

function App() {
  const [me, setMe] = useState(userFrom());

  const [chats, setChats] = useState([]);

  const [active, setActive] = useState(null);

  const [messages, setMessages] = useState([]);

  const [text, setText] = useState('');

  const [query, setQuery] = useState('');

  const [dark, setDark] = useState(
    localStorage.getItem(
      'pulse-theme'
    ) === 'dark'
  );

  const [typing, setTyping] = useState(false);

  const [emoji, setEmoji] = useState(false);

  const [online, setOnline] = useState(
    new Set()
  );

  const [newChat, setNewChat] =
    useState(false);

  const [people, setPeople] =
    useState([]);

  const socket = useRef();

  const bottom = useRef();

  const typingTimer = useRef();


  // ==========================================================
  // DARK MODE
  // ==========================================================

  useEffect(() => {
    document.documentElement.dataset.theme =
      dark ? 'dark' : 'light';

    localStorage.setItem(
      'pulse-theme',
      dark ? 'dark' : 'light'
    );
  }, [dark]);


  // ==========================================================
  // LOAD CHATS + SOCKET
  // ==========================================================

  useEffect(() => {
    if (!me) return;

    api
      .get('/api/chats')
      .then((r) => {
        setChats(r.data);
      });

    socket.current = io(
      import.meta.env.VITE_SOCKET_URL ||
        API,
      {
        auth: {
          token:
            localStorage.getItem(
              'pulse-token'
            ),
        },
      }
    );

    const s = socket.current;


    // --------------------------------------------------------
    // NEW CHAT
    // --------------------------------------------------------

    s.on('chat:new', (c) => {
      setChats((x) =>
        x.some(
          (a) => a._id === c._id
        )
          ? x
          : [c, ...x]
      );
    });


    // --------------------------------------------------------
    // NEW MESSAGE
    // --------------------------------------------------------

    s.on('message:new', (m) => {
      setChats((x) =>
        x
          .map((c) =>
            c._id === m.chat
              ? {
                  ...c,
                  lastMessage: m,
                  updatedAt:
                    m.createdAt,
                }
              : c
          )
          .sort(
            (a, b) =>
              new Date(b.updatedAt) -
              new Date(a.updatedAt)
          )
      );

      if (
        m.chat === active?._id
      ) {
        setMessages((x) =>
          x.some(
            (a) => a._id === m._id
          )
            ? x
            : [...x, m]
        );
      }
    });


    // --------------------------------------------------------
    // TYPING
    // --------------------------------------------------------

    s.on('typing', (d) => {
      d.chatId === active?._id &&
        setTyping(d.isTyping);
    });


    // --------------------------------------------------------
    // ONLINE / OFFLINE
    // --------------------------------------------------------

    s.on('presence', (d) => {
      setOnline((x) => {
        const n = new Set(x);

        if (d.online) {
          n.add(d.userId);
        } else {
          n.delete(d.userId);
        }

        return n;
      });
    });


    // --------------------------------------------------------
    // MESSAGE READ
    // --------------------------------------------------------

    s.on(
      'message:read',
      (d) => {
        setMessages((x) =>
          x.map((m) =>
            m._id === d.messageId
              ? {
                  ...m,
                  status: 'read',
                }
              : m
          )
        );
      }
    );


    return () => {
      s.disconnect();
    };
  }, [me, active?._id]);


  // ==========================================================
  // LOAD MESSAGES
  // ==========================================================

  useEffect(() => {
    if (!active) return;

    setMessages([]);

    api
      .get(
        `/api/chats/${active._id}/messages`
      )
      .then((r) => {
        setMessages(
          r.data.reverse()
        );
      });
  }, [active?._id]);


  // ==========================================================
  // AUTO SCROLL
  // ==========================================================

  useEffect(() => {
    bottom.current?.scrollIntoView({
      behavior: 'smooth',
    });
  }, [messages]);


  // ==========================================================
  // SEND MESSAGE
  // ==========================================================

  const send = async (
    e,
    attachment
  ) => {
    e?.preventDefault();

    if (
      !text.trim() &&
      !attachment
    ) {
      return;
    }

    const payload =
      await encrypt(
        active._id,
        text ||
          attachment.name
      );

    socket.current.emit(
      'message:send',
      {
        chatId: active._id,

        ...payload,

        kind:
          attachment?.mime?.startsWith(
            'image'
          )
            ? 'image'
            : attachment?.mime?.startsWith(
                'video'
              )
              ? 'video'
              : attachment
                ? 'file'
                : 'text',

        attachment,
      },
      () => {}
    );

    setText('');

    setEmoji(false);

    socket.current.emit(
      'typing',
      {
        chatId: active._id,
        isTyping: false,
      }
    );
  };


  // ==========================================================
  // FILE UPLOAD
  // ==========================================================

  const upload = async (e) => {
    const f =
      e.target.files?.[0];

    if (!f) return;

    const fd =
      new FormData();

    fd.append(
      'file',
      f
    );

    const r =
      await api.post(
        '/api/upload',
        fd
      );

    send(null, r.data);
  };


  // ==========================================================
  // TYPING HANDLER
  // ==========================================================

  const write = (e) => {
    setText(
      e.target.value
    );

    socket.current.emit(
      'typing',
      {
        chatId:
          active._id,
        isTyping: true,
      }
    );

    clearTimeout(
      typingTimer.current
    );

    typingTimer.current =
      setTimeout(() => {
        socket.current.emit(
          'typing',
          {
            chatId:
              active._id,
            isTyping: false,
          }
        );
      }, 900);
  };


  // ==========================================================
  // CREATE NEW CHAT
  // ==========================================================

  const create = async (
    id
  ) => {
    const r =
      await api.post(
        '/api/chats',
        {
          memberIds: [id],
        }
      );

    setChats((x) =>
      x.some(
        (c) =>
          c._id ===
          r.data._id
      )
        ? x
        : [r.data, ...x]
    );

    setActive(
      r.data
    );

    setNewChat(false);
  };


  // ==========================================================
  // LOGOUT / AUTH SCREEN
  // ==========================================================

  if (!me) {
    return (
      <Auth
        onAuth={setMe}
      />
    );
  }


  const title =
    active &&
    other(active, me);


  // ==========================================================
  // MAIN UI
  // ==========================================================

  return (
    <main className="app">

      {/* =====================================================
          SIDEBAR
      ====================================================== */}

      <aside className="sidebar">

        <header>

          <div className="brand">
            ◉ Pulse
          </div>

          <button
            className="icon"
            onClick={() =>
              setDark(!dark)
            }
          >
            {dark ? (
              <Sun />
            ) : (
              <Moon />
            )}
          </button>

          <button
            className="icon"
            onClick={() => {
              localStorage.clear();
              setMe(null);
            }}
          >
            <LogOut />
          </button>

        </header>


        {/* SEARCH */}

        <div className="search">

          <Search />

          <input
            value={query}
            onChange={(e) =>
              setQuery(
                e.target.value
              )
            }
            placeholder="Search conversations"
          />

        </div>


        {/* NEW CHAT */}

        <button
          className="new"
          onClick={async () => {
            setNewChat(true);

            setPeople(
              (
                await api.get(
                  '/api/users'
                )
              ).data
            );
          }}
        >
          <Plus />
          New conversation
        </button>


        {/* CHAT LIST */}

        <div className="chatlist">

          {chats
            .filter((c) =>
              other(
                c,
                me
              )
                .name
                .toLowerCase()
                .includes(
                  query.toLowerCase()
                )
            )
            .map((c) => {

              const u =
                other(
                  c,
                  me
                );

              return (
                <button
                  className={`chat ${
                    active?._id ===
                    c._id
                      ? 'selected'
                      : ''
                  }`}
                  onClick={() =>
                    setActive(c)
                  }
                  key={c._id}
                >

                  <div className="avatar">
                    {u.name[0]}
                  </div>

                  <span>

                    <b>
                      {u.name}
                    </b>

                    <small>
                      {c.lastMessage
                        ? 'Encrypted message'
                        : 'Start a conversation'}
                    </small>

                  </span>

                  {c.type ===
                    'group' && (
                    <Users
                      size={15}
                    />
                  )}

                </button>
              );
            })}

        </div>

      </aside>


      {/* =====================================================
          CONVERSATION
      ====================================================== */}

      <section className="conversation">

        {!active ? (

          <div className="empty">

            <div>◉</div>

            <h2>
              Your messages
            </h2>

            <p>
              Select a conversation
              or start a new one.
            </p>

          </div>

        ) : (

          <>

            {/* CHAT HEADER */}

            <header className="chathead">

              <div className="avatar">
                {title.name[0]}
              </div>

              <span>

                <b>
                  {title.name}
                </b>

                <small>
                  {active.type ===
                  'group'
                    ? `${active.members.length} members`
                    : online.has(
                        title._id ||
                          title.id
                      )
                      ? 'online'
                      : 'offline'}
                </small>

              </span>

              <MoreVertical />

            </header>


            {/* MESSAGES */}

            <div className="messages">

              {messages.map(
                (m) => (
                  <Bubble
                    key={m._id}
                    m={m}
                    chatId={
                      active._id
                    }
                    mine={
                      (
                        m.sender._id ||
                        m.sender.id
                      ) === me.id
                    }
                  />
                )
              )}

              {typing && (
                <div className="typing">
                  typing…
                </div>
              )}

              <i
                ref={bottom}
              />

            </div>


            {/* MESSAGE COMPOSER */}

            <form
              className="composer"
              onSubmit={send}
            >

              {/* ATTACHMENT */}

              <label className="icon">

                <Paperclip />

                <input
                  hidden
                  type="file"
                  onChange={upload}
                />

              </label>


              {/* EMOJI */}

              <button
                type="button"
                className="icon"
                onClick={() =>
                  setEmoji(!emoji)
                }
              >
                <Smile />
              </button>


              {emoji && (
                <div className="emojis">

                  <EmojiPicker
                    onEmojiClick={(
                      x
                    ) =>
                      setText(
                        (t) =>
                          t +
                          x.emoji
                      )
                    }
                    width={300}
                    height={360}
                  />

                </div>
              )}


              {/* TEXT */}

              <input
                value={text}
                onChange={write}
                placeholder="Write a message"
              />


              {/* MIC */}

              <button
                type="button"
                className="icon"
              >
                <Mic />
              </button>


              {/* SEND */}

              <button className="send">
                <Send />
              </button>

            </form>

          </>
        )}

      </section>


      {/* =====================================================
          NEW CHAT MODAL
      ====================================================== */}

      {newChat && (

        <div className="modal">

          <section>

            <button
              className="close"
              onClick={() =>
                setNewChat(false)
              }
            >
              <X />
            </button>

            <h2>
              New conversation
            </h2>

            <div className="people">

              {people.map(
                (p) => (

                  <button
                    key={p.id}
                    onClick={() =>
                      create(
                        p.id
                      )
                    }
                  >

                    <div className="avatar">
                      {p.name[0]}
                    </div>

                    <span>

                      <b>
                        {p.name}
                      </b>

                      <small>
                        {p.email}
                      </small>

                    </span>

                  </button>

                )
              )}

            </div>

          </section>

        </div>

      )}

    </main>
  );
}


// ============================================================
// MESSAGE BUBBLE
// ============================================================

function Bubble({
  m,
  chatId,
  mine,
}) {
  const [body, setBody] =
    useState('');

  useEffect(() => {
    decrypt(
      chatId,
      m
    ).then(setBody);
  }, [m, chatId]);

  return (
    <article
      className={`bubble ${
        mine ? 'mine' : ''
      }`}
    >

      {/* ATTACHMENT */}

      {m.attachment && (
        <a
          href={`${API}${m.attachment.url}`}
          target="_blank"
          rel="noreferrer"
        >
          📎{' '}
          {m.attachment.name}
        </a>
      )}


      {/* MESSAGE */}

      <p>
        {body}
      </p>


      {/* TIME + READ STATUS */}

      <small>

        {new Date(
          m.createdAt
        ).toLocaleTimeString(
          [],
          {
            hour: '2-digit',
            minute: '2-digit',
          }
        )}

        {mine && (
          <CheckCheck
            size={14}
            className={
              m.status ===
              'read'
                ? 'read'
                : ''
            }
          />
        )}

      </small>

    </article>
  );
}


// ============================================================
// RENDER APPLICATION
// ============================================================

createRoot(
  document.getElementById('root')
).render(
  <App />
);
