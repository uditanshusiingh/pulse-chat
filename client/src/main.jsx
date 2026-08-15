import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    X,
    UserRound,
    Image,
    Link2,
    FileText,
    Bell,
    BellOff,
    Timer,
    Palette,
    Download,
    Trash2
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
        return JSON.parse(localStorage.getItem('pulse-user'));
    } catch {
        return null;
    }
};

const chatThemeOptions = [
    { name: 'Default green', value: '' },
    { name: 'Blue', value: '#2878d4' },
    { name: 'Purple', value: '#7650c9' },
    { name: 'Pink', value: '#c74779' },
    { name: 'Orange', value: '#d56a22' }
];

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
                    { email: form.email }
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
                `/api/auth/${mode === 'login' ? 'login' : 'register'}`,
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
        } catch (err) {
            setError(
                err.response?.data?.error || 'Could not continue'
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
                        <small style={{ color: '#168b65' }}>
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
                            onClick={() => setMode('forgot')}
                        >
                            Forgot password?
                        </button>

                        <button
                            className="link"
                            onClick={() => setMode('register')}
                        >
                            New here? Create an account
                        </button>
                    </>
                )}

                {mode === 'register' && (
                    <button
                        className="link"
                        onClick={() => setMode('login')}
                    >
                        Already have an account? Sign in
                    </button>
                )}

                {mode === 'forgot' && (
                    <button
                        className="link"
                        onClick={() => setMode('login')}
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
    const [recording, setRecording] = useState(false);

    const [menuOpen, setMenuOpen] = useState(false);
    const [panel, setPanel] = useState('');
    const [searchText, setSearchText] = useState('');
    const [plainTexts, setPlainTexts] = useState({});
    const [chatTheme, setChatTheme] = useState('');
    const [muted, setMuted] = useState(false);

    const socket = useRef();
    const bottom = useRef();
    const typingTimer = useRef();
    const recorder = useRef();
    const voiceChunks = useRef();

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
            .then(response => setChats(response.data))
            .catch(console.error);

        socket.current = io(
            import.meta.env.VITE_SOCKET_URL || API,
            {
                auth: {
                    token: localStorage.getItem('pulse-token')
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
                        String(chat._id) === String(message.chat)
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

            if (String(message.chat) === String(active?._id)) {
                setMessages(current =>
                    current.some(item => item._id === message._id)
                        ? current
                        : [...current, message]
                );
            }
        });

        currentSocket.on('typing', data => {
            if (String(data.chatId) === String(active?._id)) {
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
                        ? { ...message, status: 'read' }
                        : message
                )
            );
        });

        return () => currentSocket.disconnect();
    }, [me, active?._id]);

    useEffect(() => {
        if (!active) {
            return;
        }

        setMessages([]);
        setPanel('');
        setMenuOpen(false);
        setSearchText('');

        api.get(`/api/chats/${active._id}/messages`)
            .then(response => setMessages(response.data.reverse()))
            .catch(console.error);

        setChatTheme(
            localStorage.getItem(
                `pulse-chat-theme:${active._id}`
            ) || ''
        );

        const mySetting = active.memberSettings?.find(setting => {
            const userId = setting.user?._id || setting.user;
            return String(userId) === String(me.id);
        });

        setMuted(
            Boolean(
                mySetting?.mutedUntil &&
                new Date(mySetting.mutedUntil) > new Date()
            )
        );
    }, [active?._id, me.id]);

    useEffect(() => {
        if (!active || !messages.length) {
            setPlainTexts({});
            return;
        }

        let cancelled = false;

        Promise.all(
            messages.map(async message => [
                message._id,
                await decrypt(active, message)
            ])
        ).then(items => {
            if (!cancelled) {
                setPlainTexts(Object.fromEntries(items));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [active, messages]);

    useEffect(() => {
        bottom.current?.scrollIntoView({
            behavior: 'smooth'
        });
    }, [messages]);

    const send = async (event, attachment, kindOverride) => {
        event?.preventDefault();

        if (!active || (!text.trim() && !attachment)) {
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
                    kind: kindOverride || (
                        attachment?.mime?.startsWith('image')
                            ? 'image'
                            : attachment?.mime?.startsWith('video')
                                ? 'video'
                                : attachment
                                    ? 'file'
                                    : 'text'
                    ),
                    attachment
                },
                response => {
                    if (!response?.ok) {
                        alert(response?.error || 'Could not send message.');
                    }
                }
            );

            setText('');
            setEmoji(false);

            socket.current.emit('typing', {
                chatId: active._id,
                isTyping: false
            });
        } catch (error) {
            alert(error.message || 'Could not send message.');
        }
    };

    const uploadFile = async (file, kindOverride) => {
        if (!file) {
            return;
        }

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await api.post(
                '/api/upload',
                formData
            );

            await send(null, response.data, kindOverride);
        } catch (error) {
            alert(
                error.response?.data?.error ||
                'Could not upload this file.'
            );
        }
    };

    const upload = async event => {
        await uploadFile(event.target.files?.[0]);
        event.target.value = '';
    };

    const toggleVoiceRecording = async () => {
        if (recording) {
            recorder.current?.stop();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true
            });

            const mediaRecorder = new MediaRecorder(stream);

            recorder.current = mediaRecorder;
            voiceChunks.current = [];

            mediaRecorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    voiceChunks.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                setRecording(false);

                stream.getTracks().forEach(track => track.stop());

                const audioBlob = new Blob(voiceChunks.current, {
                    type: mediaRecorder.mimeType || 'audio/webm'
                });

                const audioFile = new File(
                    [audioBlob],
                    `voice-note-${Date.now()}.webm`,
                    { type: audioBlob.type }
                );

                await uploadFile(audioFile, 'voice');
            };

            mediaRecorder.start();
            setRecording(true);
        } catch {
            alert(
                'Please allow microphone access to record a voice note.'
            );
        }
    };

    const write = event => {
        setText(event.target.value);

        socket.current?.emit('typing', {
            chatId: active._id,
            isTyping: true
        });

        clearTimeout(typingTimer.current);

        typingTimer.current = setTimeout(() => {
            socket.current?.emit('typing', {
                chatId: active._id,
                isTyping: false
            });
        }, 900);
    };

    const create = async userId => {
        try {
            const encryption = await createChatKeyEnvelope(userId);

            const response = await api.post('/api/chats', {
                memberIds: [userId],
                keyEnvelopes: [encryption.envelope]
            });

            if (response.status === 201) {
                await saveNewChatKey(
                    response.data._id,
                    encryption.rawChatKey
                );
            }

            setChats(current =>
                current.some(chat => chat._id === response.data._id)
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

    const openPanel = name => {
        setMenuOpen(false);
        setPanel(name);
    };

    const updateChatSettings = async changes => {
        try {
            const response = await api.patch(
                `/api/chats/${active._id}/settings`,
                changes
            );

            setActive(response.data);

            setChats(current =>
                current.map(chat =>
                    chat._id === response.data._id
                        ? { ...chat, ...response.data }
                        : chat
                )
            );
        } catch (error) {
            alert(
                error.response?.data?.error ||
                'Please update the backend first, then try again.'
            );
        }
    };

    const toggleMute = async () => {
        const mutedUntil = muted
            ? null
            : new Date(
                Date.now() + 365 * 24 * 60 * 60 * 1000
            ).toISOString();

        await updateChatSettings({ mutedUntil });
        setMuted(!muted);
    };

    const setDisappearing = async seconds => {
        await updateChatSettings({
            disappearingAfterSeconds: seconds
        });

        setPanel('');
    };

    const setTheme = color => {
        localStorage.setItem(
            `pulse-chat-theme:${active._id}`,
            color
        );

        setChatTheme(color);
        setPanel('');
    };

    const exportChat = () => {
        const contact = other(active, me);

        const content = messages.map(message => {
            const senderId =
                message.sender?._id || message.sender?.id;

            const sender =
                String(senderId) === String(me.id)
                    ? me.name
                    : contact.name;

            const body =
                plainTexts[message._id] ||
                '[Encrypted message]';

            return `[${new Date(message.createdAt).toLocaleString()}] ${sender}: ${body}`;
        }).join('\n');

        const file = new Blob([content], {
            type: 'text/plain'
        });

        const url = URL.createObjectURL(file);
        const link = document.createElement('a');

        link.href = url;
        link.download = `${contact.name}-pulse-chat.txt`;
        link.click();

        URL.revokeObjectURL(url);
    };

    const clearLocalChat = () => {
        setMessages([]);
        setPlainTexts({});
        setPanel('');
    };

    const visibleMessages = useMemo(() => {
        const search = searchText.trim().toLowerCase();

        if (!search) {
            return [];
        }

        return messages.filter(message =>
            (plainTexts[message._id] || '')
                .toLowerCase()
                .includes(search)
        );
    }, [messages, plainTexts, searchText]);

    const sharedItems = useMemo(() => {
        return messages.filter(message =>
            message.attachment ||
            /https?:\/\/\S+/i.test(
                plainTexts[message._id] || ''
            )
        );
    }, [messages, plainTexts]);

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
                        onClick={() => setDark(!dark)}
                        title="Change app theme"
                    >
                        {dark ? <Sun /> : <Moon />}
                    </button>

                    <button
                        className="icon"
                        title="Log out"
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
                        onChange={event => setQuery(event.target.value)}
                        placeholder="Search conversations"
                    />
                </div>

                <button
                    className="new"
                    onClick={async () => {
                        try {
                            setNewChat(true);

                            const response = await api.get('/api/users');
                            setPeople(response.data);
                        } catch {
                            alert('Could not load users.');
                        }
                    }}
                >
                    <Plus /> New conversation
                </button>

                <div className="chatlist">
                    {chats
                        .filter(chat =>
                            other(chat, me).name
                                .toLowerCase()
                                .includes(query.toLowerCase())
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
                                    onClick={() => setActive(chat)}
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

            <section
                className={`conversation ${
                    chatTheme ? 'chat-themed' : ''
                }`}
                style={{
                    '--chat-bubble-color': chatTheme || undefined
                }}
            >
                {!active ? (
                    <div className="empty">
                        <div>◉</div>
                        <h2>Your messages</h2>
                        <p>Select a conversation or start a new one.</p>
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
                                        : online.has(title._id || title.id)
                                            ? 'online'
                                            : 'offline'}
                                </small>
                            </span>

                            <button
                                className="icon"
                                title="Chat options"
                                onClick={() => setMenuOpen(!menuOpen)}
                            >
                                <MoreVertical />
                            </button>

                            {menuOpen && (
                                <div className="chat-menu">
                                    <button onClick={() => openPanel('contact')}>
                                        <UserRound size={17} />
                                        View contact
                                    </button>

                                    <button onClick={() => openPanel('search')}>
                                        <Search size={17} />
                                        Search
                                    </button>

                                    <button disabled title="Coming soon">
                                        <Users size={17} />
                                        New group — coming soon
                                    </button>

                                    <button onClick={() => openPanel('media')}>
                                        <Image size={17} />
                                        Media, links and docs
                                    </button>

                                    <button onClick={toggleMute}>
                                        {muted ? (
                                            <Bell size={17} />
                                        ) : (
                                            <BellOff size={17} />
                                        )}
                                        {muted
                                            ? 'Unmute notifications'
                                            : 'Mute notifications'}
                                    </button>

                                    <button onClick={() => openPanel('disappearing')}>
                                        <Timer size={17} />
                                        Disappearing messages
                                    </button>

                                    <button onClick={() => openPanel('theme')}>
                                        <Palette size={17} />
                                        Chat theme
                                    </button>

                                    <button onClick={() => openPanel('more')}>
                                        <MoreVertical size={17} />
                                        More
                                    </button>
                                </div>
                            )}
                        </header>

                        <div className="messages">
                            {messages.map(message => (
                                <Bubble
                                    key={message._id}
                                    m={message}
                                    chat={active}
                                    mine={
                                        String(
                                            message.sender?._id ||
                                            message.sender?.id
                                        ) === String(me.id)
                                    }
                                />
                            ))}

                            {typing && (
                                <div className="typing">typing…</div>
                            )}

                            <i ref={bottom} />
                        </div>

                        <form className="composer" onSubmit={send}>
                            <label className="icon" title="Attach file">
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
                                title="Emoji"
                                onClick={() => setEmoji(!emoji)}
                            >
                                <Smile />
                            </button>

                            {emoji && (
                                <div className="emojis">
                                    <EmojiPicker
                                        onEmojiClick={item =>
                                            setText(
                                                current =>
                                                    current + item.emoji
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
                                className={`icon ${
                                    recording ? 'recording' : ''
                                }`}
                                onClick={toggleVoiceRecording}
                                title={
                                    recording
                                        ? 'Stop and send voice note'
                                        : 'Record voice note'
                                }
                            >
                                {recording ? '■' : <Mic />}
                            </button>

                            <button className="send" title="Send message">
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
                            onClick={() => setNewChat(false)}
                        >
                            <X />
                        </button>

                        <h2>New conversation</h2>

                        <div className="people">
                            {people.map(person => (
                                <button
                                    key={person.id}
                                    onClick={() => create(person.id)}
                                >
                                    <div className="avatar">
                                        {person.name?.[0] || '?'}
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

            {panel === 'contact' && (
                <div className="modal">
                    <section className="chat-panel">
                        <button
                            className="close"
                            onClick={() => setPanel('')}
                        >
                            <X />
                        </button>

                        <div className="panel-title">
                            <UserRound />
                            <h2>Contact info</h2>
                        </div>

                        <div className="contact-card">
                            <div className="avatar large">
                                {title.name?.[0] || '?'}
                            </div>

                            <h3>{title.name}</h3>
                            <p>{title.email || 'Private Pulse contact'}</p>
                            <p>{title.bio || 'No bio added yet.'}</p>
                        </div>
                    </section>
                </div>
            )}

            {panel === 'search' && (
                <div className="modal">
                    <section className="chat-panel">
                        <button
                            className="close"
                            onClick={() => setPanel('')}
                        >
                            <X />
                        </button>

                        <div className="panel-title">
                            <Search />
                            <h2>Search in chat</h2>
                        </div>

                        <div className="panel-search">
                            <Search />
                            <input
                                autoFocus
                                value={searchText}
                                onChange={event =>
                                    setSearchText(event.target.value)
                                }
                                placeholder="Search messages"
                            />
                        </div>

                        <div className="panel-results">
                            {!searchText.trim() ? (
                                <p>Type something to search this chat.</p>
                            ) : visibleMessages.length ? (
                                visibleMessages.map(message => (
                                    <button
                                        className="panel-message"
                                        key={message._id}
                                        onClick={() => setPanel('')}
                                    >
                                        <b>
                                            {String(
                                                message.sender?._id ||
                                                message.sender?.id
                                            ) === String(me.id)
                                                ? 'You'
                                                : title.name}
                                        </b>

                                        <span>
                                            {plainTexts[message._id]}
                                        </span>
                                    </button>
                                ))
                            ) : (
                                <p>No messages found.</p>
                            )}
                        </div>
                    </section>
                </div>
            )}

            {panel === 'media' && (
                <div className="modal">
                    <section className="chat-panel">
                        <button
                            className="close"
                            onClick={() => setPanel('')}
                        >
                            <X />
                        </button>

                        <div className="panel-title">
                            <Image />
                            <h2>Media, links and docs</h2>
                        </div>

                        <div className="panel-results">
                            {!sharedItems.length && (
                                <p>No shared media, links, or files yet.</p>
                            )}

                            {sharedItems.map(message => {
                                const attachment = message.attachment;
                                const body =
                                    plainTexts[message._id] || '';

                                const url = body.match(/https?:\/\/\S+/i)?.[0];

                                return (
                                    <div
                                        className="shared-file"
                                        key={message._id}
                                    >
                                        {attachment ? (
                                            <>
                                                {attachment.mime?.startsWith(
                                                    'image/'
                                                ) ? (
                                                    <Image size={20} />
                                                ) : (
                                                    <FileText size={20} />
                                                )}

                                                <a
                                                    href={`${API}${attachment.url}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    {attachment.name}
                                                </a>
                                            </>
                                        ) : (
                                            <>
                                                <Link2 size={20} />
                                                <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    {url}
                                                </a>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>
            )}

            {panel === 'disappearing' && (
                <div className="modal">
                    <section className="chat-panel">
                        <button
                            className="close"
                            onClick={() => setPanel('')}
                        >
                            <X />
                        </button>

                        <div className="panel-title">
                            <Timer />
                            <h2>Disappearing messages</h2>
                        </div>

                        <p>
                            New messages will automatically disappear after the
                            selected period.
                        </p>

                        <div className="panel-options">
                            <button onClick={() => setDisappearing(0)}>
                                Off
                            </button>

                            <button onClick={() => setDisappearing(86400)}>
                                24 hours
                            </button>

                            <button onClick={() => setDisappearing(604800)}>
                                7 days
                            </button>
                        </div>
                    </section>
                </div>
            )}

            {panel === 'theme' && (
                <div className="modal">
                    <section className="chat-panel">
                        <button
                            className="close"
                            onClick={() => setPanel('')}
                        >
                            <X />
                        </button>

                        <div className="panel-title">
                            <Palette />
                            <h2>Chat theme</h2>
                        </div>

                        <p>This colour is saved only on your device.</p>

                        <div className="theme-options">
                            {chatThemeOptions.map(option => (
                                <button
                                    key={option.name}
                                    className={
                                        chatTheme === option.value
                                            ? 'theme-selected'
                                            : ''
                                    }
                                    onClick={() => setTheme(option.value)}
                                >
                                    <i
                                        className="theme-dot"
                                        style={{
                                            background:
                                                option.value || '#168b65'
                                        }}
                                    />
                                    {option.name}
                                </button>
                            ))}
                        </div>
                    </section>
                </div>
            )}

            {panel === 'more' && (
                <div className="modal">
                    <section className="chat-panel">
                        <button
                            className="close"
                            onClick={() => setPanel('')}
                        >
                            <X />
                        </button>

                        <div className="panel-title">
                            <MoreVertical />
                            <h2>More</h2>
                        </div>

                        <div className="panel-options">
                            <button onClick={exportChat}>
                                <Download size={18} />
                                Export chat
                            </button>

                            <button
                                className="more-danger"
                                onClick={clearLocalChat}
                            >
                                <Trash2 size={18} />
                                Clear current chat view
                            </button>
                        </div>

                        <p className="panel-note">
                            “Clear current chat view” only clears this screen
                            temporarily. It does not delete messages from
                            MongoDB.
                        </p>
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
        <article className={`bubble ${mine ? 'mine' : ''}`}>
            {m.kind === 'voice' && m.attachment ? (
                <audio
                    controls
                    preload="metadata"
                    src={`${API}${m.attachment.url}`}
                >
                    Your browser does not support audio playback.
                </audio>
            ) : (
                m.attachment && (
                    <a
                        href={`${API}${m.attachment.url}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        📎 {m.attachment.name}
                    </a>
                )
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
                        className={m.status === 'read' ? 'read' : ''}
                    />
                )}
            </small>
        </article>
    );
}

createRoot(
    document.getElementById('root')
).render(<App />);
