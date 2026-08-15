import React, {
    useEffect,
    useRef,
    useState
} from 'react';

import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import EmojiPicker from 'emoji-picker-react';

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
    X
} from 'lucide-react';

import { api, API } from './api';

import {
    encrypt,
    decrypt,
    registerEncryptionKey,
    createChatKeyEnvelope,
    saveNewChatKey
} from './crypto';

import './styles.css';

const userFrom = () => {
    try {
        return JSON.parse(
            localStorage.getItem('pulse-user')
        );
    } catch {
        return null;
    }
};

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
        password: ''
    });

    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const submit = async event => {
        event.preventDefault();

        setError('');
        setNotice('');

        try {
            if (mode === 'forgot') {
                const response = await api.post(
                    '/api/auth/forgot-password',
                    {
                        email: form.email
                    }
                );

                setNotice(response.data.message);
                return;
            }

            if (mode === 'reset') {
                const response = await api.post(
                    '/api/auth/reset-password',
                    {
                        token: resetToken,
                        password: form.password
                    }
                );

                setNotice(response.data.message);

                window.history.replaceState(
                    {},
                    '',
                    window.location.pathname
                );

                setMode('login');

                setForm({
                    name: '',
                    email: '',
                    password: ''
                });

                return;
            }

            const response = await api.post(
                `/api/auth/${
                    mode === 'login'
                        ? 'login'
                        : 'register'
                }`,
                form
            );

            localStorage.setItem(
                'pulse-token',
                response.data.token
            );

            localStorage.setItem(
                'pulse-user',
                JSON.stringify(response.data.user)
            );

            onAuth(response.data.user);
        } catch (error) {
            setError(
                error.response?.data?.error ||
                'Could not continue'
            );
        }
    };

    const heading = {
        login: 'Welcome back',
        register: 'Create your account',
        forgot: 'Reset your password',
        reset: 'Choose a new password'
    }[mode];

    return (
        <main className="auth">
            <section>
                <div className="brand">◉ Pulse</div>

                <h1>{heading}</h1>

                <p>
                    {mode === 'forgot'
                        ? 'Enter your email and we will send a reset link.'
                        : mode === 'reset'
                            ? 'Your new password must have at least 8 characters.'
                            : 'Private conversations, made simple.'}
                </p>

                <form onSubmit={submit}>
                    {mode === 'register' && (
                        <input
                            placeholder="Your name"
                            required
                            value={form.name}
                            onChange={event =>
                                setForm({
                                    ...form,
                                    name: event.target.value
                                })
                            }
                        />
                    )}

                    {mode !== 'reset' && (
                        <input
                            type="email"
                            placeholder="Email"
                            required
                            value={form.email}
                            onChange={event =>
                                setForm({
                                    ...form,
                                    email: event.target.value
                                })
                            }
                        />
                    )}

                    {mode !== 'forgot' && (
                        <input
                            type="password"
                            placeholder="Password (8+ characters)"
                            minLength="8"
                            required
                            value={form.password}
                            onChange={event =>
                                setForm({
                                    ...form,
                                    password: event.target.value
                                })
                            }
                        />
                    )}

                    {error && <small>{error}</small>}

                    {notice && (
                        <small
                            style={{
                                color: '#168b65'
                            }}
                        >
                            {notice}
                        </small>
                    )}

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

const other = (chat, me) => {
    if (chat.type === 'group') {
        return {
            name: chat.title || 'Untitled group'
        };
    }

    return (
        chat.members?.find(member => {
            const id = member._id || member.id || member;

            return String(id) !== String(me.id);
        }) || {
            name: 'Unknown'
        }
    );
};

function App() {
    const [me, setMe] = useState(userFrom());
    const [chats, setChats] = useState([]);
    const [active, setActive] = useState(null);
    const [messages, setMessages] = useState([]);
    const [text, setText] = useState('');
    const [query, setQuery] = useState('');
    const [dark, setDark] = useState(
        localStorage.getItem('pulse-theme') === 'dark'
    );
    const [typing, setTyping] = useState(false);
    const [emoji, setEmoji] = useState(false);
    const [online, setOnline] = useState(new Set());
    const [newChat, setNewChat] = useState(false);
    const [people, setPeople] = useState([]);

    const socket = useRef();
    const bottom = useRef();
    const typingTimer = useRef();

    useEffect(() => {
        document.documentElement.dataset.theme =
            dark ? 'dark' : 'light';

        localStorage.setItem(
            'pulse-theme',
            dark ? 'dark' : 'light'
        );
    }, [dark]);

    useEffect(() => {
        if (!me) {
            return;
        }

        registerEncryptionKey().catch(console.error);

        api.get('/api/chats')
            .then(response => {
                setChats(response.data);
            })
            .catch(console.error);

        socket.current = io(
            import.meta.env.VITE_SOCKET_URL || API,
            {
                auth: {
                    token: localStorage.getItem(
                        'pulse-token'
                    )
                }
            }
        );

        const currentSocket = socket.current;

        currentSocket.on('chat:new', chat => {
            setChats(current =>
                current.some(item => item._id === chat._id)
                    ? current
                    : [chat, ...current]
            );
        });

        currentSocket.on('message:new', message => {
            setChats(current =>
                current
                    .map(chat =>
                        chat._id === message.chat
                            ? {
                                ...chat,
                                lastMessage: message,
                                updatedAt: message.createdAt
                            }
                            : chat
                    )
                    .sort(
                        (first, second) =>
                            new Date(second.updatedAt) -
                            new Date(first.updatedAt)
                    )
            );

            if (message.chat === active?._id) {
                setMessages(current =>
                    current.some(
                        item => item._id === message._id
                    )
                        ? current
                        : [...current, message]
                );
            }
        });

        currentSocket.on('typing', data => {
            if (data.chatId === active?._id) {
                setTyping(data.isTyping);
            }
        });

        currentSocket.on('presence', data => {
            setOnline(current => {
                const next = new Set(current);

                if (data.online) {
                    next.add(data.userId);
                } else {
                    next.delete(data.userId);
                }

                return next;
            });
        });

        currentSocket.on('message:read', data => {
            setMessages(current =>
                current.map(message =>
                    message._id === data.messageId
                        ? {
                            ...message,
                            status: 'read'
                        }
                        : message
                )
            );
        });

        return () => {
            currentSocket.disconnect();
        };
    }, [me, active?._id]);

    useEffect(() => {
        if (!active) {
            return;
        }

        setMessages([]);

        api.get(
            `/api/chats/${active._id}/messages`
        ).then(response => {
            setMessages(response.data.reverse());
        });
    }, [active?._id]);

    useEffect(() => {
        bottom.current?.scrollIntoView({
            behavior: 'smooth'
        });
    }, [messages]);

    const send = async (event, attachment) => {
        event?.preventDefault();

        if (!text.trim() && !attachment) {
            return;
        }

        try {
            const payload = await encrypt(
                active,
                text || attachment.name
            );

            socket.current.emit(
                'message:send',
                {
                    chatId: active._id,
                    ...payload,
                    kind: attachment?.mime?.startsWith('image')
                        ? 'image'
                        : attachment?.mime?.startsWith('video')
                            ? 'video'
                            : attachment
                                ? 'file'
                                : 'text',
                    attachment
                },
                () => {}
            );

            setText('');
            setEmoji(false);

            socket.current.emit('typing', {
                chatId: active._id,
                isTyping: false
            });
        } catch (error) {
            alert(
                error.message ||
                'Could not encrypt the message.'
            );
        }
    };

    const upload = async event => {
        const file = event.target.files?.[0];

        if (!file) {
            return;
        }

        const formData = new FormData();

        formData.append('file', file);

        const response = await api.post(
            '/api/upload',
            formData
        );

        send(null, response.data);
    };

    const write = event => {
        setText(event.target.value);

        socket.current.emit('typing', {
            chatId: active._id,
            isTyping: true
        });

        clearTimeout(typingTimer.current);

        typingTimer.current = setTimeout(() => {
            socket.current.emit('typing', {
                chatId: active._id,
                isTyping: false
            });
        }, 900);
    };

    const create = async userId => {
        try {
            const encryption =
                await createChatKeyEnvelope(userId);

            const response = await api.post(
                '/api/chats',
                {
                    memberIds: [userId],
                    keyEnvelopes: [
                        encryption.envelope
                    ]
                }
            );

            // New encrypted chat
            if (response.status === 201) {
                await saveNewChatKey(
                    response.data._id,
                    encryption.rawChatKey
                );
            }

            setChats(current =>
                current.some(
                    chat => chat._id === response.data._id
                )
                    ? current
                    : [response.data, ...current]
            );

            setActive(response.data);
            setNewChat(false);
        } catch (error) {
            alert(
                error.response?.data?.error ||
                error.message ||
                'Could not create encrypted chat.'
            );
        }
    };

    if (!me) {
        return <Auth onAuth={setMe} />;
    }

    const title = active && other(active, me);

    return (
        <main className="app">
            <aside className="sidebar">
                <header>
                    <div className="brand">◉ Pulse</div>

                    <button
                        className="icon"
                        onClick={() =>
                            setDark(!dark)
                        }
                    >
                        {dark ? <Sun /> : <Moon />}
                    </button>

                    <button
                        className="icon"
                        onClick={() => {
                            localStorage.removeItem('pulse-token');
                            localStorage.removeItem('pulse-user');
                            setMe(null);
                        }}
                    >
                        <LogOut />
                    </button>
                </header>

                <div className="search">
                    <Search />

                    <input
                        value={query}
                        onChange={event =>
                            setQuery(event.target.value)
                        }
                        placeholder="Search conversations"
                    />
                </div>

                <button
                    className="new"
                    onClick={async () => {
                        setNewChat(true);

                        const response = await api.get(
                            '/api/users'
                        );

                        setPeople(response.data);
                    }}
                >
                    <Plus /> New conversation
                </button>

                <div className="chatlist">
                    {chats
                        .filter(chat =>
                            other(chat, me)
                                .name
                                .toLowerCase()
                                .includes(
                                    query.toLowerCase()
                                )
                        )
                        .map(chat => {
                            const user = other(chat, me);

                            return (
                                <button
                                    className={`chat ${
                                        active?._id === chat._id
                                            ? 'selected'
                                            : ''
                                    }`}
                                    onClick={() =>
                                        setActive(chat)
                                    }
                                    key={chat._id}
                                >
                                    <div className="avatar">
                                        {user.name?.[0] || '?'}
                                    </div>

                                    <span>
                                        <b>{user.name}</b>

                                        <small>
                                            {chat.lastMessage
                                                ? 'Encrypted message'
                                                : 'Start a conversation'}
                                        </small>
                                    </span>

                                    {chat.type === 'group' && (
                                        <Users size={15} />
                                    )}
                                </button>
                            );
                        })}
                </div>
            </aside>

            <section className="conversation">
                {!active ? (
                    <div className="empty">
                        <div>◉</div>
                        <h2>Your messages</h2>
                        <p>
                            Select a conversation or start a new one.
                        </p>
                    </div>
                ) : (
                    <>
                        <header className="chathead">
                            <div className="avatar">
                                {title.name?.[0] || '?'}
                            </div>

                            <span>
                                <b>{title.name}</b>

                                <small>
                                    {active.type === 'group'
                                        ? `${active.members.length} members`
                                        : online.has(
                                            title._id || title.id
                                        )
                                            ? 'online'
                                            : 'offline'}
                                </small>
                            </span>

                            <MoreVertical />
                        </header>

                        <div className="messages">
                            {messages.map(message => (
                                <Bubble
                                    key={message._id}
                                    m={message}
                                    chat={active}
                                    mine={
                                        (
                                            message.sender._id ||
                                            message.sender.id
                                        ) === me.id
                                    }
                                />
                            ))}

                            {typing && (
                                <div className="typing">
                                    typing…
                                </div>
                            )}

                            <i ref={bottom} />
                        </div>

                        <form
                            className="composer"
                            onSubmit={send}
                        >
                            <label className="icon">
                                <Paperclip />

                                <input
                                    hidden
                                    type="file"
                                    onChange={upload}
                                />
                            </label>

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
                                        onEmojiClick={item =>
                                            setText(
                                                current =>
                                                    current +
                                                    item.emoji
                                            )
                                        }
                                        width={300}
                                        height={360}
                                    />
                                </div>
                            )}

                            <input
                                value={text}
                                onChange={write}
                                placeholder="Write a message"
                            />

                            <button
                                type="button"
                                className="icon"
                            >
                                <Mic />
                            </button>

                            <button className="send">
                                <Send />
                            </button>
                        </form>
                    </>
                )}
            </section>

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

                        <h2>New conversation</h2>

                        <div className="people">
                            {people.map(person => (
                                <button
                                    key={person.id}
                                    onClick={() =>
                                        create(person.id)
                                    }
                                >
                                    <div className="avatar">
                                        {person.name[0]}
                                    </div>

                                    <span>
                                        <b>{person.name}</b>
                                        <small>{person.email}</small>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                </div>
            )}
        </main>
    );
}

function Bubble({ m, chat, mine }) {
    const [body, setBody] = useState('');

    useEffect(() => {
        decrypt(chat, m).then(setBody);
    }, [chat, m]);

    return (
        <article
            className={`bubble ${mine ? 'mine' : ''}`}
        >
            {m.attachment && (
                <a
                    href={`${API}${m.attachment.url}`}
                    target="_blank"
                    rel="noreferrer"
                >
                    📎 {m.attachment.name}
                </a>
            )}

            <p>{body}</p>

            <small>
                {new Date(m.createdAt).toLocaleTimeString(
                    [],
                    {
                        hour: '2-digit',
                        minute: '2-digit'
                    }
                )}

                {mine && (
                    <CheckCheck
                        size={14}
                        className={
                            m.status === 'read'
                                ? 'read'
                                : ''
                        }
                    />
                )}
            </small>
        </article>
    );
}

createRoot(
    document.getElementById('root')
).render(<App />);
