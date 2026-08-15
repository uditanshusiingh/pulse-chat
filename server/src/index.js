import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import multer from 'multer';
import { Server } from 'socket.io';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { User, Chat, Message } from './models.js';
import { issueToken, requireAuth, socketAuth } from './auth.js';

const app = express();
const server = http.createServer(app);

const origins = (
    process.env.CLIENT_URL || 'http://localhost:5173'
)
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

const io = new Server(server, {
    cors: {
        origin: origins,
        credentials: true
    }
});

const upload = multer({
    dest: process.env.UPLOAD_DIR || 'uploads/',
    limits: {
        fileSize: 25 * 1024 * 1024
    }
});

app.use(
    helmet({
        crossOriginResourcePolicy: false
    })
);

app.use(
    cors({
        origin: origins,
        credentials: true
    })
);

app.use(
    express.json({
        limit: '1mb'
    })
);

app.use(morgan('tiny'));

app.use(
    '/uploads',
    express.static(process.env.UPLOAD_DIR || 'uploads')
);

app.get('/health', (_, res) => {
    res.json({
        ok: true,
        database:
            mongoose.connection.readyState === 1
                ? 'connected'
                : 'connecting'
    });
});

function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio,
        lastSeen: user.lastSeen
    };
}

async function permitted(id, userId) {
    return Chat.findOne({
        _id: id,
        members: userId
    });
}

async function populatedChat(chatId) {
    return Chat.findById(chatId)
        .populate(
            'members',
            'name email avatar bio lastSeen'
        )
        .populate({
            path: 'lastMessage',
            populate: {
                path: 'sender',
                select: 'name avatar'
            }
        });
}

/* ============================================================
   AUTHENTICATION
============================================================ */

app.post(
    '/api/auth/register',
    rateLimit({
        windowMs: 60000,
        max: 10
    }),
    async (req, res) => {
        const {
            name,
            email,
            password
        } = req.body;

        if (
            !name ||
            !email ||
            !password ||
            password.length < 8
        ) {
            return res.status(400).json({
                error:
                    'Name, email and an 8-character password are required'
            });
        }

        try {
            const user = await User.create({
                name: name.trim(),
                email: email.trim().toLowerCase(),
                passwordHash: await bcrypt.hash(password, 12)
            });

            res.status(201).json({
                token: issueToken(user.id),
                user: publicUser(user)
            });
        } catch {
            res.status(409).json({
                error: 'Email already registered'
            });
        }
    }
);

app.post(
    '/api/auth/login',
    rateLimit({
        windowMs: 60000,
        max: 10
    }),
    async (req, res) => {
        const user = await User.findOne({
            email: req.body.email?.toLowerCase().trim()
        });

        const validPassword =
            user &&
            await bcrypt.compare(
                req.body.password || '',
                user.passwordHash
            );

        if (!validPassword) {
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        res.json({
            token: issueToken(user.id),
            user: publicUser(user)
        });
    }
);

/* ============================================================
   PASSWORD RESET
============================================================ */

app.post(
    '/api/auth/forgot-password',
    rateLimit({
        windowMs: 60000,
        max: 5
    }),
    async (req, res) => {
        const email = req.body.email?.toLowerCase()?.trim();

        const user = await User.findOne({ email });

        const responseMessage =
            'If an account exists for that email, a reset link has been sent.';

        if (!user) {
            return res.json({
                message: responseMessage
            });
        }

        const token = crypto.randomBytes(32).toString('hex');

        user.resetTokenHash = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        user.resetTokenExpiresAt = new Date(
            Date.now() + 15 * 60 * 1000
        );

        await user.save();

        const baseUrl = (
            process.env.RESET_URL ||
            process.env.CLIENT_URL ||
            'http://localhost:5173'
        ).replace(/\/$/, '');

        const resetLink = `${baseUrl}/?reset=${token}`;

        if (
            process.env.RESEND_API_KEY &&
            process.env.EMAIL_FROM
        ) {
            try {
                const emailResponse = await fetch(
                    'https://api.resend.com/emails',
                    {
                        method: 'POST',
                        headers: {
                            Authorization:
                                `Bearer ${process.env.RESEND_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            from: process.env.EMAIL_FROM,
                            to: [user.email],
                            subject: 'Reset your Pulse password',
                            html: `
                                <h2>Reset your Pulse password</h2>
                                <p>This reset link expires in 15 minutes.</p>
                                <p>
                                    <a href="${resetLink}">
                                        Reset password
                                    </a>
                                </p>
                            `
                        })
                    }
                );

                if (!emailResponse.ok) {
                    console.error(
                        'Password reset email failed:',
                        await emailResponse.text()
                    );
                }
            } catch (error) {
                console.error(
                    'Password reset email failed:',
                    error.message
                );
            }
        } else {
            console.log(
                `Password reset link for ${user.email}: ${resetLink}`
            );
        }

        res.json({
            message: responseMessage
        });
    }
);

app.post(
    '/api/auth/reset-password',
    rateLimit({
        windowMs: 60000,
        max: 5
    }),
    async (req, res) => {
        const {
            token,
            password
        } = req.body;

        if (
            !token ||
            !password ||
            password.length < 8
        ) {
            return res.status(400).json({
                error:
                    'Enter a new password with at least 8 characters'
            });
        }

        const tokenHash = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        const user = await User.findOne({
            resetTokenHash: tokenHash,
            resetTokenExpiresAt: {
                $gt: new Date()
            }
        });

        if (!user) {
            return res.status(400).json({
                error: 'This reset link is invalid or has expired'
            });
        }

        user.passwordHash = await bcrypt.hash(password, 12);
        user.resetTokenHash = undefined;
        user.resetTokenExpiresAt = undefined;

        await user.save();

        res.json({
            message: 'Password updated. You can now sign in.'
        });
    }
);

/* ============================================================
   PROFILE AND ENCRYPTION KEYS
============================================================ */

app.get(
    '/api/me',
    requireAuth,
    async (req, res) => {
        const user = await User.findById(req.userId);

        if (!user) {
            return res.sendStatus(404);
        }

        res.json(publicUser(user));
    }
);

app.patch(
    '/api/me',
    requireAuth,
    async (req, res) => {
        const updates = {};

        if (typeof req.body.name === 'string') {
            updates.name = req.body.name.trim();
        }

        if (typeof req.body.bio === 'string') {
            updates.bio = req.body.bio.trim();
        }

        if (typeof req.body.avatar === 'string') {
            updates.avatar = req.body.avatar;
        }

        const user = await User.findByIdAndUpdate(
            req.userId,
            {
                $set: updates
            },
            {
                new: true,
                runValidators: true
            }
        );

        res.json(publicUser(user));
    }
);

app.put(
    '/api/me/encryption-key',
    requireAuth,
    async (req, res) => {
        if (!req.body.publicKey) {
            return res.status(400).json({
                error: 'Public encryption key is required'
            });
        }

        await User.findByIdAndUpdate(
            req.userId,
            {
                encryptionPublicKey: req.body.publicKey
            }
        );

        res.sendStatus(204);
    }
);

app.get(
    '/api/users/:id/encryption-key',
    requireAuth,
    async (req, res) => {
        const user = await User.findById(
            req.params.id
        ).select('encryptionPublicKey');

        if (!user?.encryptionPublicKey) {
            return res.status(404).json({
                error: 'Encryption key unavailable'
            });
        }

        res.json({
            publicKey: user.encryptionPublicKey
        });
    }
);

app.get(
    '/api/users',
    requireAuth,
    async (req, res) => {
        const query = (req.query.q || '').replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
        );

        const users = await User.find({
            _id: {
                $ne: req.userId
            },
            $or: [
                {
                    name: {
                        $regex: query,
                        $options: 'i'
                    }
                },
                {
                    email: {
                        $regex: query,
                        $options: 'i'
                    }
                }
            ]
        }).limit(20);

        res.json(users.map(publicUser));
    }
);

/* ============================================================
   CHATS
============================================================ */

app.get(
    '/api/chats',
    requireAuth,
    async (req, res) => {
        const chats = await Chat.find({
            members: req.userId
        })
            .populate(
                'members',
                'name email avatar bio lastSeen'
            )
            .populate({
                path: 'lastMessage',
                populate: {
                    path: 'sender',
                    select: 'name avatar'
                }
            })
            .sort({
                updatedAt: -1
            });

        res.json(chats);
    }
);

app.post(
    '/api/chats',
    requireAuth,
    async (req, res) => {
        const memberIds = [
            ...new Set([
                req.userId,
                ...(req.body.memberIds || [])
            ])
        ];

        if (memberIds.length < 2) {
            return res.status(400).json({
                error: 'Choose at least one other member'
            });
        }

        const type =
            req.body.type === 'group'
                ? 'group'
                : 'direct';

        if (type === 'direct') {
            const existingChat = await Chat.findOne({
                type: 'direct',
                members: {
                    $all: memberIds
                },
                $expr: {
                    $eq: [
                        {
                            $size: '$members'
                        },
                        2
                    ]
                }
            });

            if (existingChat) {
                return res.json(
                    await populatedChat(existingChat.id)
                );
            }
        }

        const chat = await Chat.create({
            type,
            members: memberIds,
            title: req.body.title || '',
            adminIds: [req.userId],
            keyEnvelopes: req.body.keyEnvelopes || []
        });

        const fullChat = await populatedChat(chat.id);

        memberIds.forEach(id => {
            io.in(`user:${id}`).socketsJoin(
                `chat:${chat.id}`
            );

            io.to(`user:${id}`).emit(
                'chat:new',
                fullChat
            );
        });

        res.status(201).json(fullChat);
    }
);

/* ============================================================
   CHAT SETTINGS: MUTE + DISAPPEARING MESSAGES
============================================================ */

app.patch(
    '/api/chats/:id/settings',
    requireAuth,
    async (req, res) => {
        const chat = await permitted(
            req.params.id,
            req.userId
        );

        if (!chat) {
            return res.sendStatus(404);
        }

        const {
            mutedUntil,
            disappearingAfterSeconds
        } = req.body;

        const allowedDurations = [
            0,
            86400,
            604800
        ];

        if (
            disappearingAfterSeconds !== undefined &&
            !allowedDurations.includes(
                Number(disappearingAfterSeconds)
            )
        ) {
            return res.status(400).json({
                error: 'Invalid disappearing-message duration'
            });
        }

        if (disappearingAfterSeconds !== undefined) {
            chat.disappearingAfterSeconds =
                Number(disappearingAfterSeconds);
        }

        if (mutedUntil !== undefined) {
            let setting = chat.memberSettings.find(item =>
                String(item.user) === String(req.userId)
            );

            if (!setting) {
                chat.memberSettings.push({
                    user: req.userId,
                    mutedUntil: mutedUntil
                        ? new Date(mutedUntil)
                        : null
                });
            } else {
                setting.mutedUntil = mutedUntil
                    ? new Date(mutedUntil)
                    : null;
            }
        }

        await chat.save();

        res.json(await populatedChat(chat.id));
    }
);

/* ============================================================
   MESSAGES
============================================================ */

app.get(
    '/api/chats/:id/messages',
    requireAuth,
    async (req, res) => {
        const chat = await permitted(
            req.params.id,
            req.userId
        );

        if (!chat) {
            return res.sendStatus(404);
        }

        const before = req.query.before
            ? {
                _id: {
                    $lt: req.query.before
                }
            }
            : {};

        const messages = await Message.find({
            chat: chat.id,
            ...before,
            $or: [
                {
                    expiresAt: null
                },
                {
                    expiresAt: {
                        $gt: new Date()
                    }
                }
            ]
        })
            .populate(
                'sender',
                'name avatar'
            )
            .sort({
                _id: -1
            })
            .limit(50);

        res.json(messages);
    }
);

/* ============================================================
   UPLOADS + PUSH NOTIFICATIONS
============================================================ */

app.post(
    '/api/upload',
    requireAuth,
    upload.single('file'),
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                error: 'File required'
            });
        }

        res.status(201).json({
            url: `/uploads/${req.file.filename}`,
            name: req.file.originalname,
            mime: req.file.mimetype,
            size: req.file.size
        });
    }
);

app.post(
    '/api/push/subscribe',
    requireAuth,
    async (req, res) => {
        await User.findByIdAndUpdate(
            req.userId,
            {
                $addToSet: {
                    pushSubscriptions:
                        req.body.subscription
                }
            }
        );

        res.sendStatus(204);
    }
);

/* ============================================================
   SOCKET.IO
============================================================ */

io.use(socketAuth);

io.on('connection', async socket => {
    const userId = socket.userId;

    socket.join(`user:${userId}`);

    const chats = await Chat.find({
        members: userId
    }).select('_id');

    chats.forEach(chat => {
        socket.join(`chat:${chat.id}`);
    });

    io.emit('presence', {
        userId,
        online: true
    });

    socket.on(
        'typing',
        async ({ chatId, isTyping }) => {
            const chat = await permitted(chatId, userId);

            if (chat) {
                socket.to(`chat:${chatId}`).emit(
                    'typing',
                    {
                        chatId,
                        userId,
                        isTyping
                    }
                );
            }
        }
    );

    socket.on(
        'message:send',
        async (data, acknowledge) => {
            try {
                const chat = await permitted(
                    data.chatId,
                    userId
                );

                if (!chat) {
                    throw Error('Chat unavailable');
                }

                if (!data.ciphertext || !data.iv) {
                    throw Error('Encrypted message data is required');
                }

                const message = await Message.create({
                    chat: chat.id,
                    sender: userId,
                    ciphertext: data.ciphertext,
                    iv: data.iv,
                    kind: data.kind || 'text',
                    attachment: data.attachment,

                    expiresAt: chat.disappearingAfterSeconds
                        ? new Date(
                            Date.now() +
                            chat.disappearingAfterSeconds * 1000
                        )
                        : null
                });

                chat.lastMessage = message.id;
                await chat.save();

                const fullMessage = await message.populate(
                    'sender',
                    'name avatar'
                );

                io.to(`chat:${chat.id}`).emit(
                    'message:new',
                    fullMessage
                );

                acknowledge?.({
                    ok: true,
                    message: fullMessage
                });
            } catch (error) {
                acknowledge?.({
                    ok: false,
                    error: error.message
                });
            }
        }
    );

    socket.on(
        'message:read',
        async ({ chatId, messageId }) => {
            const chat = await permitted(
                chatId,
                userId
            );

            if (!chat) {
                return;
            }

            await Message.findOneAndUpdate(
                {
                    _id: messageId,
                    chat: chat.id
                },
                {
                    $addToSet: {
                        readBy: userId
                    },
                    $set: {
                        status: 'read'
                    }
                }
            );

            io.to(`chat:${chatId}`).emit(
                'message:read',
                {
                    chatId,
                    messageId,
                    userId
                }
            );
        }
    );

    socket.on('disconnect', async () => {
        await User.findByIdAndUpdate(
            userId,
            {
                lastSeen: new Date()
            }
        );

        io.emit('presence', {
            userId,
            online: false
        });
    });
});

/* ============================================================
   SERVER START
============================================================ */

const port = Number(process.env.PORT || 5000);

server.listen(port, '0.0.0.0', () => {
    console.log(`API listening on port ${port}`);
});

mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('MongoDB connected');
    })
    .catch(error => {
        console.error(
            'MongoDB connection failed:',
            error.message
        );
    });
